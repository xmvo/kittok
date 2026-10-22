import { createServer } from 'node:http';
import { Pns } from './routes/pns.mjs';
import { DeleteExpiredAccounts } from './accounts.mjs';
import { BackfillCategories } from './categories.mjs';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Asset, AssetUrl, CaptureLoginPage, CaptureNotFoundPage, NotFoundData, LoginManifestPath, LoginManifestUrl, ClientDir, MessageUploader, Root, RewriteAssets } from './client/archive.mjs';
import { Shell } from './client/shell.mjs';
import { LoadConfig } from './config.mjs';
import { Database, Migrate } from './db.mjs';
import { Viewer, RateLimiter } from './auth.mjs';
import { Escape, HttpError, Json, RequireMethod, ReadBody } from './http.mjs';
import { Mime, ServeMedia, SweepStories, WarmDownloads } from './media.mjs';
import { Api } from './routes/api.mjs';
import { Compatibility } from './routes/compatibility.mjs';
import { Account } from './routes/account.mjs';
import { Passport } from './routes/passport.mjs';
import { Studio } from './routes/studio.mjs';
import { Admin } from './routes/admin.mjs';
import { Im, HandleRequest, Proto, SweepMessageMedia } from './routes/im.mjs';
import { Stories } from './routes/stories.mjs';
import { Upgrade, Sweep } from './im/frontier.mjs';
import { AssertVideoVisible } from './privacy.mjs';
import { LoadSettings } from './settings.mjs';
import { LoadCollectibles } from './decorations.mjs';

const Config = LoadConfig();
const Pool = Database(Config.DatabaseUrl);
await Migrate(Pool);
await BackfillCategories(Pool);
await LoadSettings(Pool, Config);
await LoadCollectibles(Config);
const Raw = await readFile(join(ClientDir, 'index.html'), 'utf8').catch(() => { throw new Error('Run npm run capture first'); });
const Unknown = new Map();
const Blocked = new Map();
const Limiter = RateLimiter();
const Uploading = { value: 0 };
const Csp = "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; font-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; frame-src 'self'; frame-ancestors 'none'; form-action 'self'; base-uri 'self'; object-src 'none'";
const Cleanup = setInterval(() => {
	Pool.query('DELETE FROM sessions WHERE expires_at < now()').catch(() => console.error('SessionCleanupFailed'));
	Pool.query("DELETE FROM video_views WHERE viewed_at < now() - interval '6 hours'").catch(() => console.error('ViewCleanupFailed'));
	Pool.query("UPDATE user_events SET ip_hash = NULL, ip_sealed = NULL WHERE ip_hash IS NOT NULL AND created_at < now() - interval '90 days'").catch(() => console.error('EventCleanupFailed'));
	Pool.query('DELETE FROM data_exports WHERE expires_at < now()').catch(() => console.error('ExportCleanupFailed'));
	DeleteExpiredAccounts(Pool, Config).catch(() => console.error('AccountDeletionFailed'));
	SweepMessageMedia(Pool, Config).catch(() => console.error('MessageMediaCleanupFailed'));
	SweepStories(Pool, Config).catch(() => console.error('StoryCleanupFailed'));
	WarmDownloads(Pool, Config).catch(() => console.error('DownloadWarmupFailed'));
}, 3600000).unref();

const Server = createServer(async (Request, Response) => {
	try {
		Response.setHeader('x-content-type-options', 'nosniff');
		Response.setHeader('referrer-policy', 'same-origin');
		Response.setHeader('content-security-policy', Csp);
		if (Config.SecureCookies) Response.setHeader('strict-transport-security', 'max-age=31536000');
		const AllowedHosts = new Set([new URL(Config.Origin).host]);
		if (Config.IsLocal) { AllowedHosts.add(`localhost:${Config.Port}`); AllowedHosts.add(`127.0.0.1:${Config.Port}`); }
		if (!AllowedHosts.has(Request.headers.host)) throw new HttpError(403, 'InvalidHost');
		const Url = new URL(Request.url, Config.Origin);
		if (Url.origin !== Config.Origin) throw new HttpError(400, 'InvalidRequestTarget');
		if (!['GET', 'HEAD'].includes(Request.method)) {
			const Origin = Request.headers.origin;
			if (Origin && Origin !== Config.Origin && !(Config.IsLocal && [`http://localhost:${Config.Port}`, `http://127.0.0.1:${Config.Port}`].includes(Origin))) throw new HttpError(403, 'InvalidOrigin');
			if (Request.headers['sec-fetch-site'] === 'cross-site') throw new HttpError(403, 'InvalidOrigin');
		}
		const Path = Url.pathname;
		if (/^\/signup(?:\/|$)/.test(Path) && Config.Registration === 'closed') { RequireMethod(Request, ['GET', 'HEAD']); Response.writeHead(303, { location: '/login' }); return Response.end(); }
		if (Path === '/foryou') { RequireMethod(Request, ['GET', 'HEAD']); Response.writeHead(303, { location: '/' + Url.search }); return Response.end(); }
		if (Path === '/health/live') return Json(Response, { status: 'Alive' });
		if (Path === '/health/ready') { await Pool.query('SELECT 1'); return Json(Response, { status: 'Ready' }); }
		if (Path.startsWith('/_client/') || Path === LoginManifestPath) {
			RequireMethod(Request, ['GET', 'HEAD']);
			const Upstream = new URL(Path === LoginManifestPath ? LoginManifestUrl : `https://${Path.slice('/_client/'.length)}${Url.search}`);
			try { AssetUrl(Upstream.href); } catch { throw new HttpError(403, 'AssetNotAllowed'); }
			let Body = await Asset(Upstream.href);
			const Ext = extname(Upstream.pathname);
			if (Ext === '.js' && Body.includes('Action:"ApplyImageUpload"')) Body = await MessageUploader(Body);
			if (['.js', '.css', '.json'].includes(Ext)) Body = Buffer.from(RewriteAssets(Body.toString('utf8'), Config.Origin));
			Response.writeHead(200, { 'content-type': Mime[Ext] ?? 'application/octet-stream', 'cache-control': 'no-cache' });
			return Response.end(Request.method === 'HEAD' ? undefined : Body);
		}
		if (Path === '/_local/bridge.js' || Path === '/_kittok/bridge.js') {
			RequireMethod(Request, ['GET']); Response.setHeader('content-type', Mime['.js']);
			Response.setHeader('cache-control', 'no-store');
			return Response.end(await readFile(join(Root, 'src/client/bridge.js')));
		}
		if (Path.startsWith('/public/')) {
			RequireMethod(Request, ['GET', 'HEAD']);
			const Name = Path.slice('/public/'.length);
			if (!/^(?:[a-z0-9_-]+\.(?:svg|css|js)|fonts\/[a-z0-9-]+\.woff2)$/.test(Name)) throw new HttpError(404, 'NotFound');
			const Body = await readFile(join(Root, 'public', Name)).catch(() => { throw new HttpError(404, 'NotFound'); });
			Response.setHeader('content-type', Mime[extname(Name)]);
			Response.setHeader('cache-control', Name.startsWith('fonts/') ? 'public, max-age=31536000, immutable' : 'no-cache');
			return Response.end(Request.method === 'HEAD' ? undefined : Body);
		}
		if (Path.startsWith('/media/')) {
			RequireMethod(Request, ['GET', 'HEAD']);
			const Name = Path.slice('/media/'.length);
			const Video = (await Pool.query('SELECT id FROM videos WHERE file_name = $1 OR cover_name = $1', [Name])).rows[0];
			if (Video) {
				const Viewer_ = await Viewer(Pool, Request);
				if (!(Url.searchParams.get('review') === '1' && Viewer_?.role === 'admin')) await AssertVideoVisible(Pool, Video.id, Viewer_?.id);
			} else if (Name.endsWith('.mp4') || /^[a-f0-9-]{36}\.jpg$/.test(Name)) throw new HttpError(404, 'MediaNotFound');
			return await ServeMedia(Request, Response, Config, Name, Boolean(Video));
		}
		if (Path === '/source') {
			RequireMethod(Request, ['GET', 'HEAD']);
			const File = join(Root, 'dist/kittok-0.1.0.tar.gz');
			const Info = await stat(File).catch(() => null);
			if (!Info?.isFile()) throw new HttpError(503, 'SourceArchiveUnavailable');
			Response.writeHead(200, { 'content-type': 'application/gzip', 'content-disposition': 'attachment; filename="kittok-0.1.0.tar.gz"', 'content-length': Info.size });
			if (Request.method === 'HEAD') return Response.end();
			return await pipeline(createReadStream(File), Response);
		}
		if (Path === '/_blocked') throw new HttpError(501, 'ExternalServiceDisabled');
		if (Path === '/_debug/blocked' && Request.method === 'POST') {
			Limiter.Hit(`csp:${Request.socket.remoteAddress}`, 100);
			const Event = await ReadBody(Request, 8192);
			const Key = `${String(Event.directive).slice(0, 60)} ${String(Event.blocked).slice(0, 300)}`;
			if (Blocked.size < 500) Blocked.set(Key, (Blocked.get(Key) ?? 0) + 1);
			return Json(Response, { ok: true });
		}
		const User = await Viewer(Pool, Request);
		const Context = { Request, Response, Url, Pool, Config, User, Limiter, Uploading, Unknown };
		if (Path.startsWith('/_debug/')) {
			RequireMethod(Request, ['GET']);
			if (User?.role !== 'admin') throw new HttpError(403, 'AdminRequired');
			if (Path === '/_debug/unknown') return Json(Response, Object.fromEntries(Unknown));
			if (Path === '/_debug/blocked') return Json(Response, Object.fromEntries(Blocked));
		}
		const NotFoundApi = { '/node-webapp/api/importmap': 'importmap.json', '/node-webapp/api/common-app-context': 'common-app-context.json', '/node-webapp/api/biz-context': 'biz-context.json' }[Path]
			?? (/^\/check_and_get_text\/[0-9a-f]+\/normal\/Webapp$/.test(Path) ? 'text-webapp.json' : null);
		if (NotFoundApi) {
			RequireMethod(Request, ['GET']);
			let Text = await NotFoundData(NotFoundApi).catch(() => null);
			if (!Text) throw new HttpError(404, 'NotFound');
			if (NotFoundApi === 'importmap.json') Text = RewriteAssets(Text, Config.Origin);
			if (NotFoundApi === 'common-app-context.json') Text = JSON.stringify({ ...JSON.parse(Text), host: new URL(Config.Origin).host, csrfToken: User?.csrf_token ?? '' });
			Response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': NotFoundApi === 'common-app-context.json' ? 'no-store' : 'public, max-age=3600' });
			return Response.end(Text);
		}
		if (await Admin(Context) || await Studio(Context) || await Account(Context) || await Api(Context) || await Pns(Context) || await Passport(Context) || await Im(Context) || await Stories(Context) || await Compatibility(Context)) return;
		if (/^\/(?:api|passport|node-webapp|tiktok|tns-api|aweme|node|v[1-3])\//.test(Path)) {
			const Key = `${Request.method} ${Path}`;
			if (Unknown.size < 500) Unknown.set(Key, (Unknown.get(Key) ?? 0) + 1);
			return Json(Response, { statusCode: 501, status_code: 501, error: 'NotImplemented', path: Path }, 501);
		}
		RequireMethod(Request, ['GET', 'HEAD']);
		if (/^\/404\/?$/.test(Path)) {
			const Html = RewriteAssets(await CaptureNotFoundPage(), Config.Origin).replaceAll('https://starling.tiktokv.us', Config.Origin).replace('<head>', '<head><link rel="icon" href="/brand/favicon">').replace(/<title>[\s\S]*?<\/title>/, `<title>${Escape(Config.Name)}</title>`);
			Response.writeHead(404, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
			return Response.end(Request.method === 'HEAD' ? undefined : Html);
		}
		if (!/^\/(?:$|login(?:\/[a-z-]+)*\/?$|signup(?:\/[a-z-]+)*\/?$|explore\/?$|following\/?$|friends\/?$|messages\/?$|setting(?:\/[a-z-]+)*\/?$|search(?:\/user|\/video)?\/?$|@[^/]+(?:\/video\/\d+|\/collection\/[^/]+)?\/?$|music\/[^/]+\/?$|tag\/[^/]+\/?$)/.test(Path)) {
			if (!/text\/html/.test(Request.headers.accept ?? '')) throw new HttpError(404, 'NotImplemented');
			Response.writeHead(302, { location: `/404?fromUrl=${encodeURI(Path)}` }); return Response.end();
		}
		Response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
		const Page = /^\/(login|signup)(\/|$)/.test(Path) ? await CaptureLoginPage() : Raw;
		Response.end(Request.method === 'HEAD' ? undefined : Shell(Page, Config.Origin, { Config, User }));
	} catch (Error) {
		if (Error.status) {
			if (Request.url?.startsWith('/account/') && Request.method === 'POST') {
				Response.writeHead(303, { location: (Request.url.startsWith('/account/register') ? '/account?register=1&error=' : '/account?error=') + encodeURIComponent(Error.message) }); return Response.end();
			}
			if (!Response.headersSent) Json(Response, { error: Error.message, statusCode: Error.status, status_code: Error.status }, Error.status);
			else Response.end();
		} else {
			console.error('RequestFailed', Error.code ?? Error.name);
			if (!Response.headersSent) Json(Response, { error: 'RequestFailed' }, 500);
			else Response.end();
		}
	}
});
async function LiveSessions(Hashes) {
	const Result = await Pool.query('SELECT s.token_hash FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ANY($1) AND s.expires_at > now() AND u.suspended_at IS NULL', [Hashes]);
	return new Set(Result.rows.map(Row => Row.token_hash));
}
const SocketSweep = setInterval(() => Sweep(Hashes => Config.Features?.messages === false ? new Set() : LiveSessions(Hashes)).catch(() => console.error('SocketSweepFailed')), 10000).unref();
Server.on('upgrade', async (Request, Socket) => {
	try {
		const Local = Config.IsLocal ? [`localhost:${Config.Port}`, `127.0.0.1:${Config.Port}`] : [];
		const Origins = [Config.Origin, ...Local.map(Host => `http://${Host}`)];
		if (![new URL(Config.Origin).host, ...Local].includes(Request.headers.host) || !Origins.includes(Request.headers.origin) || new URL(Request.url, Config.Origin).pathname !== '/ws/v2') {
			Socket.end('HTTP/1.1 403 Forbidden\r\nconnection: close\r\n\r\n'); return;
		}
		const User = Config.Features?.messages === false ? null : await Viewer(Pool, Request);
		Upgrade(Request, Socket, { User, OnBinary: async Bytes => {
			if (Config.Features?.messages === false || !(await LiveSessions([User.token_hash])).size) throw new Error('SessionEnded');
			const Frame = Proto.Decode('Frame', Bytes);
			if (Frame.payload_type !== 'pb' || !Frame.payload) return null;
			const Payload = await HandleRequest({ Pool, Config, User, Limiter, Unknown }, Frame.payload);
			return Proto.Encode('Frame', { seqid: Frame.seqid, logid: String(Date.now()), service: Frame.service, method: Frame.method, payload_type: 'pb', payload: Payload });
		} });
	} catch { Socket.destroy(); }
});
Server.requestTimeout = 240000;
Server.headersTimeout = 15000;
Server.listen(Config.Port, Config.Host, () => console.log(`Kittok ready: ${Config.Origin}`));
setTimeout(() => WarmDownloads(Pool, Config).catch(() => console.error('DownloadWarmupFailed')), 30000).unref();
let Closing = false;
async function Shutdown() {
	if (Closing) return;
	Closing = true;
	clearInterval(Cleanup); clearInterval(SocketSweep); Limiter.Close();
	const Timer = setTimeout(() => process.exit(1), 10000).unref();
	Server.close(async () => { await Pool.end(); clearTimeout(Timer); process.exit(0); });
}
process.once('SIGTERM', Shutdown);
process.once('SIGINT', Shutdown);
