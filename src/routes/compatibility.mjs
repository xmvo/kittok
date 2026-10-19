import { HttpError, Id, Json, ReadBody, RequireMethod } from '../http.mjs';
import { RequireCsrf } from '../auth.mjs';
import { FindUser, UserShape, UserStats, Videos, SetRelation, Relation, AddComment } from '../store.mjs';

const FollowStatus = Value => ({ 1: 1, 2: 2 })[Value] ?? 0;

function CommentShape(Row, Origin) {
	return {
		cid: Row.id, aweme_id: Row.video_id, text: Row.body, text_extra: [], create_time: Math.floor(new Date(Row.created_at).getTime() / 1000),
		digg_count: Row.likes ?? 0, reply_comment_total: Row.replies ?? 0, user_digged: Row.liked ? 1 : 0, reply_id: Row.parent_id ?? '0', reply_to_reply_id: '0',
		user: { uid: Row.author_id, unique_id: Row.username, nickname: Row.display_name, sec_uid: Row.author_id, avatar_thumb: { url_list: [`${Origin}/public/avatar.svg`] } },
	};
}

async function CommentPage(Pool, Origin, Viewer, { video, parent, cursor, count }) {
	const Limit = Math.min(Math.max(Number(count) || 20, 1), 50);
	const After = cursor && cursor !== '0' ? Id(cursor) : null;
	const Result = await Pool.query(`SELECT c.*, u.username, u.display_name,
		(SELECT count(*)::int FROM comment_likes l WHERE l.comment_id = c.id) AS likes,
		EXISTS (SELECT 1 FROM comment_likes l WHERE l.comment_id = c.id AND l.user_id = $1::bigint) AS liked,
		(SELECT count(*)::int FROM comments r WHERE r.parent_id = c.id) AS replies
		FROM comments c JOIN users u ON u.id = c.author_id
		WHERE ${parent ? 'c.parent_id = $2' : 'c.video_id = $2 AND c.parent_id IS NULL'} AND ($3::bigint IS NULL OR c.id ${parent ? '>' : '<'} $3)
		ORDER BY c.id ${parent ? 'ASC' : 'DESC'} LIMIT $4`, [Viewer ?? null, parent ?? video, After, Limit + 1]);
	const Rows = Result.rows.slice(0, Limit);
	return { status_code: 0, comments: Rows.map(Row => CommentShape(Row, Origin)), cursor: Rows.at(-1)?.id ?? cursor ?? '0', has_more: Result.rows.length > Limit ? 1 : 0 };
}

export async function Compatibility(Context) {
	const { Request, Response, Url, Pool, Config, User, Limiter } = Context;
	const Path = Url.pathname;
	const Params = Url.searchParams;
	if (Path === '/node-webapp/api/login-config') {
		RequireMethod(Request, ['GET']);
		Json(Response, { statusCode: 0, config: {
			emailSuffixConfig: [], platformConfig: { show_num: 2, order: 'FACEBOOK,GOOGLE,APPLE,INSTAGRAM' },
			platformConfigV2: { show_num: 2, order: 'FACEBOOK,GOOGLE,APPLE,INSTAGRAM' },
			signupConfig: { enable: Config.Registration !== 'closed', text: { title: '', description: 'Registration is closed on this instance.' } },
			forceLogin: false, emailConsent: false, ttpConfig: { open: false, syncSeverList: [] },
			preventSignupText: { title: '', description: 'Registration is closed on this instance.' },
			disableStandaloneAidLoginList: [], disableStandaloneAppFlags: {},
		} }); return true;
	}
	if (['/api/preload/item_list/', '/api/recommend/item_list/', '/api/following/item_list/', '/api/post/item_list/', '/api/favorite/item_list/', '/api/collection/item_list/', '/api/user/collect/item_list/'].includes(Path)) {
		RequireMethod(Request, ['GET', 'POST']);
		const Filter = { viewer: User?.id, before: Params.get('cursor') === '0' ? undefined : Params.get('cursor'), limit: Params.get('count') };
		if (Path.includes('/following/')) { if (!User) throw new HttpError(401, 'NotLoggedIn'); Filter.following = User.id; }
		if (Path.includes('/post/')) Filter.author = (await FindUser(Pool, Params.get('uniqueId') || Params.get('secUid') || User?.id, !Params.get('uniqueId'))).id;
		if (Path.includes('/favorite/')) Filter.likedBy = (await FindUser(Pool, Params.get('secUid') || User?.id, true)).id;
		if (Path.includes('/collection/')) { if (!User) throw new HttpError(401, 'NotLoggedIn'); Filter.savedBy = User.id; }
		if (Path.includes('/user/collect/')) {
			if (!User || (Params.get('secUid') && Params.get('secUid') !== User.id)) { Json(Response, { statusCode: 0, status_code: 0, itemList: [], cursor: '0', hasMore: false, extra: { logid: 'kittok' } }); return true; }
			Filter.savedBy = User.id;
		}
		const Feed = await Videos(Pool, Config.Origin, Filter);
		Json(Response, { statusCode: 0, status_code: 0, itemList: Feed.items, cursor: Feed.cursor, hasMore: Feed.hasMore, extra: { logid: 'kittok' } }); return true;
	}
	if (Path === '/api/item/detail/') {
		RequireMethod(Request, ['GET']);
		const Result = await Videos(Pool, Config.Origin, { id: Params.get('itemId'), viewer: User?.id });
		if (!Result.items.length) throw new HttpError(404, 'VideoNotFound');
		Json(Response, { statusCode: 0, itemInfo: { itemStruct: Result.items[0] } }); return true;
	}
	if (Path === '/api/user/detail/') {
		RequireMethod(Request, ['GET']);
		const Target = await FindUser(Pool, Params.get('uniqueId') || Params.get('secUid') || User?.id, !Params.get('uniqueId'));
		Json(Response, { statusCode: 0, userInfo: { user: UserShape({ ...Target, relation: await Relation(Pool, User?.id, Target.id) }, Config.Origin), stats: await UserStats(Pool, Target.id) } }); return true;
	}
	if (Path === '/api/search/user/full/') {
		RequireMethod(Request, ['GET']);
		const Query = `%${(Params.get('keyword') ?? '').slice(0, 100).replace(/[\\%_]/g, '\\$&')}%`;
		const Result = await Pool.query("SELECT id, username, display_name, bio FROM users WHERE username ILIKE $1 ESCAPE '\\' OR display_name ILIKE $1 ESCAPE '\\' ORDER BY username LIMIT 20", [Query]);
		Json(Response, { status_code: 0, user_list: await Promise.all(Result.rows.map(async Row => ({ user_info: { ...UserShape(Row, Config.Origin), uid: Row.id, unique_id: Row.username, sec_uid: Row.id, nickname: Row.display_name, avatar_thumb: { url_list: [`${Config.Origin}/public/avatar.svg`] }, ...await UserStats(Pool, Row.id) } }))), cursor: 0, has_more: 0 }); return true;
	}
	if (Path === '/api/comment/list/') {
		RequireMethod(Request, ['GET']);
		const VideoId = Id(Params.get('aweme_id') || Params.get('item_id'));
		const Page = await CommentPage(Pool, Config.Origin, User?.id, { video: VideoId, cursor: Params.get('cursor'), count: Params.get('count') });
		const Total = await Pool.query('SELECT count(*)::int AS count FROM comments WHERE video_id = $1', [VideoId]);
		Json(Response, { ...Page, total: Total.rows[0].count }); return true;
	}
	if (Path === '/api/comment/list/reply/') {
		RequireMethod(Request, ['GET']);
		Json(Response, await CommentPage(Pool, Config.Origin, User?.id, { parent: Id(Params.get('comment_id')), cursor: Params.get('cursor'), count: Params.get('count') ?? 3 })); return true;
	}
	if (Path === '/api/comment/digg/') {
		RequireMethod(Request, ['POST']); RequireCsrf(Request, User);
		const Body = { ...Object.fromEntries(Params), ...await ReadBody(Request) };
		await SetRelation(Pool, 'comment_likes', ['user_id', 'comment_id'], [User.id, Id(Body.cid)], String(Body.digg_type ?? '1') === '1');
		Json(Response, { status_code: 0, statusCode: 0 }); return true;
	}
	if (Path === '/api/comment/publish/') {
		RequireMethod(Request, ['POST']); RequireCsrf(Request, User);
		Limiter.Hit(`comment:${User.id}`, 30);
		const Body = { ...Object.fromEntries(Params), ...await ReadBody(Request) };
		const VideoId = Id(Body.aweme_id);
		const Added = await AddComment(Pool, VideoId, User.id, Body.text, Body.reply_id && Body.reply_id !== '0' ? Id(Body.reply_id) : null);
		Json(Response, { status_code: 0, status_msg: '', comment: CommentShape({ ...Added, video_id: VideoId, author_id: User.id, username: User.username, display_name: User.display_name }, Config.Origin) }); return true;
	}
	if (Path === '/api/commit/item/digg/' || Path === '/api/item/collect/') {
		RequireMethod(Request, ['POST']); RequireCsrf(Request, User);
		const Body = { ...Object.fromEntries(Params), ...await ReadBody(Request) };
		const Collect = Path === '/api/item/collect/';
		const Target = Id(Body.itemId || Body.item_id || Body.aweme_id);
		const Enabled = String(Body.type ?? Body.action ?? '1') === '1';
		await SetRelation(Pool, Collect ? 'favorites' : 'likes', ['user_id', 'video_id'], [User.id, Target], Enabled);
		if (!Collect) { Json(Response, { status_code: 0, statusCode: 0, is_digg: Enabled ? 0 : 1 }); return true; }
		const Count = await Pool.query('SELECT count(*)::int AS count FROM favorites WHERE video_id = $1', [Target]);
		Json(Response, { status_code: 0, statusCode: 0, collected: Enabled, collectCount: Count.rows[0].count }); return true;
	}
	if (Path === '/api/commit/follow/user/' || Path === '/api/follow/') {
		RequireMethod(Request, ['POST']); RequireCsrf(Request, User);
		const Body = { ...Object.fromEntries(Params), ...await ReadBody(Request) };
		const Target = Id(Body.user_id || Body.sec_user_id);
		await SetRelation(Pool, 'follows', ['follower_id', 'following_id'], [User.id, Target], String(Body.type ?? Body.action_type ?? '1') === '1');
		Json(Response, { status_code: 0, statusCode: 0, follow_status: FollowStatus(await Relation(Pool, User.id, Target)) }); return true;
	}
	return false;
}
