import { Escape, HttpError, Json, ReadBody, RequireMethod } from '../http.mjs';
import { CreateUser, Login, RequireCsrf, SessionCookie, ClientInfo } from '../auth.mjs';
import { DmAudiences, DmSettings, SetDmSetting } from '../store.mjs';
import { Standing, Appeal, RestrictableFeatures, ViolationFeatures, Until, AssertAllowed } from '../moderation.mjs';
import { BadgeCatalog, PrideFlag, PublicBadges } from '../badges.mjs';
import { Misc } from '../settings.mjs';

export function Page(Config, Title, Content) {
	return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${Escape(Title)} · ${Escape(Config.Name)}</title><link rel="icon" href="/brand/favicon"><link rel="stylesheet" href="/public/account.css"><body><main><a class="brand" href="/"><img src="/brand/icon" alt="">${Escape(Config.Name)}</a>${Content}</main></body></html>`;
}

const States = { good: ['Good standing', 'Your account has no active restrictions.'], at_risk: ['At risk', 'Your account is close to a strike limit. Another violation could get it permanently banned.'],
	restricted: ['Restricted', 'Some features are restricted until the time shown.'], banned: ['Banned', 'Your account is permanently banned.'] };
const Actions = { warning: 'Warning', strike: 'Strike', ban: 'Ban', none: '' };

function PrideField(Value = '') {
	return `<label>Pride flag <span class="optional">(optional)</span><select name="prideFlag" aria-describedby="pride-help"><option value="">None / prefer not to say</option>${BadgeCatalog.pride.map(Flag => `<option value="${Flag.id}"${Flag.id === Value ? ' selected' : ''}>${Flag.label}</option>`).join('')}</select></label><p id="pride-help" class="field-help">Shown publicly beside your name on your profile and posts. You can change or remove it anytime.</p>`;
}

function BadgeForm(User) {
	if (!Misc.profileBadges) return '';
	const Badges = PublicBadges(User);
	return `<section id="badges"><h2>Profile badges</h2>${Badges.length ? `<div class="badge-preview">${Badges.map(Badge => `<span><img src="${Badge.icon}" alt="">${Badge.label}</span>`).join('')}</div>` : ''}<form action="/account/badges" method="post"><input type="hidden" name="csrf" value="${Escape(User.csrf_token)}">${PrideField(User.pride_flag)}<button class="secondary">Save pride flag</button></form></section>`;
}

async function AccountStatus(Pool, Config, User) {
	const Status = await Standing(Pool, User.id, Config.Moderation);
	const [Title, Summary] = States[Status.state];
	const Limits = [...Object.entries(Status.strikes.feature).map(([Feature, Count]) => [ViolationFeatures[Feature], Count, Status.thresholds.feature]),
		...Object.entries(Status.strikes.policy).map(([Policy, Count]) => [Policy.replace('_', ' '), Count, Status.thresholds.policy[Policy] ?? Status.thresholds.feature])];
	const Restrictions = Status.restrictions.map(Row => `<li><strong>${Escape(RestrictableFeatures[Row.feature])}</strong> ${Row.expires_at ? `until ${Escape(Until(Row))}` : 'until lifted'}</li>`).join('');
	const History = Status.decisions.map(Row => {
		const Label = [Row.content_action === 'remove' ? `${{ video: 'Video', comment: 'Comment', message: 'Message' }[Row.target_type]} removed` : Row.content_action === 'fyf_ineligible' ? 'Not eligible for For You' : '', Actions[Row.account_action]].filter(Boolean).join(' · ') || 'Feature restriction';
		const Appealable = !Row.reversed_at && !Row.appeal_status;
		const State = Row.reversed_at ? 'Reversed' : Row.appeal_status === 'pending' ? 'Appeal in review' : Row.appeal_status === 'upheld' ? 'Appeal upheld' : '';
		return `<li><strong>${Escape(Label)}</strong> · ${Escape(Row.category.replace('_', ' '))}<br><span>${Escape(Row.reason)}</span><br><small>${new Date(Row.created_at).toISOString().slice(0, 10)}${State ? ` · ${State}` : ''}</small>${Appealable ? `<details><summary>Appeal</summary><form action="/account/appeal" method="post"><input type="hidden" name="csrf" value="${Escape(User.csrf_token)}"><input type="hidden" name="decision" value="${Escape(Row.id)}"><label>Why should we review this?<textarea name="reason" required maxlength="1000" rows="3"></textarea></label><button class="secondary">Submit appeal</button></form></details>` : ''}</li>`;
	}).join('');
	return `<h2>Account status</h2><p class="standing ${Status.state}"><strong>${Title}</strong> ${Escape(Summary)}</p>${Restrictions ? `<ul class="status">${Restrictions}</ul>` : ''}${Limits.length ? `<ul class="status">${Limits.map(([Name, Count, Max]) => `<li>${Escape(Name)}: ${Count} of ${Max} strikes</li>`).join('')}</ul>` : ''}${History ? `<details><summary>Violations (${Status.decisions.length})</summary><ul class="status">${History}</ul></details>` : ''}`;
}

async function MessageForm(Pool, Config, User) {
	if (Config.Features?.messages === false) return '';
	const Settings = await DmSettings(Pool, User.id);
	const Labels = { dm_setting_friends: 'Friends', dm_setting_potential_connection: 'Potential connections', dm_setting_others: 'Others' };
	const Fields = Object.keys(DmAudiences).map(Field => `<label>${Labels[Field]}<select name="${Field}">${[[1, 'Receive in inbox'], [2, 'Receive as message request'], [3, "Don't receive"]].map(([Value, Label]) => `<option value="${Value}"${Settings[Field] === Value ? ' selected' : ''}>${Label}</option>`).join('')}</select></label>`).join('');
	return `<h2>Direct messages</h2><form action="/account/messages" method="post"><input type="hidden" name="csrf" value="${Escape(User.csrf_token)}">${Fields}<label>Read status<select name="message_read_status"><option value="1"${Settings.message_read_status === 1 ? ' selected' : ''}>Share read status</option><option value="0"${Settings.message_read_status === 0 ? ' selected' : ''}>Keep read status private</option></select></label><p class="field-help">Seen is shared only when both people turn on Read status.</p><button class="secondary">Save</button></form>`;
}

export async function Account(Context) {
	const { Request, Response, Url, Pool, Config, User, Limiter } = Context;
	if (Url.pathname === '/about') {
		RequireMethod(Request, ['GET']);
		Response.setHeader('content-type', 'text/html; charset=utf-8');
		Response.end(Page(Config, 'About', `<h1>${Escape(Config.Name)}</h1><p>${Escape(Config.Description)}</p><p>Powered by Kittok 0.1.0. This is an independent instance.</p><p><a href="${Escape(Config.SourceUrl === '/about' ? '/source' : Config.SourceUrl)}">Instance source</a> · <a href="/account">Your account</a></p>`)); return true;
	}
	if (Url.pathname === '/account/appeal') {
		RequireMethod(Request, ['POST']);
		const Body = await ReadBody(Request);
		RequireCsrf(Request, User, Body.csrf);
		await Appeal(Pool, User, Body.decision, Body.reason);
		Response.writeHead(303, { location: '/account' }); Response.end(); return true;
	}
	if (Url.pathname === '/account/messages') {
		RequireMethod(Request, ['POST']);
		const Body = await ReadBody(Request);
		RequireCsrf(Request, User, Body.csrf);
		const Fields = [...Object.keys(DmAudiences), 'message_read_status'].filter(Field => Body[Field] !== undefined);
		if (Fields.some(Field => !(Field === 'message_read_status' ? ['0', '1'] : ['1', '2', '3']).includes(String(Body[Field])))) throw new HttpError(400, 'InvalidMessageSetting');
		for (const Field of Fields) await SetDmSetting(Pool, User.id, Field, Body[Field]);
		Response.writeHead(303, { location: '/account' }); Response.end(); return true;
	}
	if (Url.pathname === '/account/badges') {
		RequireMethod(Request, ['POST']);
		const Body = await ReadBody(Request);
		RequireCsrf(Request, User, Body.csrf);
		if (!Misc.profileBadges) throw new HttpError(403, 'ProfileBadgesDisabled');
		await AssertAllowed(Pool, User, 'profile');
		await Pool.query('UPDATE users SET pride_flag=$2 WHERE id=$1', [User.id, PrideFlag(Body.prideFlag)]);
		Response.writeHead(303, { location: '/account?badges=saved#badges' }); Response.end(); return true;
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
	let Content = Url.searchParams.get('badges') === 'saved' ? '<p role="status">Pride flag saved.</p>' : '';
	Content += Notice ? `<p class="error" role="alert">${Escape(Notice)}</p>` : '';
	if (User) {
		Content += `<h1>Hey, ${Escape(User.display_name)}.</h1><p>@${Escape(User.username)} · ${Escape(User.role)}</p><a class="button" href="/">Watch videos</a>${User.role === 'admin' ? '<a class="button secondary" href="/admin">Admin panel</a>' : ''}<p>${Config.Features?.upload === false ? '' : '<a href="/upload">Upload video</a> · '}<a href="/account/posts">Manage posts</a> · <a href="/account/privacy">Privacy settings</a> · <a href="/account/requests">Follow requests</a></p>${BadgeForm(User)}${await AccountStatus(Pool, Config, User)}${await MessageForm(Pool, Config, User)}<form action="/account/logout" method="post"><input type="hidden" name="csrf" value="${Escape(User.csrf_token)}"><button class="secondary">Log out</button></form>`;
	} else {
		Content += `<h1>Create your account.</h1><p>Join ${Escape(Config.Name)}.</p>`;
		if (Config.Registration !== 'closed') Content += `<form action="/account/register" method="post"><label>Username<input name="username" required pattern="[a-z0-9_]{3,24}" autocomplete="username"></label><label>Display name<input name="displayName" required maxlength="50"></label><label>Password<input name="password" type="password" required minlength="12" maxlength="256" autocomplete="new-password"></label>${PrideField()}${Config.Registration === 'invite' ? '<label>Invite code<input name="invite" required></label>' : ''}${Config.Rules ? '<p>By signing up you agree to the <a href="/rules">rules</a>.</p>' : ''}<button>Sign up</button></form>`;
		else Content += '<p>Sign-ups are closed. Ask the instance owner for an account.</p>';
		Content += '<p>Already have an account? <a href="/login">Log in</a></p>';
	}

	Response.setHeader('content-type', 'text/html; charset=utf-8');
	Response.end(Page(Config, 'Account', Content)); return true;
}
