import { randomBytes, createHash, scrypt as Scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { Transaction } from './db.mjs';
import { HttpError } from './http.mjs';

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

export async function CreateUser(Pool, { username, displayName, password, role = 'member', invite }, Registration = 'closed', Operator = false) {
	const Username = String(username ?? '').trim().toLowerCase();
	const DisplayName = String(displayName ?? Username).trim();
	if (!/^[a-z0-9_]{3,24}$/.test(Username)) throw new HttpError(400, 'InvalidUsername');
	if (DisplayName.length < 1 || DisplayName.length > 50) throw new HttpError(400, 'InvalidDisplayName');
	if (!Operator && Registration === 'closed') throw new HttpError(403, 'RegistrationClosed');
	const Encoded = await PasswordHash(password);
	try {
		return await Transaction(Pool, async Client => {
			if (!Operator && Registration === 'invite') {
				const Used = await Client.query('UPDATE invites SET uses = uses + 1 WHERE token_hash = $1 AND uses < max_uses AND expires_at > now() RETURNING token_hash', [Hash(String(invite ?? ''))]);
				if (!Used.rowCount) throw new HttpError(403, 'InvalidInvite');
			}
			const Result = await Client.query('INSERT INTO users(username, display_name, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id, username, display_name, role', [Username, DisplayName, Encoded, Operator ? role : 'member']);
			return Result.rows[0];
		});
	} catch (Error) {
		if (Error.code === '23505') throw new HttpError(409, 'UsernameTaken');
		throw Error;
	}
}

let Dummy;
export async function Login(Pool, Username, Password) {
	const Result = await Pool.query('SELECT * FROM users WHERE username = $1', [String(Username ?? '').toLowerCase().trim().slice(0, 24)]);
	Dummy ??= PasswordHash(Token());
	const User = Result.rows[0];
	const Valid = await PasswordMatches(Password, User?.password_hash ?? await Dummy);
	if (!User || !Valid) throw new HttpError(401, 'InvalidLogin');
	if (User.suspended_at) throw new HttpError(403, 'AccountSuspended');
	const SessionToken = Token();
	const Csrf = Token();
	await Pool.query("INSERT INTO sessions(token_hash, user_id, csrf_token, expires_at) VALUES ($1, $2, $3, now() + interval '30 days')", [Hash(SessionToken), User.id, Csrf]);
	return { Token: SessionToken, Csrf, User };
}

export async function Viewer(Pool, Request) {
	const Cookie = Request.headers.cookie?.split(';').map(Value => Value.trim()).find(Value => Value.startsWith('kittok_session='))?.slice('kittok_session='.length);
	if (!Cookie || !/^[a-f0-9]{64}$/.test(Cookie)) return null;
	const Result = await Pool.query('SELECT u.id, u.username, u.display_name, u.bio, u.role, u.avatar_name, s.csrf_token, s.token_hash FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1 AND s.expires_at > now() AND u.suspended_at IS NULL', [Hash(Cookie)]);
	return Result.rows[0] ?? null;
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
