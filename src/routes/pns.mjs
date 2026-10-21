import { pipeline } from 'node:stream/promises';
import { Escape, HttpError, Id, Json, ReadBody, RequireMethod } from '../http.mjs';
import { PasswordMatches, RequireCsrf, RecordEvent, ClientInfo, SessionCookie } from '../auth.mjs';
import { LocalAsset } from '../client/archive.mjs';
import { DataSections, ExportFiles } from '../accounts.mjs';
import { Zip } from '../zip.mjs';

const Base = '/tpp/inapp/pns_product_poseidon/';
const Font = (Name, Weight) => `@font-face{font-family:${Name.startsWith('TikTokDisplay') ? 'TikTokDisplayFont' : 'TikTokFont'};font-weight:${Weight};font-display:fallback;src:url(${LocalAsset(`https://sf16-website-login.neutral.ttwstatic.com/obj/tiktok_web_login_static/tiktok_fonts/${Name}.woff2?_default_font=1&v=2`)}) format("woff2")}`;
const DeleteDays = 30, ExportDays = 4;
const Tick = encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>');

function Page(Title, Dark, Body, Csrf, Script) {
	return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${Escape(Title)}</title>
<style>${Font('TikTokFont-Regular', 400)}${Font('TikTokFont-Semibold', 600)}${Font('TikTokFont-Bold', 700)}${Font('TikTokDisplayFont-Bold', 700)}
:root{--text:${Dark ? 'rgba(255,255,255,.9)' : 'rgba(22,24,35,1)'};--text-2:${Dark ? 'rgba(255,255,255,.6)' : 'rgba(22,24,35,.6)'};--field:${Dark ? 'rgba(255,255,255,.12)' : 'rgba(22,24,35,.06)'};--line:${Dark ? 'rgba(255,255,255,.12)' : 'rgba(22,24,35,.12)'};--neutral:${Dark ? 'rgba(255,255,255,.12)' : 'rgba(22,24,35,.06)'}}
*{box-sizing:border-box}html,body{margin:0;background:transparent;color:var(--text);font:15px/1.45 TikTokFont,Arial,Tahoma,sans-serif;-webkit-font-smoothing:antialiased}
main{max-width:560px;margin:0 auto;padding:24px 24px 32px}h1{margin:0 0 8px;font:700 24px/1.25 TikTokDisplayFont,TikTokFont,Arial,sans-serif}h2{margin:24px 0 4px;font:600 16px/1.4 TikTokFont,Arial,sans-serif}p{margin:0 0 12px;color:var(--text-2)}
ul{margin:20px 0;padding:0;list-style:none;border-top:1px solid var(--line)}li{display:flex;gap:12px;padding:14px 0;border-bottom:1px solid var(--line)}li svg{flex:none;margin-top:2px}li span{color:var(--text)}
label{display:block;margin:20px 0 8px;font-weight:600}input{width:100%;height:44px;padding:0 12px;border:0;border-radius:8px;background:var(--field);color:var(--text);font:inherit;outline:0}input:focus{box-shadow:0 0 0 1px var(--text-2)}
.Error{min-height:20px;margin:8px 0 0;color:#FF4C3A;font-size:14px}.Error:empty{min-height:0}.Actions{display:flex;flex-direction:column;gap:12px;margin-top:20px}
button{height:44px;border:0;border-radius:8px;font:600 16px TikTokFont,Arial,sans-serif;cursor:pointer}button:disabled{opacity:.5;cursor:default}.Primary{background:#FE2C55;color:#fff}.Secondary{background:var(--neutral);color:var(--text)}
a{color:inherit;font-weight:600}:focus-visible{outline:2px solid #25F4EE;outline-offset:2px}
.Tabs{display:flex;margin:20px 0 8px;border-bottom:1px solid var(--line)}[role=tab]{flex:1;border-radius:0;background:none;color:var(--text-2)}[role=tab][aria-selected=true]{color:var(--text);box-shadow:inset 0 -2px var(--text)}
.Choice,.Check{display:flex;align-items:center;gap:12px;margin:0;padding:10px 0;font-weight:400;cursor:pointer}.Choice span,.Files div{display:flex;flex-direction:column;min-width:0}.Choice b{font-weight:600}small{color:var(--text-2);font-size:14px}
.Choice input,.Check input{appearance:none;flex:none;width:20px;height:20px;padding:0;border:2px solid var(--text-2);border-radius:50%;background:none;cursor:pointer}.Choice input:checked{border:6px solid #FE2C55}
.Check input{border-radius:4px}.Check input:checked{border-color:#FE2C55;background:#FE2C55 url("data:image/svg+xml,${Tick}") center/14px no-repeat}
fieldset{margin:0 0 0 32px;padding:0;border:0}legend{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}
.Files li{align-items:center;flex-wrap:wrap}.Files div{flex:1}.Files b{font-weight:600}.Small{height:36px;padding:0 16px;font-size:15px}#Verify{flex-basis:100%}.Empty{padding:32px 0;text-align:center}</style>
<body><main data-csrf="${Escape(Csrf ?? '')}">${Body}</main>
<script>
const Main = document.querySelector('main'), Post = Action => parent.postMessage({ action: Action }, location.origin);
const Failed = Code => ({ InvalidPassword: 'Incorrect password. Try again.', LastAdmin: 'You are the only admin here. Make someone else an admin first.', TryLater: 'Too many attempts. Try again later.', ExportExpired: 'This file expired. Request your data again.', NotLoggedIn: 'Log in again to continue.' })[Code] ?? 'Something went wrong. Try again.';
for (const Back of document.querySelectorAll('[data-back]')) Back.addEventListener('click', () => Post('navigateBack'));
${Script ?? ''}
</script>`;
}

const Deactivate = `const Form = document.querySelector('form');
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
		Error.textContent = Failed(Failure.message);
		Button.disabled = false;
	}
});`;

const Download = `const Tabs = [...document.querySelectorAll('[role="tab"]')], Params = new URLSearchParams(location.search);
const Show = Tab => { for (const Other of Tabs) { Other.setAttribute('aria-selected', Other === Tab); Other.tabIndex = Other === Tab ? 0 : -1; document.getElementById(Other.getAttribute('aria-controls')).hidden = Other !== Tab; } };
for (const Tab of Tabs) {
	Tab.addEventListener('click', () => Show(Tab));
	Tab.addEventListener('keydown', Event => { const Step = { ArrowRight: 1, ArrowLeft: -1 }[Event.key]; if (Step) { const Next = Tabs[(Tabs.indexOf(Tab) + Step + Tabs.length) % Tabs.length]; Show(Next); Next.focus(); } });
}
for (const Time of document.querySelectorAll('time')) Time.textContent = new Date(Time.dateTime).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
const RequestForm = document.getElementById('RequestPanel'), Sections = RequestForm.querySelector('fieldset');
RequestForm.addEventListener('change', () => { Sections.hidden = Sections.disabled = RequestForm.elements.scope.value !== 'custom'; });
RequestForm.addEventListener('submit', async Event => {
	Event.preventDefault();
	const Button = RequestForm.querySelector('button[type="submit"]'), Error = RequestForm.querySelector('.Error');
	const Custom = RequestForm.elements.scope.value === 'custom', Picked = [...RequestForm.querySelectorAll('[name="section"]:checked')].map(Input => Input.value);
	Error.textContent = '';
	if (Custom && !Picked.length) { Error.textContent = 'Select at least one type of data.'; return; }
	Button.disabled = true;
	try {
		const Response = await fetch('/api/v1/account/data', { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': Main.dataset.csrf }, body: JSON.stringify({ format: RequestForm.elements.format.value, sections: Custom ? Picked : [] }) });
		const Data = await Response.json().catch(() => ({}));
		if (!Response.ok) throw new globalThis.Error(Data.error ?? 'CouldntSave');
		const Next = new URL(location.href); Next.searchParams.set('tab', 'download'); location.replace(Next);
	} catch (Failure) {
		Error.textContent = Failed(Failure.message);
		Button.disabled = false;
	}
});
const Verify = document.getElementById('Verify');
const Hide = () => { Verify.hidden = true; Verify.elements.password.value = ''; };
for (const Button of document.querySelectorAll('[data-download]')) Button.addEventListener('click', () => {
	Button.closest('li').append(Verify); Verify.hidden = false; Verify.elements.id.value = Button.dataset.download;
	Verify.querySelector('.Error').textContent = ''; Verify.elements.password.focus();
});
Verify.querySelector('[data-cancel]').addEventListener('click', Hide);
Verify.addEventListener('submit', () => setTimeout(Hide));
if (Params.has('error')) {
	const Button = [...document.querySelectorAll('[data-download]')].find(Item => Item.dataset.download === Params.get('id'));
	if (Button) Button.click();
	(Button ? Verify.querySelector('.Error') : document.getElementById('DownloadError')).textContent = Failed(Params.get('error'));
	for (const Key of ['error', 'id']) Params.delete(Key);
	history.replaceState(null, '', '?' + Params);
}`;

const Check = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';
const Item = Text => `<li>${Check}<span>${Text}</span></li>`;
const Confirm = (Mode, Label) => `<form data-mode="${Mode}"><label for="password">Enter your password to continue</label><input id="password" name="password" type="password" autocomplete="current-password" required>
<p class="Error" role="alert"></p><div class="Actions"><button class="Primary" type="submit">${Label}</button><button class="Secondary" type="button" data-back>Cancel</button></div></form>`;
const Covers = Sections => Sections.length === Object.keys(DataSections).length ? 'All data' : Sections.map(Key => DataSections[Key]).join(', ');
const Choice = (Name, Value, Label, Note = '') => `<label class="Choice"><input type="radio" name="${Name}" value="${Value}"${Value === 'all' || Value === 'txt' ? ' checked' : ''}><span><b>${Label}</b>${Note && `<small>${Note}</small>`}</span></label>`;
const When = Value => `<time datetime="${Value.toISOString()}">${Value.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}</time>`;

async function DataPage(Pool, User, Tab, Dark) {
	const Exports = (await Pool.query('SELECT id, format, sections, created_at, expires_at FROM data_exports WHERE user_id = $1 AND expires_at > now() ORDER BY id DESC', [User.id])).rows;
	const Panel = (Name, Html) => Html.replace('>', ` id="${Name}Panel" role="tabpanel" aria-labelledby="${Name}Tab"${Tab === Name ? '' : ' hidden'}>`);
	return `<h1>Download your data</h1><p>Get a copy of your profile, posts, activity, and messages.</p>
<div class="Tabs" role="tablist">${[['Request', 'Request data'], ['Download', 'Download data']].map(([Name, Label]) => `<button type="button" role="tab" id="${Name}Tab" aria-controls="${Name}Panel" aria-selected="${Tab === Name}" tabindex="${Tab === Name ? 0 : -1}">${Label}</button>`).join('')}</div>
${Panel('Request', `<form><h2>Select data to download</h2>${Choice('scope', 'all', 'All data')}${Choice('scope', 'custom', 'Custom')}
<fieldset hidden disabled><legend>Data to include</legend>${Object.entries(DataSections).map(([Key, Label]) => `<label class="Check"><input type="checkbox" name="section" value="${Key}" checked><span>${Label}</span></label>`).join('')}</fieldset>
<h2>Select file format</h2>${Choice('format', 'txt', 'TXT', 'Easy-to-read text file')}${Choice('format', 'json', 'JSON', 'Machine-readable file')}
<p class="Error" role="alert"></p><div class="Actions"><button class="Primary" type="submit">Request data</button></div></form>`)}
${Panel('Download', `<section><p>Files are available for ${ExportDays} days.</p><p class="Error" role="alert" id="DownloadError"></p>
${Exports.length ? `<ul class="Files">${Exports.map(Row => `<li><div><b>Requested ${When(Row.created_at)}</b><small>${Row.format.toUpperCase()} · ${Escape(Covers(Row.sections))} · Expires ${When(Row.expires_at)}</small></div><button class="Primary Small" type="button" data-download="${Row.id}">Download</button></li>`).join('')}</ul>` : '<p class="Empty">No files yet</p>'}
<form id="Verify" method="post" action="/api/v1/account/data/download" hidden><input type="hidden" name="id"><input type="hidden" name="csrf" value="${Escape(User.csrf_token)}"><input type="hidden" name="isDark" value="${Dark}">
<label for="password">Enter your password to download</label><input id="password" name="password" type="password" autocomplete="current-password" required>
<p class="Error" role="alert"></p><div class="Actions"><button class="Primary" type="submit">Download</button><button class="Secondary" type="button" data-cancel>Cancel</button></div></form></section>`)}`;
}

export async function Pns(Context) {
	const { Request, Response, Url, Pool, Config, User, Limiter } = Context;
	const Path = Url.pathname;
	if (Path.startsWith(Base) || Path === '/ppp') {
		RequireMethod(Request, ['GET']);
		const Name = Path.slice(Base.length), Dark = !['0', 'false'].includes(Url.searchParams.get('isDark'));
		let Title, Body, Script = Deactivate;
		if (!User) [Title, Body] = ['Log in', '<h1>Log in to continue</h1><p>Your session ended. Log in again to manage your account.</p>'];
		else if (Path === '/ppp') [Title, Body, Script] = ['Download your data', await DataPage(Pool, User, Url.searchParams.get('tab') === 'download' ? 'Download' : 'Request', Dark), Download];
		else if (Name === 'account_deactivate_webapp.html') {
			Title = 'Deactivate account';
			Body = `<h1>Deactivate account?</h1><p>@${Escape(User.username)}</p><ul>${Item('Your profile, videos, comments, and messages are hidden while your account is deactivated.')}${Item('Log in anytime to reactivate it and get everything back.')}</ul>${Confirm('deactivate', 'Deactivate account')}`;
		} else if (Name === 'account_delete_new_webapp.html') {
			Title = 'Delete account';
			Body = `<h1>Delete account permanently?</h1><p>@${Escape(User.username)}</p><ul>${Item(`Your account is deactivated now and permanently deleted after ${DeleteDays} days.`)}${Item(`Log in within ${DeleteDays} days to cancel the deletion and keep your account.`)}${Item('After that, your profile, videos, comments, likes, and messages can’t be recovered.')}${Item('Want a copy first? <a href="/setting/download-your-data" target="_top">Download your data</a> before you go.')}</ul>${Confirm('delete', 'Delete account')}`;
		} else if (Name === 'non_org_admin_block.html') [Title, Body] = ['Account', '<h1>You can manage this account</h1><p>Go back to continue.</p>'];
		else throw new HttpError(404, 'NotFound');
		Response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src 'self'; connect-src 'self'; frame-ancestors 'self'; form-action 'self'; base-uri 'none'; object-src 'none'" });
		Response.end(Page(Title, Dark, Body, User?.csrf_token, Script)); return true;
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
	if (Path === '/api/v1/account/data') {
		RequireMethod(Request, ['POST']); RequireCsrf(Request, User);
		Limiter.Hit(`datarequest:${User.id}`, 5, 3600000);
		const Body = await ReadBody(Request);
		if (!['txt', 'json'].includes(Body.format)) throw new HttpError(400, 'InvalidFormat');
		const Picked = Body.sections ?? [];
		if (!Array.isArray(Picked) || !Picked.every(Key => Object.hasOwn(DataSections, Key))) throw new HttpError(400, 'InvalidSection');
		const Sections = Object.keys(DataSections).filter(Key => !Picked.length || Picked.includes(Key));
		const Export = (await Pool.query(`INSERT INTO data_exports(user_id, format, sections, expires_at) VALUES ($1, $2, $3, now() + make_interval(days => ${ExportDays})) RETURNING id, expires_at`, [User.id, Body.format, Sections])).rows[0];
		await Pool.query('DELETE FROM data_exports WHERE user_id = $1 AND id NOT IN (SELECT id FROM data_exports WHERE user_id = $1 ORDER BY id DESC LIMIT 3)', [User.id]);
		await RecordEvent(Pool, User.id, 'data_requested', ClientInfo(Request, Config), `${Body.format.toUpperCase()}, ${Covers(Sections).toLowerCase()}`);
		Json(Response, { ok: true, id: String(Export.id), expiresAt: Export.expires_at }); return true;
	}
	if (Path === '/api/v1/account/data/download') {
		RequireMethod(Request, ['POST']);
		const Body = await ReadBody(Request);
		let Export;
		try {
			RequireCsrf(Request, User, Body.csrf);
			Limiter.Hit(`datadownload:${User.id}`, 10, 600000);
			Export = (await Pool.query('SELECT * FROM data_exports WHERE id = $1 AND user_id = $2 AND expires_at > now()', [Id(Body.id), User.id])).rows[0];
			if (!Export) throw new HttpError(404, 'ExportExpired');
			const Account = (await Pool.query('SELECT password_hash FROM users WHERE id = $1', [User.id])).rows[0];
			if (!(await PasswordMatches(String(Body.password ?? ''), Account.password_hash))) throw new HttpError(403, 'InvalidPassword');
		} catch (Failure) {
			if (!(Failure instanceof HttpError)) throw Failure;
			Response.writeHead(303, { location: `/ppp?${new URLSearchParams({ isDark: Body.isDark === 'false' ? 'false' : 'true', tab: 'download', id: String(Body.id ?? '').slice(0, 20), error: Failure.message })}` });
			Response.end(); return true;
		}
		const Files = await ExportFiles(Pool, Config, Export);
		await RecordEvent(Pool, User.id, 'data_downloaded', ClientInfo(Request, Config), Covers(Export.sections));
		Response.writeHead(200, { 'content-type': 'application/zip', 'content-disposition': `attachment; filename="${Config.Name.replace(/[^A-Za-z0-9-]+/g, '_').replace(/^_+|_+$/g, '') || 'Kittok'}_Data_${Math.floor(Date.now() / 1000)}.zip"`, 'cache-control': 'no-store' });
		await pipeline(Zip(Files), Response).catch(() => Response.destroy());
		return true;
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
