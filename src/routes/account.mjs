import { Escape, Json, ReadBody, RequireMethod } from '../http.mjs';
import { CreateUser, Login, RequireCsrf, SessionCookie, ClientInfo } from '../auth.mjs';

export function Page(Config, Title, Content) {
	return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${Escape(Title)} · ${Escape(Config.Name)}</title><link rel="icon" href="/brand/favicon"><link rel="stylesheet" href="/public/account.css"><body><main><a class="brand" href="/"><img src="/brand/icon" alt="">${Escape(Config.Name)}</a>${Content}</main></body></html>`;
}

export async function Account(Context) {
	const { Request, Response, Url, Pool, Config, User, Limiter } = Context;
	if (Url.pathname === '/about') {
		RequireMethod(Request, ['GET']);
		Response.setHeader('content-type', 'text/html; charset=utf-8');
		Response.end(Page(Config, 'About', `<h1>${Escape(Config.Name)}</h1><p>${Escape(Config.Description)}</p><p>Powered by Kittok 0.1.0. This is an independent instance.</p><p><a href="${Escape(Config.SourceUrl === '/about' ? '/source' : Config.SourceUrl)}">Instance source</a> · <a href="/account">Your account</a></p>`)); return true;
	}
	if (Url.pathname === '/account/login' || Url.pathname === '/account/register' || Url.pathname === '/account/logout') {
		RequireMethod(Request, ['POST']);
		Limiter.Hit(`account:${Request.socket.remoteAddress}`, 10);
		const Body = await ReadBody(Request);
		if (Url.pathname.endsWith('/logout')) {
			RequireCsrf(Request, User, Body.csrf);
			await Pool.query('DELETE FROM sessions WHERE token_hash = $1', [User.token_hash]);
			Response.setHeader('set-cookie', SessionCookie(Config, '', true));
		} else {
			if (Url.pathname.endsWith('/register')) await CreateUser(Pool, Body, Config.Registration, false, ClientInfo(Request, Config));
			const Session = await Login(Pool, Body.username, Body.password, ClientInfo(Request, Config));
			Response.setHeader('set-cookie', SessionCookie(Config, Session.Token));
		}
		Response.writeHead(303, { location: '/account' }); Response.end(); return true;
	}
	if (Url.pathname !== '/account') return false;
	RequireMethod(Request, ['GET']);
	if (!User && !Url.searchParams.has('register')) {
		Response.writeHead(303, { location: '/login' }); Response.end(); return true;
	}
	const Notice = Url.searchParams.get('error');
	let Content = Notice ? `<p class="error" role="alert">${Escape(Notice)}</p>` : '';
	if (User) {
		Content += `<h1>Hey, ${Escape(User.display_name)}.</h1><p>@${Escape(User.username)} · ${Escape(User.role)}</p><a class="button" href="/">Watch videos</a>${User.role === 'admin' ? '<a class="button secondary" href="/admin">Admin panel</a>' : ''}${Config.Features?.upload === false ? '' : '<h2>Upload a video</h2>'}<form id="upload"${Config.Features?.upload === false ? ' hidden' : ''}><label>Video<input required name="video" type="file" accept="video/*"></label><label>Caption<textarea name="description" maxlength="2200" rows="3"></textarea></label><button>Upload</button><p id="status" role="status"></p></form><form action="/account/logout" method="post"><input type="hidden" name="csrf" value="${Escape(User.csrf_token)}"><button class="secondary">Log out</button></form><script id="upload-config" type="application/json">${JSON.stringify({ csrf: User.csrf_token }).replaceAll('<', '\\u003c')}</script><script src="/public/upload.js"></script>`;
	} else {
		Content += `<h1>Welcome to ${Escape(Config.Name)}.</h1><p>This account belongs to this instance.</p><form action="/account/login" method="post"><label>Username<input name="username" autocomplete="username" required minlength="3" maxlength="24"></label><label>Password<input name="password" type="password" autocomplete="current-password" required maxlength="256"></label><button>Log in</button></form>`;
		if (Config.Registration !== 'closed') Content += `<details><summary>Create an account</summary><form action="/account/register" method="post"><label>Username<input name="username" required pattern="[a-z0-9_]{3,24}" autocomplete="username"></label><label>Display name<input name="displayName" required maxlength="50"></label><label>Password<input name="password" type="password" required minlength="12" maxlength="256" autocomplete="new-password"></label>${Config.Registration === 'invite' ? '<label>Invite code<input name="invite" required></label>' : ''}${Config.Rules ? '<p>By signing up you agree to the <a href="/rules">rules</a>.</p>' : ''}<button>Sign up</button></form></details>`;
		else Content += '<p>Sign-ups are closed. Ask the instance owner for an account.</p>';
	}
	Response.setHeader('content-type', 'text/html; charset=utf-8');
	Response.end(Page(Config, 'Account', Content)); return true;
}
