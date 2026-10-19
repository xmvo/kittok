import { rm } from 'node:fs/promises';
import { HttpError, Id, Json, ReadBody, RequireMethod } from '../http.mjs';
import { CreateUser, Login, RequireCsrf, SessionCookie } from '../auth.mjs';
import { UserShape, UserStats, FindUser, Videos, SetRelation } from '../store.mjs';
import { ImportVideo, ReceiveVideo } from '../media.mjs';

export async function Api(Context) {
	const { Request, Response, Url, Pool, Config, User, Limiter } = Context;
	const Path = Url.pathname;
	if (Path === '/api/v1/instance') {
		RequireMethod(Request, ['GET']);
		Json(Response, { name: Config.Name, description: Config.Description, version: '0.1.0', registration: Config.Registration, origin: Config.Origin, source: Config.SourceUrl });
		return true;
	}
	if (Path === '/api/v1/session') {
		if (Request.method === 'GET') { Json(Response, { user: User ? UserShape(User, Config.Origin) : null, csrfToken: User?.csrf_token ?? null }); return true; }
		if (Request.method === 'DELETE') {
			RequireCsrf(Request, User);
			await Pool.query('DELETE FROM sessions WHERE token_hash = $1', [User.token_hash]);
			Response.setHeader('set-cookie', SessionCookie(Config, '', true));
			Json(Response, { ok: true }); return true;
		}
		RequireMethod(Request, ['POST']);
		Limiter.Hit(`auth:${Request.socket.remoteAddress}`, 10);
		const Body = await ReadBody(Request);
		const Session = await Login(Pool, Body.username, Body.password);
		Response.setHeader('set-cookie', SessionCookie(Config, Session.Token));
		Json(Response, { user: UserShape(Session.User, Config.Origin), csrfToken: Session.Csrf });
		return true;
	}
	if (Path === '/api/v1/users') {
		RequireMethod(Request, ['POST']);
		Limiter.Hit(`register:${Request.socket.remoteAddress}`, 5);
		const Created = await CreateUser(Pool, await ReadBody(Request), Config.Registration);
		Json(Response, { user: UserShape(Created, Config.Origin) }, 201); return true;
	}
	if (Path === '/api/v1/videos') {
		if (Request.method === 'GET') {
			Json(Response, await Videos(Pool, Config.Origin, { before: Url.searchParams.get('cursor'), viewer: User?.id })); return true;
		}
		RequireMethod(Request, ['POST']); RequireCsrf(Request, User);
		Limiter.Hit(`upload:${User.id}`, 5, 3600000);
		if (!Request.headers['content-type']?.startsWith('video/')) throw new HttpError(415, 'ExpectedVideoBody');
		if (Number(Request.headers['content-length']) > Config.MaxVideoBytes) throw new HttpError(413, 'VideoTooLarge');
		if (Context.Uploading.value >= 2) throw new HttpError(503, 'UploadsBusy');
		Context.Uploading.value++;
		let File;
		try {
			File = await ReceiveVideo(Request, Config);
			const VideoId = await ImportVideo(Pool, Config, User.id, File, Url.searchParams.get('description') ?? '');
			Json(Response, { id: VideoId }, 201);
		} finally { Context.Uploading.value--; if (File) await rm(File, { force: true }); }
		return true;
	}
	const Match = Path.match(/^\/api\/v1\/videos\/(\d+)\/(like|favorite|comments)$/);
	if (Match) {
		const VideoId = Id(Match[1]);
		if (Match[2] === 'comments') {
			if (Request.method === 'GET') {
				const Result = await Pool.query('SELECT c.id, c.body, c.created_at, u.id AS user_id, u.username, u.display_name FROM comments c JOIN users u ON u.id = c.author_id WHERE c.video_id = $1 ORDER BY c.id DESC LIMIT 50', [VideoId]);
				Json(Response, { comments: Result.rows }); return true;
			}
			RequireMethod(Request, ['POST']); RequireCsrf(Request, User);
			Limiter.Hit(`comment:${User.id}`, 30);
			const Body = await ReadBody(Request);
			if (typeof Body.text !== 'string' || !Body.text.trim() || Body.text.length > 1500) throw new HttpError(400, 'InvalidComment');
			const Exists = await Pool.query('SELECT id FROM videos WHERE id = $1', [VideoId]);
			if (!Exists.rowCount) throw new HttpError(404, 'VideoNotFound');
			const Added = await Pool.query('INSERT INTO comments(video_id, author_id, body) VALUES ($1,$2,$3) RETURNING id, body, created_at', [VideoId, User.id, Body.text.trim()]);
			Json(Response, Added.rows[0], 201); return true;
		}
		RequireMethod(Request, ['PUT', 'DELETE']); RequireCsrf(Request, User);
		await SetRelation(Pool, Match[2] === 'like' ? 'likes' : 'favorites', ['user_id', 'video_id'], [User.id, VideoId], Request.method === 'PUT');
		Json(Response, { ok: true }); return true;
	}
	const Follow = Path.match(/^\/api\/v1\/users\/([a-z0-9_]+)\/follow$/);
	if (Follow) {
		RequireMethod(Request, ['PUT', 'DELETE']); RequireCsrf(Request, User);
		const Target = await FindUser(Pool, Follow[1]);
		await SetRelation(Pool, 'follows', ['follower_id', 'following_id'], [User.id, Target.id], Request.method === 'PUT');
		Json(Response, { ok: true }); return true;
	}
	return false;
}
