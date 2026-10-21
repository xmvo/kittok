import { ReadJsonScript, ReplaceJsonScript, RewriteAssets } from './archive.mjs';
import { AvatarUrl } from '../store.mjs';
import { Misc } from '../settings.mjs';
import { statSync } from 'node:fs';

export const Public = Name => `/public/${Name}?v=${Math.trunc(statSync(new URL(`../../public/${Name}`, import.meta.url)).mtimeMs).toString(36)}`;

const Slot = Name => `[class*="DivMainNavContainer"] > :has([data-e2e="${Name}"])`;
const FeatureSelectors = {
	shop: [Slot('nav-shop')], explore: [Slot('nav-explore')], following: [Slot('nav-following')], shortDrama: [Slot('nav-short-drama')], live: [Slot('nav-live')],
	upload: [Slot('nav-upload'), 'a[href^="/tiktokstudio/upload"]'], search: ['[data-e2e="nav-search"]', '[data-e2e="search-user-input"]'],
	comments: ['[data-e2e="comment-input"]', '[data-e2e="comment-post"]'], messages: [Slot('nav-messages')],
};

export function Shell(Raw, Origin, { Config, User } = {}) {
	const State = ReadJsonScript(Raw, '__UNIVERSAL_DATA_FOR_REHYDRATION__');
	const Scope = State.__DEFAULT_SCOPE__;
	const Legacy = Raw.includes('id="SIGI_STATE"') ? ReadJsonScript(Raw, 'SIGI_STATE') : null;
	const App = Scope['webapp.app-context'];
	const LoginCopy = Scope['webapp.i18n-translation']?.Webapp;
	for (const Copy of [LoginCopy, Scope['webapp.i18n-translation']?.WebApp_Login]) {
		if (!Copy) continue;
		Copy.common_login_panel_title = `Log in to ${Config?.Name ?? 'Kittok'}`;
		Copy.common_registration_panel_title = `Sign up for ${Config?.Name ?? 'Kittok'}`;
	}
	Object.assign(App, { host: new URL(Origin).host, wid: '1000000000000000000', odinId: '1000000000000000000',
		encryptedWebid: '', csrfToken: User?.csrf_token ?? '', nonce: '', requestId: 'local', botType: 'others' });
	if (User) {
		App.user = {
			uid: User.id, secUid: User.id, uniqueId: User.username, nickName: User.display_name,
			signature: User.bio ?? '', avatarUri: [AvatarUrl(User, Origin)], verified: Misc.verifiedBadges && Boolean(User.verified),
			ftcUser: false, isPrivateAccount: Boolean(User.private_account), region: App.region, storeRegion: App.region,
			hasSearchPermission: true, hasIMPermission: Config?.Features?.messages !== false, hasLivePermission: false,
			hasSearchLivePermission: false, hasExtendedViewingPermission: false,
			roomId: '', suggestAccountBind: false, showPrivateBanner: false, showScheduleTips: false,
			redDot: [], proAccountInfo: { status: 0, analyticsOn: false, businessSuiteEntrance: false, downloadLink: {} },
		};
	} else delete App.user;
	const Parameters = App.abTestVersion.parameters;
	for (const Name of ['pc_web_age_gate', 'browser_mode_encourage_login', 'browser_login_redirect', 'login_google_onetap', 'login_boost', 'webapp_nu_fyp_content']) {
		Parameters[Name] = { vid: 'v0' };
	}
	if (Legacy?.AppContext) Legacy.AppContext.appContext = App;
	const Biz = Scope['webapp.biz-context'] ?? Legacy?.BizContext?.bizContext;
	if (Biz) {
		Biz.forceLoginSpecialRegions = [];
		Biz.hashedIP = '';
		Biz.apiKeys = {};
		Biz.geo = [];
		Biz.geoCity = {};
		Biz.config.signUpOpen = Config?.Registration !== 'closed';
		Biz.deviceLimitRegisterExpired = false;
	}
	const Domains = ReadJsonScript(Raw, 'api-domains');
	for (const Key of ['rootApi', 'mTApi', 'imApi', 'webcastApi', 'webcastRootApi', 'locationApi', 'starling', 'tea', 'libraWebSDK', 'secSDK']) Domains[Key] = Origin;
	Domains.captcha = Origin;
	Domains.imFrontier = Origin.replace('http', 'ws') + '/ws/v2';
	if (Biz) Biz.domains = Domains;
	if (Legacy?.LoginContextModule) {
		Legacy.LoginContextModule.ttpConfig = { open: false, syncSeverList: [] };
		Legacy.LoginContextModule.disableSignup = Config?.Registration === 'closed';
		Legacy.LoginContextModule.signupConfig.enable = Config?.Registration !== 'closed';
		Legacy.LoginContextModule.redirectUrl = Origin;
	}
	let Html = ReplaceJsonScript(Raw, '__UNIVERSAL_DATA_FOR_REHYDRATION__', State);
	if (Legacy) Html = ReplaceJsonScript(Html, 'SIGI_STATE', Legacy);
	Html = ReplaceJsonScript(Html, 'api-domains', Domains);
	Html = Html.replace(/<script\b[^>]*\bsrc="[^"]*"[^>]*>\s*<\/script>/g, Tag => {
		return /data-chunk=|slardar\.web\.pre\.js|browser\.oci\.js/.test(Tag) ? Tag : '';
	});
	Html = Html.replace(/<link\b[^>]*\brel="(?:preconnect|dns-prefetch|canonical|alternate|manifest)"[^>]*>/g, '');
	Html = Html.replace(/\s+(?:integrity|nonce)="[^"]*"/g, '');
	Html = RewriteAssets(Html, Origin);
	const Instance = { name: Config?.Name ?? 'Kittok', account: User ? { username: User.username, displayName: User.display_name, role: User.role } : null, csrfToken: User?.csrf_token ?? null, misc: { ...Misc }, registration: Config?.Registration ?? 'closed', mail: Boolean(Config?.SmtpUrl && Config?.MailFrom), announcement: Config?.Announcement?.text ? Config.Announcement : null };
	const Hidden = Object.entries(Config?.Features ?? {}).filter(([, On]) => !On).flatMap(([Name]) => FeatureSelectors[Name] ?? []);
	Html = Html.replace(/<title>[\s\S]*?<\/title>/, `<title>${Instance.name.replace(/[<&]/g, '')}</title>`);
	return Html.replace('<head>', `<head><link rel="icon" href="/brand/favicon"><link rel="stylesheet" href="${Public('brand.css')}"><link rel="stylesheet" href="${Public('user-badges.css')}"><link rel="stylesheet" href="${Public('responsive.css')}"><script src="${Public('user-badges.js')}" defer></script><script src="${Public('message-actions.js')}" defer></script>${Hidden.length ? `<style>${Hidden.join(',')}{display:none!important}</style>` : ''}<script id="kittok-instance" type="application/json">${JSON.stringify(Instance).replaceAll('<', '\\u003c')}</script><script src="/_kittok/bridge.js"></script>`);
}
