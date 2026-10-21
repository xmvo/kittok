import { randomBytes, createHash, scrypt as Scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { isIP } from 'node:net';
import { Transaction } from './db.mjs';
import { HttpError } from './http.mjs';
import { PrideFlag } from './badges.mjs';

const Derive = promisify(Scrypt);
const Options = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
export const Token = () => randomBytes(32).toString('hex');
export const Hash = Value => createHash('sha256').update(Value).digest('hex');

export async function PasswordHash(Password) {
	if (typeof Password !== 'string' || Password.length < 12 || Buffer.byteLength(Password) > 256) throw new HttpError(400, 'PasswordNeeds12To256Bytes');
	const Salt = randomBytes(16).toString('hex');
	const Key = await Derive(Password, Salt, 64, Options);
	return `scrypt$${Salt}$${Key.toString('hex')}`;
}

export async function PasswordMatches(Password, Encoded) {
	if (typeof Password !== 'string' || Buffer.byteLength(Password) > 256) return false;
	const [, Salt, Expected] = Encoded.split('$');
	const Key = await Derive(Password, Salt, 64, Options);
	return timingSafeEqual(Key, Buffer.from(Expected, 'hex'));
}

export function ClientInfo(Request, Config) {
	const Country = Config?.CountryHeader ? String(Request.headers[Config.CountryHeader] ?? '').toUpperCase() : '';
	const Language = String(Request.headers['accept-language'] ?? '').split(',')[0].split(';')[0].trim();
	const Forwarded = Config?.IpHeader ? String(Request.headers[Config.IpHeader] ?? '').split(',').at(-1).trim() : '';
	return {
		ip: (isIP(Forwarded) ? Forwarded : Request.socket?.remoteAddress ?? '').replace(/^::ffff:/, '') || null,
		country: /^[A-Z]{2}$/.test(Country) && Country !== 'XX' ? Country : null,
		language: /^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})*$/.test(Language) ? Language : null,
		userAgent: String(Request.headers['user-agent'] ?? '').slice(0, 400) || null,
	};
}

export async function RecordEvent(Pool, UserId, Kind, Info = {}, Detail = '') {
	await Pool.query('INSERT INTO user_events(user_id, kind, ip, country, language, user_agent, detail) VALUES ($1, $2, $3, $4, $5, $6, $7)', [UserId, Kind, Info.ip ?? null, Info.country ?? null, Info.language ?? null, Info.userAgent ?? null, Detail.slice(0, 500)]);
}

export async function CreateUser(Pool, { username, displayName, password, role = 'member', invite, prideFlag = '', email = null }, Registration = 'closed', Operator = false, Info = {}) {
	const Username = String(username ?? '').trim().toLowerCase();
	const Email = email === null ? null : String(email).trim().toLowerCase();
	if (Email !== null && (Email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(Email))) throw new HttpError(400, 'InvalidEmail');
	const DisplayName = String(displayName ?? Username).trim();
	if (!/^[a-z0-9_]{3,24}$/.test(Username)) throw new HttpError(400, 'InvalidUsername');
	if (DisplayName.length < 1 || DisplayName.length > 50) throw new HttpError(400, 'InvalidDisplayName');
	if (!Operator && Registration === 'closed') throw new HttpError(403, 'RegistrationClosed');
	const Flag = PrideFlag(prideFlag);
	const Encoded = await PasswordHash(password);
	try {
		return await Transaction(Pool, async Client => {
			if (!Operator && Registration === 'invite') {
				const Used = await Client.query('UPDATE invites SET uses = uses + 1 WHERE token_hash = $1 AND uses < max_uses AND expires_at > now() RETURNING token_hash', [Hash(String(invite ?? ''))]);
				if (!Used.rowCount) throw new HttpError(403, 'InvalidInvite');
			}
			const Result = await Client.query('INSERT INTO users(username, display_name, password_hash, role, pride_flag, email) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, username, display_name, role, pride_flag, user_badges', [Username, DisplayName, Encoded, Operator ? role : 'member', Flag, Email]);
			await RecordEvent(Client, Result.rows[0].id, 'signup', Info, Operator ? 'Created by an operator' : '');
			return Result.rows[0];
		});
	} catch (Error) {
		if (Error.code === '23505') throw new HttpError(409, Error.constraint === 'users_email' ? 'EmailTaken' : 'UsernameTaken');
		throw Error;
	}
}

let Dummy;
export async function Login(Pool, Username, Password, Info = {}) {
	const Name = String(Username ?? '').toLowerCase().trim().slice(0, 254);
	const Result = await Pool.query(`SELECT * FROM users WHERE ${Name.includes('@') ? 'lower(email)' : 'username'} = $1`, [Name]);
	Dummy ??= PasswordHash(Token());
	const User = Result.rows[0];
	const Valid = await PasswordMatches(Password, User?.password_hash ?? await Dummy);
	if (User && !Valid) await RecordEvent(Pool, User.id, 'login_failed', Info);
	if (!User || !Valid) throw new HttpError(401, 'InvalidLogin');
	if (User.suspended_at && User.deactivated_at && !(await Pool.query("SELECT 1 FROM moderation_decisions WHERE owner_id = $1 AND account_action = 'ban' AND reversed_at IS NULL", [User.id])).rowCount) {
		await Pool.query('UPDATE users SET suspended_at = NULL, deactivated_at = NULL, delete_after = NULL WHERE id = $1', [User.id]);
		await RecordEvent(Pool, User.id, 'reactivated', Info, User.delete_after ? 'Deletion canceled' : '');
		User.suspended_at = null;
	}
	if (User.suspended_at) {
		await RecordEvent(Pool, User.id, 'login_failed', Info, 'Account suspended');
		throw Object.assign(new HttpError(403, 'AccountSuspended'), { UserId: User.id });
	}
	const SessionToken = Token();
	const Csrf = Token();
	await Pool.query("INSERT INTO sessions(token_hash, user_id, csrf_token, expires_at, ip, country, user_agent) VALUES ($1, $2, $3, now() + interval '30 days', $4, $5, $6)", [Hash(SessionToken), User.id, Csrf, Info.ip ?? null, Info.country ?? null, Info.userAgent ?? null]);
	await RecordEvent(Pool, User.id, 'login', Info);
	return { Token: SessionToken, Csrf, User };
}

export async function Viewer(Pool, Request) {
	const Cookie = Request.headers.cookie?.split(';').map(Value => Value.trim()).find(Value => Value.startsWith('kittok_session='))?.slice('kittok_session='.length);
	if (!Cookie || !/^[a-f0-9]{64}$/.test(Cookie)) return null;
	const Result = await Pool.query("SELECT u.id, u.username, u.display_name, u.bio, u.role, u.avatar_name, u.verified, u.pride_flag, u.user_badges, u.private_account, u.comment_permission, u.allow_downloads, s.csrf_token, s.token_hash, s.last_seen_at < now() - interval '5 minutes' AS stale FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1 AND s.expires_at > now() AND u.suspended_at IS NULL", [Hash(Cookie)]);
	const User = Result.rows[0];
	if (User?.stale) Pool.query('UPDATE sessions SET last_seen_at = now() WHERE token_hash = $1', [User.token_hash]).catch(() => {});
	return User ?? null;
}

export function SessionCookie(Config, Value, Clear = false) {
	return `kittok_session=${Value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Clear ? 0 : 2592000}${Config.SecureCookies ? '; Secure' : ''}`;
}

export function RequireUser(User) {
	if (!User) throw new HttpError(401, 'NotLoggedIn');
	return User;
}

export function RequireCsrf(Request, User, Supplied) {
	RequireUser(User);
	const Values = String(Supplied ?? Request.headers['x-csrf-token'] ?? '').split(',').map(Value => Value.trim());
	if (!Values.every(Value => /^[a-f0-9]{64}$/.test(Value) && timingSafeEqual(Buffer.from(Value), Buffer.from(User.csrf_token)))) throw new HttpError(403, 'InvalidCsrf');
}

export function RateLimiter() {
	const Attempts = new Map();
	const Timer = setInterval(() => {
		for (const [Key, Entry] of Attempts) if (Entry.until < Date.now()) Attempts.delete(Key);
	}, 60000).unref();
	return {
		Hit(Key, Limit = 10, Window = 60000) {
			let Entry = Attempts.get(Key);
			if (!Entry || Entry.until < Date.now()) {
				if (Attempts.size > 10000) throw new HttpError(429, 'TryLater');
				Attempts.set(Key, Entry = { count: 0, until: Date.now() + Window });
			}
			if (++Entry.count > Limit) throw new HttpError(429, 'TryLater');
		},
		Close() { clearInterval(Timer); },
	};
}
