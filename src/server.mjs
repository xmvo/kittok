import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Asset, AssetUrl, CaptureLoginPage, LoginManifestPath, LoginManifestUrl, ClientDir, Root, RewriteAssets } from './client/archive.mjs';
import { Shell } from './client/shell.mjs';
import { LoadConfig } from './config.mjs';
import { Database, Migrate } from './db.mjs';
import { Viewer, RateLimiter } from './auth.mjs';
import { HttpError, Json, RequireMethod, ReadBody } from './http.mjs';
import { Mime, ServeMedia } from './media.mjs';
import { Api } from './routes/api.mjs';
import { Compatibility } from './routes/compatibility.mjs';
import { Account } from './routes/account.mjs';
import { Passport } from './routes/passport.mjs';
import { Admin } from './routes/admin.mjs';
import { LoadSettings } from './settings.mjs';

const Config = LoadConfig();
const Pool = Database(Config.DatabaseUrl);
await Migrate(Pool);
await LoadSettings(Pool, Config);
const Raw = await readFile(join(ClientDir, 'index.html'), 'utf8').catch(() => { throw new Error('Run npm run capture first'); });
const Unknown = new Map();
const Blocked = new Map();
const Limiter = RateLimiter();
const Uploading = { value: 0 };
const Csp = "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; font-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; frame-src 'none'; frame-ancestors 'none'; form-action 'self'; base-uri 'self'; object-src 'none'";
const Cleanup = setInterval(() => {
	Pool.query('DELETE FROM sessions WHERE expires_at < now()').catch(() => console.error('SessionCleanupFailed'));
	Pool.query("DELETE FROM video_views WHERE viewed_at < now() - interval '6 hours'").catch(() => console.error('ViewCleanupFailed'));
	Pool.query("UPDATE user_events SET ip = NULL WHERE ip IS NOT NULL AND created_at < now() - interval '90 days'").catch(() => console.error('EventCleanupFailed'));
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
		if (Path === '/foryou') { RequireMethod(Request, ['GET', 'HEAD']); Response.writeHead(303, { location: '/' + Url.search }); return Response.end(); }
		if (Path === '/health/live') return Json(Response, { status: 'Alive' });
		if (Path === '/health/ready') { await Pool.query('SELECT 1'); return Json(Response, { status: 'Ready' }); }
		if (Path.startsWith('/_client/') || Path === LoginManifestPath) {
			RequireMethod(Request, ['GET', 'HEAD']);
			const Upstream = new URL(Path === LoginManifestPath ? LoginManifestUrl : `https://${Path.slice('/_client/'.length)}${Url.search}`);
			try { AssetUrl(Upstream.href); } catch { throw new HttpError(403, 'AssetNotAllowed'); }
			let Body = await Asset(Upstream.href);
			const Ext = extname(Upstream.pathname);
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
			if (!/^[a-z0-9_-]+\.(?:svg|css|js)$/.test(Name)) throw new HttpError(404, 'NotFound');
			const Body = await readFile(join(Root, 'public', Name)).catch(() => { throw new HttpError(404, 'NotFound'); });
			Response.setHeader('content-type', Mime[extname(Name)]);
			Response.setHeader('cache-control', 'no-cache');
			return Response.end(Request.method === 'HEAD' ? undefined : Body);
		}
		if (Path.startsWith('/media/')) { RequireMethod(Request, ['GET', 'HEAD']); return await ServeMedia(Request, Response, Config, Path.slice('/media/'.length)); }
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
		if (await Admin(Context) || await Account(Context) || await Api(Context) || await Passport(Context) || await Compatibility(Context)) return;
		if (/^\/(?:api|passport|node-webapp|tiktok|aweme|node)\//.test(Path)) {
			const Key = `${Request.method} ${Path}`;
			if (Unknown.size < 500) Unknown.set(Key, (Unknown.get(Key) ?? 0) + 1);
			return Json(Response, { statusCode: 501, status_code: 501, error: 'NotImplemented', path: Path }, 501);
		}
		RequireMethod(Request, ['GET', 'HEAD']);
		if (!/^\/(?:$|login(?:\/[a-z-]+)*\/?$|signup(?:\/[a-z-]+)*\/?$|explore\/?$|following\/?$|search(?:\/user|\/video)?\/?$|@[^/]+(?:\/video\/\d+)?\/?$|music\/[^/]+\/?$)/.test(Path)) throw new HttpError(404, 'NotImplemented');
		Response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
		const Page = /^\/(login|signup)(\/|$)/.test(Path) ? await CaptureLoginPage() : Raw;
		Response.end(Request.method === 'HEAD' ? undefined : Shell(Page, Config.Origin, { Config, User }));
	} catch (Error) {
		if (Error.status) {
			if (Request.url?.startsWith('/account/') && Request.method === 'POST') {
				Response.writeHead(303, { location: '/account?error=' + encodeURIComponent(Error.message) }); return Response.end();
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
Server.requestTimeout = 240000;
Server.headersTimeout = 15000;
Server.listen(Config.Port, Config.Host, () => console.log(`Kittok ready: ${Config.Origin}`));
let Closing = false;
async function Shutdown() {
	if (Closing) return;
	Closing = true;
	clearInterval(Cleanup); Limiter.Close();
	const Timer = setTimeout(() => process.exit(1), 10000).unref();
	Server.close(async () => { await Pool.end(); clearTimeout(Timer); process.exit(0); });
}
process.once('SIGTERM', Shutdown);
process.once('SIGINT', Shutdown);
