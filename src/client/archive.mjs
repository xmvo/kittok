import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const Root = fileURLToPath(new URL('../../', import.meta.url));
export const ClientDir = process.env.CLIENT_DIR ?? join(Root, 'client');
export const AssetHosts = new Set([
	'lf16-tiktok-web.tiktokcdn-us.com',
	'lf16-cdn-tos.tiktokcdn-us.com',
	'sf16-website-login.neutral.ttwstatic.com',
	'lf16-tiktok-common.tiktokcdn-us.com',
]);
export const LoginManifestPath = '/module_meta/common-login/vmok-manifest.json';
export const LoginManifestUrl = `https://www.tiktok.com${LoginManifestPath}`;

export function AssetUrl(Value) {
	const Url = new URL(Value.startsWith('//') ? `https:${Value}` : Value);
	const LoginManifest = Url.hostname === 'www.tiktok.com' && Url.pathname === LoginManifestPath && !Url.search;
	if (Url.protocol !== 'https:' || (!AssetHosts.has(Url.hostname) && !LoginManifest) || Url.port || Url.username || Url.password) {
		throw new Error('UnapprovedAssetOrigin');
	}
	if (!LoginManifest && !Url.pathname.startsWith('/obj/')) throw new Error('UnapprovedAssetPath');
	return Url;
}

export function LocalAsset(Value) {
	const Url = AssetUrl(Value);
	return `/_client/${Url.host}${Url.pathname}${Url.search}`;
}

const Pending = new Map();
export async function MessageUploader(Original) {
	const Match = Original.toString('utf8', 0, 300).match(/^\(self\.(\w+)=self\.\1\|\|\[\]\)\.push\(\[\[([^\]]*)\],\{(\d+):/);
	if (!Match) return Original;
	const Shim = await readFile(join(Root, 'src/client/uploader.js'), 'utf8');
	return Buffer.from(`(self.${Match[1]}=self.${Match[1]}||[]).push([[${Match[2]}],{${Match[3]}:function(e){e.exports=${Shim.trim()}}}]);`);
}

export const AssetFile = Value => join(ClientDir, 'assets', createHash('sha256').update(AssetUrl(Value).href).digest('hex'));

export async function Asset(Value, { Refresh = false } = {}) {
	const Url = AssetUrl(Value);
	const Key = createHash('sha256').update(Url.href).digest('hex');
	const Path = AssetFile(Value);
	if (!Refresh) try { return await readFile(Path); } catch (Error) { if (Error.code !== 'ENOENT') throw Error; }
	if (Pending.has(Key)) return Pending.get(Key);
	const Work = (async () => {
		const Response = await fetch(Url, { redirect: 'error', signal: AbortSignal.timeout(30000) });
		if (!Response.ok) throw new Error(`AssetHTTP${Response.status}`);
		if (Number(Response.headers.get('content-length')) > 32 * 1024 * 1024) throw new Error('AssetTooLarge');
		const Body = Buffer.from(await Response.arrayBuffer());
		if (Body.length > 32 * 1024 * 1024) throw new Error('AssetTooLarge');
		await mkdir(join(ClientDir, 'assets'), { recursive: true });
		await writeFile(Path, Body);
		return Body;
	})();
	Pending.set(Key, Work);
	try { return await Work; } finally { Pending.delete(Key); }
}

export function RewriteAssets(Text, Origin) {
	for (const Host of AssetHosts) {
		Text = Text.replaceAll(`https://${Host}`, `/_client/${Host}`)
			.replaceAll(`//${Host}`, `/_client/${Host}`);
	}
	Text = Text.replaceAll(LoginManifestUrl, `/_client/www.tiktok.com${LoginManifestPath}`);
	Text = Text.replace(/\(!!(\w)\.isStrangerConversation\|\|!!\(null==\((\w)=\1\.instance\)\?void 0:\2\.lastMessage\)\)/g, '!0');
	Text = Text.replace(/(dm_riskyGroupChat_groupClosed_body[^)]*\)\}\):\(0,\w+\.Y\)\(\w+,\{isFlexibleUI:\w+,hasUnread:\w+>0,children:)(\w)\}/g, '$1$2||"No messages yet"}');
	return Origin ? Text.replaceAll('https://www.tiktok.com', Origin).replaceAll('//www.tiktok.com', Origin) : Text;
}

export function ReadJsonScript(Html, Id) {
	const Match = Html.match(new RegExp(`<script[^>]*id="${Id}"[^>]*>([\\s\\S]*?)<\\/script>`));
	if (!Match) throw new Error(`MissingScript:${Id}`);
	return JSON.parse(Match[1]);
}

export function ReplaceJsonScript(Html, Id, Value) {
	return Html.replace(new RegExp(`(<script[^>]*id="${Id}"[^>]*>)[\\s\\S]*?(<\\/script>)`),
		(_, Open, Close) => Open + JSON.stringify(Value).replaceAll('<', '\\u003c') + Close);
}

let LoginCapture;
export async function CaptureLoginPage(Refresh = false) {
	if (!Refresh) {
		try { return await readFile(join(ClientDir, 'login.html'), 'utf8'); }
		catch (Error) { if (Error.code !== 'ENOENT') throw Error; }
	}
	if (LoginCapture) return LoginCapture;
	LoginCapture = (async () => {
		const Response = await fetch('https://www.tiktok.com/login', {
			headers: { 'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36' },
			signal: AbortSignal.timeout(30000),
		});
		if (!Response.ok) throw new Error(`LoginPageHTTP${Response.status}`);
		const Html = await Response.text();
		ReadJsonScript(Html, 'SIGI_STATE');
		ReadJsonScript(Html, '__UNIVERSAL_DATA_FOR_REHYDRATION__');
		const Entries = new Set();
		for (const Match of Html.matchAll(/<(?:script|link)\b[^>]*(?:src|href)="((?:https:)?\/\/[^"<>]+)"/g)) {
			const Url = new URL(Match[1].startsWith('//') ? `https:${Match[1]}` : Match[1]);
			if (AssetHosts.has(Url.hostname) && /\.(?:js|css|woff2?)(?:\?|$)/.test(Url.href)) Entries.add(Url.href);
		}
		if (Entries.size < 5) throw new Error('IncompleteLoginPage');
		const Queue = [...Entries];
		await Promise.all(Array.from({ length: 6 }, async () => { while (Queue.length) await Asset(Queue.pop()); }));
		await mkdir(ClientDir, { recursive: true });
		await writeFile(join(ClientDir, 'login.html.pending'), Html);
		await rename(join(ClientDir, 'login.html.pending'), join(ClientDir, 'login.html'));
		await writeFile(join(ClientDir, 'login-build.json'), JSON.stringify({ source: 'https://www.tiktok.com/login', capturedAt: new Date().toISOString(), sha256: createHash('sha256').update(Html).digest('hex'), entries: [...Entries] }, null, '\t'));
		return Html;
	})();
	try { return await LoginCapture; } finally { LoginCapture = null; }
}
