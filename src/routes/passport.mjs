import { randomInt } from 'node:crypto';
import { CreateUser, Hash, Login, RequireCsrf, SessionCookie, ClientInfo, RecordEvent } from '../auth.mjs';
import { MailConfigured, SendMail } from '../mail.mjs';
import { Escape, HttpError, Json, ReadBody, RequireMethod } from '../http.mjs';
import { AvatarUrl } from '../store.mjs';
import { ActiveRestriction, RestrictionText, BanTicket } from '../moderation.mjs';

export function DecodePassportValue(Value, Mixed) {
	if (typeof Value !== 'string' || Value.length > 2048) throw new HttpError(400, 'InvalidLogin');
	if (!Mixed) return Value;
	if (!/^(?:[a-fA-F0-9]{2})*$/.test(Value)) throw new HttpError(400, 'InvalidLogin');
	const Bytes = Buffer.from(Value, 'hex');
	for (let Index = 0; Index < Bytes.length; Index++) Bytes[Index] ^= 5;
	try { return new TextDecoder('utf-8', { fatal: true }).decode(Bytes); }
	catch { throw new HttpError(400, 'InvalidLogin'); }
}

const NormalEmail = Value => {
	const Email = String(Value ?? '').trim().toLowerCase();
	if (Email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(Email)) throw new HttpError(400, 'InvalidEmail');
	return Email;
};

const SignupMessages = {
	RegistrationClosed: 'Sign-ups are closed on this instance.', InvalidInvite: 'That invite code isn\u2019t valid or has expired.', InviteNeeded: 'Enter your invite code.', EmailTaken: 'This email is already registered. Try logging in.',
	InvalidEmail: 'Enter a valid email address.', PasswordNeeds12To256Bytes: 'Use at least 12 characters for your password.', TooYoung: 'Sorry, looks like you\u2019re not eligible to sign up.',
	WrongCode: 'Verification code is incorrect.', CodeExpired: 'Verification code expired. Send a new one.', MailNotConfigured: 'This instance can\u2019t send email right now.',
	CouldntSendMail: 'Couldn\u2019t send the code. Try again later.', WaitBeforeResending: 'Wait a minute before sending another code.', TryLater: 'Too many attempts. Try again later.',
};
function SignupError(Response, Error) {
	const Name = Object.hasOwn(SignupMessages, Error.message) ? Error.message : Error.status === 429 ? 'TryLater' : Error.message;
	Json(Response, { message: 'error', data: { error_code: Name === 'EmailTaken' ? 1023 : Name === 'TryLater' ? 7 : 1203, description: SignupMessages[Name] ?? 'Something went wrong. Please try again.' } });
}

async function SendCode({ Pool, Config }, Email, Purpose) {
	const Recent = (await Pool.query("SELECT sent_at > now() - interval '60 seconds' AS recent FROM email_codes WHERE email = $1 AND purpose = $2", [Email, Purpose])).rows[0];
	if (Recent?.recent) throw new HttpError(429, 'WaitBeforeResending');
	const Code = String(randomInt(0, 1e6)).padStart(6, '0');
	await Pool.query(`INSERT INTO email_codes(email, purpose, code_hash, expires_at) VALUES ($1, $2, $3, now() + interval '10 minutes')
		ON CONFLICT (email, purpose) DO UPDATE SET code_hash = $3, attempts = 0, sent_at = now(), expires_at = now() + interval '10 minutes'`, [Email, Purpose, Hash(Code)]);
	const Name = Config.Name;
	try {
		await SendMail(Config, {
			To: Email, Subject: `${Code} is your ${Name} verification code`,
			Text: `Your ${Name} verification code is ${Code}.\n\nIt expires in 10 minutes. If you didn't try to sign up, you can ignore this email.\n\n${Config.Origin}`,
			Html: `<div style="font-family:Arial,sans-serif;max-width:440px;margin:0 auto;padding:24px;color:#161823"><h2 style="margin:0 0 16px">${Escape(Name)}</h2><p style="margin:0 0 16px">Use this code to finish signing up:</p><p style="font-size:32px;font-weight:700;letter-spacing:6px;margin:0 0 16px">${Code}</p><p style="margin:0;color:#757575;font-size:13px">It expires in 10 minutes. If you didn\u2019t try to sign up, you can ignore this email.</p></div>`,
		});
	} catch (Error) {
		await Pool.query('DELETE FROM email_codes WHERE email = $1 AND purpose = $2', [Email, Purpose]);
		if (Error.status) throw Error;
		console.error('CouldntSendMail', Error.message);
		throw new HttpError(502, 'CouldntSendMail');
	}
}

async function CheckCode(Pool, Email, Purpose, Code) {
	const Row = (await Pool.query('UPDATE email_codes SET attempts = attempts + 1 WHERE email = $1 AND purpose = $2 RETURNING code_hash, attempts, expires_at < now() AS expired', [Email, Purpose])).rows[0];
	if (!Row || Row.expired || Row.attempts > 5) throw new HttpError(400, 'CodeExpired');
	if (!/^\d{6}$/.test(Code) || Hash(Code) !== Row.code_hash) throw new HttpError(400, 'WrongCode');
	await Pool.query('DELETE FROM email_codes WHERE email = $1 AND purpose = $2', [Email, Purpose]);
}

function OldEnough(Value) {
	const Match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(Value ?? ''));
	if (!Match) return false;
	const Now = new Date(), Birth = new Date(Date.UTC(+Match[1], +Match[2] - 1, +Match[3]));
	const Thirteenth = new Date(Date.UTC(+Match[1] + 13, +Match[2] - 1, +Match[3]));
	return !Number.isNaN(Birth.getTime()) && Thirteenth <= Now;
}

export function PassportUser(User, Config) {
	return {
		user_id: User.id, user_id_str: User.id, uid: User.id, sec_user_id: User.id,
		username: User.username, screen_name: User.display_name, name: User.display_name,
		avatar_url: AvatarUrl(User, Config.Origin), user_verified: false,
		has_password: true, has_email: false, has_mobile: false, is_new_user: false,
		redirect_url: Config.Origin,
	};
}

export async function Passport(Context) {
	const { Request, Response, Url, Pool, Config, User, Limiter } = Context;
	const Path = Url.pathname;
	if (['/passport/web/user/login/', '/passport/web/email/login/'].includes(Path)) {
		RequireMethod(Request, ['POST']);
		try {
			Limiter.Hit(`auth:${Request.socket.remoteAddress}`, 10);
			const Body = await ReadBody(Request);
			if (Body.mix_mode !== undefined && !['0', '1'].includes(String(Body.mix_mode))) throw new HttpError(400, 'InvalidLogin');
			const Mixed = String(Body.mix_mode) === '1';
			const Username = DecodePassportValue(Body.username ?? Body.account ?? Body.email, Mixed);
			const Password = DecodePassportValue(Body.password, Mixed);
			const Session = await Login(Pool, Username, Password, ClientInfo(Request, Config));
			Response.setHeader('set-cookie', SessionCookie(Config, Session.Token));
			Json(Response, { message: 'success', data: PassportUser(Session.User, Config) });
		} catch (Error) {
			if (!Error.status) throw Error;
			if (Error.UserId) { Json(Response, { message: 'error', data: { error_code: 1091, description: 'This account was permanently banned.', user_id_str: Error.UserId, verify_ticket: BanTicket(Error.UserId) } }); return true; }
			const Description = { 429: 'Too many attempts. Try again later.', 403: 'This account is suspended.' }[Error.status] ?? 'Username or password is incorrect.';
			Json(Response, { message: 'error', data: { error_code: Error.status === 429 ? 7 : 1001, description: Description } });
		}
		return true;
	}
	if (['/passport/web/account/info/', '/passport/account/info/v2/'].includes(Path)) {
		RequireMethod(Request, ['GET']);
		Json(Response, User ? { message: 'success', data: PassportUser(User, Config) } : { message: 'error', data: { error_code: 8, description: 'NotLoggedIn' } }); return true;
	}
	if (Path === '/passport/web/login_name/update/' || Path === '/passport/web/account/set/') {
		RequireMethod(Request, ['POST']); RequireCsrf(Request, User, Request.headers['x-csrf-token'] ?? Request.headers['x-tt-passport-csrf-token']);
		Limiter.Hit(`username:${User.id}`, 5, 3600000);
		const Restricted = await ActiveRestriction(Pool, User.id, 'profile');
		if (Restricted) { Json(Response, { message: 'error', data: { error_code: 23, description: RestrictionText(Restricted) } }); return true; }
		const Body = await ReadBody(Request);
		const Raw = Path.endsWith('/account/set/') ? DecodePassportValue(String(Body.username ?? ''), String(Body.mix_mode) === '1') : Body.login_name ?? Url.searchParams.get('login_name');
		const Name = String(Raw ?? '').trim().toLowerCase();
		if (!/^[a-z0-9_]{3,24}$/.test(Name)) { Json(Response, { message: 'error', data: { error_code: 1027, description: 'Use 3 to 24 lowercase letters, numbers, or underscores.' } }); return true; }
		try {
			const Updated = (await Pool.query(`UPDATE users SET username = $2, display_name = CASE WHEN $3 AND display_name = username THEN $2 ELSE display_name END WHERE id = $1 RETURNING id, username, display_name, avatar_name`, [User.id, Name, Path.endsWith('/account/set/')])).rows[0];
			if (Name !== User.username) await RecordEvent(Pool, User.id, 'username_change', ClientInfo(Request, Config), `@${User.username} → @${Name}`);
			Json(Response, { message: 'success', data: PassportUser(Updated, Config) });
		} catch (Error) {
			if (Error.code !== '23505') throw Error;
			Json(Response, { message: 'error', data: { error_code: 1024, description: 'This username is taken.' } });
		}
		return true;
	}
	if (Path === '/api/v3/register/verification/age/') {
		RequireMethod(Request, ['POST']);
		const Eligible = OldEnough((await ReadBody(Request)).birthday);
		Json(Response, { is_eligible: Eligible, status_code: Eligible ? 0 : 1, status_msg: Eligible ? '' : 'Sorry, looks like you\u2019re not eligible to sign up.' }); return true;
	}
	if (Path === '/passport/web/email/send_code/') {
		RequireMethod(Request, ['POST']);
		try {
			if (Config.Registration === 'closed') throw new HttpError(403, 'RegistrationClosed');
			Limiter.Hit(`mailcode:${Request.socket.remoteAddress}`, 5, 600000);
			const Body = await ReadBody(Request);
			const Email = NormalEmail(DecodePassportValue(Body.email, String(Body.mix_mode) === '1'));
			if ((await Pool.query('SELECT 1 FROM users WHERE lower(email) = $1', [Email])).rowCount) throw new HttpError(409, 'EmailTaken');
			await SendCode(Context, Email, 'signup');
			Json(Response, { message: 'success', data: { email: Email, retry_time: 60 } });
		} catch (Error) { if (!Error.status) throw Error; SignupError(Response, Error); }
		return true;
	}
	if (Path === '/passport/web/email/register_verify_login/') {
		RequireMethod(Request, ['POST']);
		try {
			Limiter.Hit(`signup:${Request.socket.remoteAddress}`, 10);
			const Body = await ReadBody(Request);
			const Mixed = String(Body.mix_mode) === '1';
			const Email = DecodePassportValue(Body.email, Mixed), Password = DecodePassportValue(Body.password, Mixed), Code = DecodePassportValue(Body.code ?? '', Mixed);
			if (!OldEnough(Body.birthday)) throw new HttpError(400, 'TooYoung');
			let Invite = /(?:^|;\s*)kittok_invite=([^;]*)/.exec(Request.headers.cookie ?? '')?.[1] ?? '';
			try { Invite = decodeURIComponent(Invite).trim().slice(0, 200); } catch { Invite = ''; }
			if (Config.Registration === 'invite' && !(await Pool.query('SELECT 1 FROM invites WHERE token_hash = $1 AND uses < max_uses AND expires_at > now()', [Hash(Invite)])).rowCount) throw new HttpError(403, Invite ? 'InvalidInvite' : 'InviteNeeded');
			if (MailConfigured(Config)) await CheckCode(Pool, NormalEmail(Email), 'signup', Code);
			let Created;
			for (let Attempt = 0; !Created; Attempt++) {
				try { Created = await CreateUser(Pool, { username: 'user' + randomInt(1e8, 1e9), password: Password, email: Email, invite: Invite }, Config.Registration, false, ClientInfo(Request, Config)); }
				catch (Error) { if (Error.message !== 'UsernameTaken' || Attempt > 4) throw Error; }
			}
			const Session = await Login(Pool, Created.username, Password, ClientInfo(Request, Config));
			const Secure = Config.SecureCookies ? '; Secure' : '';
			Response.setHeader('set-cookie', [SessionCookie(Config, Session.Token), `kittok_invite=; SameSite=Lax; Path=/; Max-Age=0${Secure}`, `passport_csrf_token=${Session.Csrf}; SameSite=Lax; Path=/; Max-Age=3600${Secure}`]);
			Json(Response, { message: 'success', data: { ...PassportUser(Session.User, Config), is_new_user: true, has_email: true } });
		} catch (Error) { if (!Error.status) throw Error; SignupError(Response, Error); }
		return true;
	}
	if (Path === '/passport/web/logout/') {
		RequireMethod(Request, ['POST']); RequireCsrf(Request, User);
		await Pool.query('DELETE FROM sessions WHERE token_hash = $1', [User.token_hash]);
		Response.setHeader('set-cookie', SessionCookie(Config, '', true));
		Json(Response, { message: 'success', data: {} }); return true;
	}
	return false;
}
