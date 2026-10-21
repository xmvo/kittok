import { Escape, HttpError, Json, ReadBody, RequireMethod } from '../http.mjs';
import { PasswordMatches, RequireCsrf, RecordEvent, ClientInfo, SessionCookie } from '../auth.mjs';
import { LocalAsset } from '../client/archive.mjs';

const Base = '/tpp/inapp/pns_product_poseidon/';
const Font = (Name, Weight) => `@font-face{font-family:${Name.startsWith('TikTokDisplay') ? 'TikTokDisplayFont' : 'TikTokFont'};font-weight:${Weight};font-display:fallback;src:url(${LocalAsset(`https://sf16-website-login.neutral.ttwstatic.com/obj/tiktok_web_login_static/tiktok_fonts/${Name}.woff2?_default_font=1&v=2`)}) format("woff2")}`;
const DeleteDays = 30;

function Page(Title, Dark, Body, Csrf) {
	return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${Escape(Title)}</title>
<style>${Font('TikTokFont-Regular', 400)}${Font('TikTokFont-Semibold', 600)}${Font('TikTokFont-Bold', 700)}${Font('TikTokDisplayFont-Bold', 700)}
:root{--text:${Dark ? 'rgba(255,255,255,.9)' : 'rgba(22,24,35,1)'};--text-2:${Dark ? 'rgba(255,255,255,.6)' : 'rgba(22,24,35,.6)'};--field:${Dark ? 'rgba(255,255,255,.12)' : 'rgba(22,24,35,.06)'};--line:${Dark ? 'rgba(255,255,255,.12)' : 'rgba(22,24,35,.12)'};--neutral:${Dark ? 'rgba(255,255,255,.12)' : 'rgba(22,24,35,.06)'}}
*{box-sizing:border-box}html,body{margin:0;background:transparent;color:var(--text);font:15px/1.45 TikTokFont,Arial,Tahoma,sans-serif;-webkit-font-smoothing:antialiased}
main{max-width:560px;margin:0 auto;padding:24px 24px 32px}h1{margin:0 0 8px;font:700 24px/1.25 TikTokDisplayFont,TikTokFont,Arial,sans-serif}p{margin:0 0 12px;color:var(--text-2)}
ul{margin:20px 0;padding:0;list-style:none;border-top:1px solid var(--line)}li{display:flex;gap:12px;padding:14px 0;border-bottom:1px solid var(--line)}li svg{flex:none;margin-top:2px}li span{color:var(--text)}
label{display:block;margin:20px 0 8px;font-weight:600}input{width:100%;height:44px;padding:0 12px;border:0;border-radius:8px;background:var(--field);color:var(--text);font:inherit;outline:0}input:focus{box-shadow:0 0 0 1px var(--text-2)}
.Error{min-height:20px;margin:8px 0 0;color:#FF4C3A;font-size:14px}.Actions{display:flex;flex-direction:column;gap:12px;margin-top:20px}
button{height:44px;border:0;border-radius:8px;font:600 16px TikTokFont,Arial,sans-serif;cursor:pointer}button:disabled{opacity:.5;cursor:default}.Primary{background:#FE2C55;color:#fff}.Secondary{background:var(--neutral);color:var(--text)}
a{color:inherit;font-weight:600}:focus-visible{outline:2px solid #25F4EE;outline-offset:2px}</style>
<body><main data-csrf="${Escape(Csrf ?? '')}">${Body}</main>
<script>
const Main = document.querySelector('main'), Post = Action => parent.postMessage({ action: Action }, location.origin);
for (const Back of document.querySelectorAll('[data-back]')) Back.addEventListener('click', () => Post('navigateBack'));
for (const Settings of document.querySelectorAll('[data-settings]')) Settings.addEventListener('click', Event => { Event.preventDefault(); Post('navigateToSettings'); });
const Form = document.querySelector('form');
Form?.addEventListener('submit', async Event => {
	Event.preventDefault();
	const Button = Form.querySelector('button[type="submit"]'), Error = Form.querySelector('.Error');
	Button.disabled = true; Error.textContent = '';
	try {
		const Response = await fetch('/api/v1/account/deactivate', { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': Main.dataset.csrf }, body: JSON.stringify({ password: Form.elements.password.value, delete: Form.dataset.mode === 'delete' }) });
		const Data = await Response.json().catch(() => ({}));
		if (!Response.ok) throw new globalThis.Error(Data.error ?? 'CouldntSave');
		Post('flowComplete'); top.location.href = '/';
	} catch (Failure) {
		Error.textContent = { InvalidPassword: 'Incorrect password. Try again.', LastAdmin: 'You are the only admin here. Make someone else an admin first.', TryLater: 'Too many attempts. Try again later.' }[Failure.message] ?? 'Something went wrong. Try again.';
		Button.disabled = false;
	}
});
</script>`;
}

const Check = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';
const Item = Text => `<li>${Check}<span>${Text}</span></li>`;
const Confirm = (Mode, Label) => `<form data-mode="${Mode}"><label for="password">Enter your password to continue</label><input id="password" name="password" type="password" autocomplete="current-password" required>
<p class="Error" role="alert"></p><div class="Actions"><button class="Primary" type="submit">${Label}</button><button class="Secondary" type="button" data-back>Cancel</button></div></form>`;

export async function Pns(Context) {
	const { Request, Response, Url, Pool, Config, User, Limiter } = Context;
	const Path = Url.pathname;
	if (Path.startsWith(Base)) {
		RequireMethod(Request, ['GET']);
		const Name = Path.slice(Base.length), Dark = Url.searchParams.get('isDark') !== '0';
		let Title, Body;
		if (!User) [Title, Body] = ['Log in', '<h1>Log in to continue</h1><p>Your session ended. Log in again to manage your account.</p>'];
		else if (Name === 'account_deactivate_webapp.html') {
			Title = 'Deactivate account';
			Body = `<h1>Deactivate account?</h1><p>@${Escape(User.username)}</p><ul>${Item('Your profile, videos, comments, and messages are hidden while your account is deactivated.')}${Item('Log in anytime to reactivate it and get everything back.')}</ul>${Confirm('deactivate', 'Deactivate account')}`;
		} else if (Name === 'account_delete_new_webapp.html') {
			Title = 'Delete account';
			Body = `<h1>Delete account permanently?</h1><p>@${Escape(User.username)}</p><ul>${Item(`Your account is deactivated now and permanently deleted after ${DeleteDays} days.`)}${Item(`Log in within ${DeleteDays} days to cancel the deletion and keep your account.`)}${Item('After that, your profile, videos, comments, likes, and messages can’t be recovered.')}${Item('Want a copy first? <a href="/setting" data-settings>Download your data</a> before you go.')}</ul>${Confirm('delete', 'Delete account')}`;
		} else if (Name === 'non_org_admin_block.html') [Title, Body] = ['Account', '<h1>You can manage this account</h1><p>Go back to continue.</p>'];
		else throw new HttpError(404, 'NotFound');
		Response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; font-src 'self'; connect-src 'self'; frame-ancestors 'self'; form-action 'self'; base-uri 'none'; object-src 'none'" });
		Response.end(Page(Title, Dark, Body, User?.csrf_token)); return true;
	}
	if (Path === '/tiktok/pns/bff/account/questionnaire/config') {
		RequireMethod(Request, ['GET']);
		const Option = (Key, Text, Extra = {}) => ({ key: Key, optionText: Text, extraLinks: [], extraInput: false, ...Extra });
		Json(Response, { status_code: 0, questionnaireOptions: [
			Option(1, 'I want to take a break', { descriptionText: 'You can deactivate your account instead. Your profile is hidden until you log back in.', extraLinks: [{ key: 'deactivateAccount', type: 'url-iframe', text: 'Deactivate account' }] }),
			Option(2, 'I’m worried about my privacy'), Option(3, 'I’m getting too many notifications'), Option(4, 'I don’t find it interesting anymore'),
			Option(5, 'I have another account'), Option(6, 'Something else', { extraInput: true }),
		] }); return true;
	}
	if (Path === '/tiktok/account/deletion/questionnaire/submit/v1/') {
		RequireMethod(Request, ['POST']);
		Json(Response, { status_code: 0 }); return true;
	}
	if (Path === '/logout') {
		RequireMethod(Request, ['GET', 'HEAD']);
		Response.writeHead(303, { location: '/' }); Response.end(); return true;
	}
	if (Path === '/api/v1/account/deactivate') {
		RequireMethod(Request, ['POST']); RequireCsrf(Request, User);
		Limiter.Hit(`deactivate:${User.id}`, 5, 600000);
		const Body = await ReadBody(Request);
		const Account = (await Pool.query('SELECT password_hash, role FROM users WHERE id = $1', [User.id])).rows[0];
		if (typeof Body.password !== 'string' || !(await PasswordMatches(Body.password, Account.password_hash))) throw new HttpError(403, 'InvalidPassword');
		if (Account.role === 'admin' && !(await Pool.query("SELECT 1 FROM users WHERE role = 'admin' AND id <> $1 AND suspended_at IS NULL", [User.id])).rowCount) throw new HttpError(409, 'LastAdmin');
		const Delete = Body.delete === true;
		const Updated = (await Pool.query(`UPDATE users SET deactivated_at = now(), suspended_at = coalesce(suspended_at, now()), delete_after = CASE WHEN $2 THEN now() + make_interval(days => ${DeleteDays}) END WHERE id = $1 RETURNING delete_after`, [User.id, Delete])).rows[0];
		await Pool.query('DELETE FROM sessions WHERE user_id = $1', [User.id]);
		await RecordEvent(Pool, User.id, 'deactivated', ClientInfo(Request, Config), Delete ? `Deletion scheduled for ${Updated.delete_after.toISOString().slice(0, 10)}` : '');
		Response.setHeader('set-cookie', SessionCookie(Config, '', true));
		Json(Response, { ok: true, deleteAfter: Updated.delete_after }); return true;
	}
	return false;
}
