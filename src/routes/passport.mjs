import { Login, RequireCsrf, SessionCookie } from '../auth.mjs';
import { HttpError, Json, ReadBody, RequireMethod } from '../http.mjs';

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
		avatar_url: `${Config.Origin}/public/avatar.svg`, user_verified: false,
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
			const Session = await Login(Pool, Username, Password);
			Response.setHeader('set-cookie', SessionCookie(Config, Session.Token));
			Json(Response, { message: 'success', data: PassportUser(Session.User, Config) });
		} catch (Error) {
			if (!Error.status) throw Error;
			Json(Response, { message: 'error', data: { error_code: Error.status === 429 ? 7 : 1001, description: Error.status === 429 ? 'Too many attempts. Try again later.' : 'Username or password is incorrect.' } });
		}
		return true;
	}
	if (['/passport/web/account/info/', '/passport/account/info/v2/'].includes(Path)) {
		RequireMethod(Request, ['GET']);
		Json(Response, User ? { message: 'success', data: PassportUser(User, Config) } : { message: 'error', data: { error_code: 8, description: 'NotLoggedIn' } }); return true;
	}
	if (Path === '/passport/web/logout/') {
		RequireMethod(Request, ['POST']); RequireCsrf(Request, User);
		await Pool.query('DELETE FROM sessions WHERE token_hash = $1', [User.token_hash]);
		Response.setHeader('set-cookie', SessionCookie(Config, '', true));
		Json(Response, { message: 'success', data: {} }); return true;
	}
	return false;
}
