import { AssertVideoVisible, PostSettings, SetPrivateAccount } from '../privacy.mjs';
import { rm } from 'node:fs/promises';
import { HttpError, Id, Json, ReadBody, RequireMethod } from '../http.mjs';
import { CreateUser, Login, RequireCsrf, SessionCookie, ClientInfo } from '../auth.mjs';
import { UserShape, UserStats, FindUser, Videos, SetRelation, AddComment, SetBlock } from '../store.mjs';
import { DownloadCopy, ImportVideo, ReceiveVideo, ServeMedia, WarmDownloads } from '../media.mjs';
import { AssertAllowed, RemovedSql } from '../moderation.mjs';
import { BadgeCatalog, BadgeSvg, PrideFlag, PublicBadges } from '../badges.mjs';
import { AvatarDecoration, DecorationCatalog, DecorationImage, PublicDecoration } from '../decorations.mjs';
import { Misc } from '../settings.mjs';
import { Category } from '../categories.mjs';
import { UnsendMessage } from './im.mjs';

export async function Api(Context) {
	const { Request, Response, Url, Pool, Config, User, Limiter } = Context;
	const Path = Url.pathname;
	const MessageAction = /^\/api\/v1\/messages\/(\d+)(\/actions)?$/.exec(Path);
	if (MessageAction) {
		if (!User) throw new HttpError(401, 'NotLoggedIn');
		if (MessageAction[2]) {
			RequireMethod(Request, ['GET']);
			const Row = (await Pool.query(`SELECT m.sender_id = $2 AND m.recalled_at IS NULL AND m.created_at >= now() - interval '3 minutes' AS can_unsend
				FROM messages m JOIN conversation_members me ON me.conversation_id = m.conversation_id AND me.user_id = $2 WHERE m.id = $1 AND m.index_in_conversation > me.min_index AND NOT $2 = ANY(m.hidden_for)`, [Id(MessageAction[1]), User.id])).rows[0];
			if (!Row) throw new HttpError(404, 'MessageNotFound');
			Json(Response, { canUnsend: Row.can_unsend }); return true;
		}
		RequireMethod(Request, ['DELETE']); RequireCsrf(Request, User);
		if (Config.Features?.messages === false) throw new HttpError(403, 'MessagesDisabled');
		await UnsendMessage(Context, Id(MessageAction[1]));
		Json(Response, { ok: true }); return true;
	}
	if (Path === '/_kittok/badges/catalog') {
		RequireMethod(Request, ['GET']); Json(Response, BadgeCatalog); return true;
	}
	const BadgeIcon = Path.match(/^\/_kittok\/badges\/icon\/([a-z_]+)\.svg$/);
	if (BadgeIcon) {
		RequireMethod(Request, ['GET', 'HEAD']);
		const Svg = BadgeSvg(BadgeIcon[1]);
		Response.writeHead(200, { 'content-type': 'image/svg+xml', 'cache-control': 'public, max-age=86400' });
		Response.end(Request.method === 'HEAD' ? undefined : Svg); return true;
	}
	if (Path === '/_kittok/badges') {
		RequireMethod(Request, ['GET']);
		const Names = [...new Set((Url.searchParams.get('users') ?? '').split(','))];
		if (Names.length > 50 || Names.some(Name => !/^[a-z0-9_]{3,24}$/.test(Name))) throw new HttpError(400, 'InvalidUsernames');
		const Rows = (await Pool.query('SELECT username, pride_flag, user_badges, verified, avatar_decoration FROM users WHERE username = ANY($1::text[]) AND suspended_at IS NULL', [Names])).rows;
		Json(Response, { users: Object.fromEntries(Rows.map(Row => [Row.username, PublicBadges(Row)])), verified: Misc.verifiedBadges ? Rows.filter(Row => Row.verified).map(Row => Row.username) : [], decorations: Object.fromEntries(Rows.map(Row => [Row.username, PublicDecoration(Row)]).filter(Pair => Pair[1])) }); return true;
	}
	if (Path === '/_kittok/decorations/catalog') {
		RequireMethod(Request, ['GET']);
		if (!Misc.avatarDecorations) throw new HttpError(404, 'AvatarDecorationsDisabled');
		Response.setHeader('cache-control', 'public, max-age=3600'); Json(Response, DecorationCatalog); return true;
	}
	const Decoration = Path.match(/^\/_kittok\/decorations\/((?:a_)?[0-9a-f]{32})\.png$/);
	if (Decoration) {
		RequireMethod(Request, ['GET', 'HEAD']);
		const Data = await DecorationImage(Config, Decoration[1], Url.searchParams.has('static'));
		Response.writeHead(200, { 'content-type': 'image/png', 'content-length': Data.length, 'cache-control': 'public, max-age=31536000, immutable' });
		Response.end(Request.method === 'HEAD' ? undefined : Data); return true;
	}
	const PinMatch = /^\/api\/v1\/videos\/(\d+)\/pin$/.exec(Path);
	if (PinMatch) {
		RequireMethod(Request, ['POST']); RequireCsrf(Request, User);
		const Pinned = (await ReadBody(Request)).pinned === true;
		const Row = (await Pool.query('SELECT pinned_at FROM videos WHERE id = $1 AND author_id = $2', [Id(PinMatch[1]), User.id])).rows[0];
		if (!Row) throw new HttpError(404, 'VideoNotFound');
		if (Pinned && !Row.pinned_at && (await Pool.query('SELECT count(*)::int AS pinned FROM videos WHERE author_id = $1 AND pinned_at IS NOT NULL', [User.id])).rows[0].pinned >= 3) throw new HttpError(409, 'PinLimit');
		await Pool.query('UPDATE videos SET pinned_at = CASE WHEN $3 THEN coalesce(pinned_at, now()) END WHERE id = $1 AND author_id = $2', [Id(PinMatch[1]), User.id, Pinned]);
		Json(Response, { pinned: Pinned }); return true;
	}
	if (Path === '/api/v1/profile/decoration') {
		RequireMethod(Request, ['PATCH']); RequireCsrf(Request, User);
		if (!Misc.avatarDecorations) throw new HttpError(403, 'AvatarDecorationsDisabled');
		await AssertAllowed(Pool, User, 'profile');
		const Chosen = AvatarDecoration((await ReadBody(Request)).decoration);
		await Pool.query('UPDATE users SET avatar_decoration=$2 WHERE id=$1', [User.id, Chosen]);
		Json(Response, { decoration: PublicDecoration({ avatar_decoration: Chosen }) }); return true;
	}
	if (Path === '/api/v1/profile/badges') {
		RequireMethod(Request, ['PATCH']); RequireCsrf(Request, User);
		if (!Misc.profileBadges) throw new HttpError(403, 'ProfileBadgesDisabled');
		await AssertAllowed(Pool, User, 'profile');
		const Flag = PrideFlag((await ReadBody(Request)).prideFlag);
		await Pool.query('UPDATE users SET pride_flag=$2 WHERE id=$1', [User.id, Flag]);
		Json(Response, { prideFlag: Flag, kittokBadges: PublicBadges({ ...User, pride_flag: Flag }) }); return true;
	}
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
		const Session = await Login(Pool, Body.username, Body.password, ClientInfo(Request, Config));
		Response.setHeader('set-cookie', SessionCookie(Config, Session.Token));
		Json(Response, { user: UserShape(Session.User, Config.Origin), csrfToken: Session.Csrf });
		return true;
	}
	if (Path === '/api/v1/users') {
		RequireMethod(Request, ['POST']);
		Limiter.Hit(`register:${Request.socket.remoteAddress}`, 5);
		const Created = await CreateUser(Pool, await ReadBody(Request), Config.Registration, false, ClientInfo(Request, Config));
		Json(Response, { user: UserShape(Created, Config.Origin) }, 201); return true;
	}
	if (Path === '/api/v1/videos') {
		if (Request.method === 'GET') {
			Json(Response, await Videos(Pool, Config.Origin, { before: Url.searchParams.get('cursor'), viewer: User?.id })); return true;
		}
		RequireMethod(Request, ['POST']); RequireCsrf(Request, User);
		if (Config.Features?.upload === false) throw new HttpError(403, 'UploadsDisabled');
		await AssertAllowed(Pool, User, 'upload');
		Limiter.Hit(`upload:${User.id}`, 5, 3600000);
		if (!Request.headers['content-type']?.startsWith('video/')) throw new HttpError(415, 'ExpectedVideoBody');
		if (Number(Request.headers['content-length']) > Config.MaxVideoBytes) throw new HttpError(413, 'VideoTooLarge');
		if (Context.Uploading.value >= 2) throw new HttpError(503, 'UploadsBusy');
		const Settings = { ...PostSettings(Url.searchParams.get('visibility') ?? 'public', Url.searchParams.get('comments') ?? 'default'), category: Category(Url.searchParams.get('category')), story: Url.searchParams.get('story') === '1' };
		Context.Uploading.value++;
		let File;
		try {
			File = await ReceiveVideo(Request, Config);
			const VideoId = await ImportVideo(Pool, Config, User.id, File, Url.searchParams.get('description') ?? '', Settings);
			Json(Response, { id: VideoId }, 201);
			WarmDownloads(Pool, Config).catch(() => {});
		} finally { Context.Uploading.value--; if (File) await rm(File, { force: true }); }
		return true;
	}
	if (Path === '/api/v1/profile/privacy') {
		RequireMethod(Request, ['PATCH']); RequireCsrf(Request, User);
		const Body = await ReadBody(Request);
		if (!['everyone','followers','friends','none'].includes(Body.comments) || typeof Body.privateAccount !== 'boolean') throw new HttpError(400, 'InvalidAccountPrivacy');
		await SetPrivateAccount(Pool, User.id, Body.privateAccount);
		await Pool.query('UPDATE users SET comment_permission = $2 WHERE id = $1', [User.id, Body.comments]);
		Json(Response, { ok: true }); return true;
	}
	const Download = Path.match(/^\/api\/v1\/videos\/(\d+)\/download$/);
	if (Download) {
		RequireMethod(Request, ['GET', 'HEAD']);
		const VideoId = Id(Download[1]);
		await AssertVideoVisible(Pool, VideoId, User?.id);
		const Row = (await Pool.query('SELECT v.id, v.file_name, v.duration, v.download_name, v.author_id, u.username, u.private_account, u.allow_downloads FROM videos v JOIN users u ON u.id = v.author_id WHERE v.id = $1', [VideoId])).rows[0];
		if (!Row) throw new HttpError(404, 'VideoNotFound');
		if (Row.author_id !== User?.id && (Row.private_account || !Row.allow_downloads)) throw new HttpError(403, 'DownloadsOff');
		Limiter.Hit(`download:${User?.id ?? Request.socket.remoteAddress}`, 30, 600000);
		const Name = await DownloadCopy(Pool, Config, Row);
		Response.setHeader('content-disposition', `attachment; filename="${Row.username}_${Row.id}.mp4"`);
		await ServeMedia(Request, Response, Config, Name, true); return true;
	}
	const Post = Path.match(/^\/api\/v1\/videos\/(\d+)$/);
	if (Post) {
		RequireMethod(Request, ['PATCH']); RequireCsrf(Request, User);
		const Body = await ReadBody(Request), Settings = PostSettings(Body.visibility, Body.comments);
		const Updated = await Pool.query('UPDATE videos SET visibility = $3, comment_permission = $4 WHERE id = $1 AND author_id = $2 RETURNING id', [Id(Post[1]), User.id, Settings.visibility, Settings.comment_permission]);
		if (!Updated.rowCount) throw new HttpError(404, 'VideoNotFound');
		Json(Response, { ok: true }); return true;
	}
	const Match = Path.match(/^\/api\/v1\/videos\/(\d+)\/(like|favorite|comments)$/);
	if (Match) {
		const VideoId = Id(Match[1]);
		if (Match[2] === 'comments') {
			if (Request.method === 'GET') {
				await AssertVideoVisible(Pool, VideoId, User?.id);
				const Result = await Pool.query(`SELECT c.id, c.body, c.created_at, u.id AS user_id, u.username, u.display_name FROM comments c JOIN users u ON u.id = c.author_id
					WHERE c.video_id = $1 AND NOT ${RemovedSql('comment', 'c.id')} AND u.suspended_at IS NULL ORDER BY c.id DESC LIMIT 50`, [VideoId]);
				Json(Response, { comments: Result.rows }); return true;
			}
			RequireMethod(Request, ['POST']); RequireCsrf(Request, User);
			if (Config.Features?.comments === false) throw new HttpError(403, 'CommentsDisabled');
			await AssertAllowed(Pool, User, 'comment');
			Limiter.Hit(`comment:${User.id}`, 30);
			const { id, body, created_at } = await AddComment(Pool, VideoId, User.id, (await ReadBody(Request)).text);
			Json(Response, { id, body, created_at }, 201); return true;
		}
		RequireMethod(Request, ['PUT', 'DELETE']); RequireCsrf(Request, User);
		await SetRelation(Pool, Match[2] === 'like' ? 'likes' : 'favorites', ['user_id', 'video_id'], [User.id, VideoId], Request.method === 'PUT');
		Json(Response, { ok: true }); return true;
	}
	const Follow = Path.match(/^\/api\/v1\/users\/([a-z0-9_]+)\/(follow|block)$/);
	if (Follow) {
		RequireMethod(Request, ['PUT', 'DELETE']); RequireCsrf(Request, User);
		const Target = await FindUser(Pool, Follow[1]);
		if (Follow[2] === 'follow' && Request.method === 'PUT') {
			if ((await Pool.query('SELECT 1 FROM users WHERE id = $1 AND suspended_at IS NOT NULL', [Target.id])).rowCount) throw new HttpError(404, 'UserNotFound');
			await AssertAllowed(Pool, User, 'follow');
		}
		if (Follow[2] === 'block') await SetBlock(Pool, User.id, Target.id, Request.method === 'PUT');
		else await SetRelation(Pool, 'follows', ['follower_id', 'following_id'], [User.id, Target.id], Request.method === 'PUT');
		Json(Response, { ok: true }); return true;
	}
	return false;
}
