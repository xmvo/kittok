import { HttpError, Id, Json, ReadBody, RequireMethod } from '../http.mjs';
import { RequireCsrf } from '../auth.mjs';
import { FindUser, UserShape, UserStats, Videos, SetRelation } from '../store.mjs';

export async function Compatibility(Context) {
	const { Request, Response, Url, Pool, Config, User } = Context;
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
	if (['/api/preload/item_list/', '/api/recommend/item_list/', '/api/following/item_list/', '/api/post/item_list/', '/api/favorite/item_list/', '/api/collection/item_list/'].includes(Path)) {
		RequireMethod(Request, ['GET', 'POST']);
		const Filter = { viewer: User?.id, before: Params.get('cursor') === '0' ? undefined : Params.get('cursor'), limit: Params.get('count') };
		if (Path.includes('/following/')) { if (!User) throw new HttpError(401, 'NotLoggedIn'); Filter.following = User.id; }
		if (Path.includes('/post/')) Filter.author = (await FindUser(Pool, Params.get('uniqueId') || Params.get('secUid') || User?.id, !Params.get('uniqueId'))).id;
		if (Path.includes('/favorite/')) Filter.likedBy = (await FindUser(Pool, Params.get('secUid') || User?.id, true)).id;
		if (Path.includes('/collection/')) { if (!User) throw new HttpError(401, 'NotLoggedIn'); Filter.savedBy = User.id; }
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
		Json(Response, { statusCode: 0, userInfo: { user: UserShape(Target, Config.Origin), stats: await UserStats(Pool, Target.id) } }); return true;
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
		const Result = await Pool.query('SELECT c.*, u.username, u.display_name FROM comments c JOIN users u ON u.id = c.author_id WHERE c.video_id = $1 ORDER BY c.id DESC LIMIT 50', [VideoId]);
		Json(Response, { status_code: 0, comments: Result.rows.map(Row => ({ cid: Row.id, aweme_id: Row.video_id, text: Row.body, create_time: Math.floor(new Date(Row.created_at).getTime() / 1000), digg_count: 0, reply_comment_total: 0, user_digged: 0, user: { uid: Row.author_id, unique_id: Row.username, nickname: Row.display_name, sec_uid: Row.author_id, avatar_thumb: { url_list: [`${Config.Origin}/public/avatar.svg`] } } })), cursor: 0, has_more: 0, total: Result.rowCount }); return true;
	}
	if (Path === '/api/commit/item/digg/' || Path === '/api/commit/follow/user/' || Path === '/api/collect/item/') {
		RequireMethod(Request, ['POST']); RequireCsrf(Request, User);
		const Body = { ...Object.fromEntries(Params), ...await ReadBody(Request) };
		const Follow = Path.includes('/follow/');
		const Target = Id(Follow ? Body.user_id : Body.item_id || Body.aweme_id);
		const Enabled = String(Body.type ?? Body.action ?? '1') === '1';
		await SetRelation(Pool, Follow ? 'follows' : Path.includes('/collect/') ? 'favorites' : 'likes', Follow ? ['follower_id', 'following_id'] : ['user_id', 'video_id'], [User.id, Target], Enabled);
		Json(Response, { status_code: 0, statusCode: 0, is_digg: Enabled ? 1 : 0 }); return true;
	}
	return false;
}
