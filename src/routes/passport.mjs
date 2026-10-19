import { Login, RequireCsrf, SessionCookie, ClientInfo, RecordEvent } from '../auth.mjs';
import { HttpError, Json, ReadBody, RequireMethod } from '../http.mjs';
import { AvatarUrl } from '../store.mjs';

export function DecodePassportValue(Value, Mixed) {
	if (typeof Value !== 'string' || Value.length > 2048) throw new HttpError(400, 'InvalidLogin');
	if (!Mixed) return Value;
	if (!/^(?:[a-fA-F0-9]{2})*$/.test(Value)) throw new HttpError(400, 'InvalidLogin');
	const Bytes = Buffer.from(Value, 'hex');
	for (let Index = 0; Index < Bytes.length; Index++) Bytes[Index] ^= 5;
	try { return new TextDecoder('utf-8', { fatal: true }).decode(Bytes); }
	catch { throw new HttpError(400, 'InvalidLogin'); }
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
			const Description = { 429: 'Too many attempts. Try again later.', 403: 'This account is suspended.' }[Error.status] ?? 'Username or password is incorrect.';
			Json(Response, { message: 'error', data: { error_code: Error.status === 429 ? 7 : 1001, description: Description } });
		}
		return true;
	}
	if (['/passport/web/account/info/', '/passport/account/info/v2/'].includes(Path)) {
		RequireMethod(Request, ['GET']);
		Json(Response, User ? { message: 'success', data: PassportUser(User, Config) } : { message: 'error', data: { error_code: 8, description: 'NotLoggedIn' } }); return true;
	}
	if (Path === '/passport/web/login_name/update/') {
		RequireMethod(Request, ['POST']); RequireCsrf(Request, User);
		Limiter.Hit(`username:${User.id}`, 5, 3600000);
		const Name = String((await ReadBody(Request)).login_name ?? Url.searchParams.get('login_name') ?? '').trim().toLowerCase();
		if (!/^[a-z0-9_]{3,24}$/.test(Name)) { Json(Response, { message: 'error', data: { error_code: 1027, description: 'Use 3 to 24 lowercase letters, numbers, or underscores.' } }); return true; }
		try {
			const Updated = (await Pool.query('UPDATE users SET username = $2 WHERE id = $1 RETURNING id, username, display_name, avatar_name', [User.id, Name])).rows[0];
			if (Name !== User.username) await RecordEvent(Pool, User.id, 'username_change', ClientInfo(Request, Config), `@${User.username} → @${Name}`);
			Json(Response, { message: 'success', data: PassportUser(Updated, Config) });
		} catch (Error) {
			if (Error.code !== '23505') throw Error;
			Json(Response, { message: 'error', data: { error_code: 1024, description: 'This username is taken.' } });
		}
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
