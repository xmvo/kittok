import { createHmac, randomBytes } from 'node:crypto';
import { HttpError, Id, Json, ReadBody, ReadRaw, RequireMethod } from '../http.mjs';
import { RequireCsrf, RecordEvent, ClientInfo } from '../auth.mjs';
import { SaveAvatar, AvatarExists, RemoveMedia } from '../media.mjs';
import { FindUser, UserShape, UserStats, Videos, SetRelation, Relation, AddComment, FollowList, AvatarUrl, Activity, UnreadActivity, MarkActivityRead, RelationSql, RecordView } from '../store.mjs';

const ViewSecret = randomBytes(32);

const FollowStatus = Value => ({ 1: 1, 2: 2 })[Value] ?? 0;
const Offset = Value => Math.min(Math.max(Math.floor(Number(Value)) || 0, 0), 100000);
const PageSize = (Value, Default) => Math.min(Math.max(Number(Value) || Default, 1), 50);

function CommentShape(Row, Origin) {
	return {
		cid: Row.id, aweme_id: Row.video_id, text: Row.body, text_extra: [], create_time: Math.floor(new Date(Row.created_at).getTime() / 1000),
		digg_count: Row.likes ?? 0, reply_comment_total: Row.replies ?? 0, user_digged: Row.liked ? 1 : 0, reply_id: Row.parent_id ?? '0', reply_to_reply_id: '0',
		user: { uid: Row.author_id, unique_id: Row.username, nickname: Row.display_name, sec_uid: Row.author_id, avatar_thumb: { url_list: [AvatarUrl(Row, Origin)] } },
	};
}

function ApiUser(Row, Origin) {
	const Avatar = { url_list: [AvatarUrl(Row, Origin)] };
	return { uid: Row.id, sec_uid: Row.id, unique_id: Row.username, nickname: Row.display_name, signature: Row.bio ?? '', avatar_thumb: Avatar, avatar_medium: Avatar, follow_status: FollowStatus(Row.relation), follower_status: [2, 6].includes(Row.relation) ? 1 : 0 };
}

const NoticeKinds = { 500: ['like', 'comment_like', 'comment', 'follow'], 3: ['like', 'comment_like'], 505: ['like', 'comment_like'], 2: ['comment'], 7: ['follow'] };

function NoticeShape(Row, Viewer, Origin) {
	const Code = { like: 1, comment_like: 2, comment: 3, follow: 4 }[Row.kind];
	const Nid = `${Code}${Row.video_id ?? 0}${Row.comment_id ?? 0}${Row.id}`;
	const Notice = { nid: Nid, nid_str: Nid, create_time: Math.floor(Row.epoch), has_read: Row.read, user_id: Viewer };
	const From = ApiUser(Row, Origin);
	const Aweme = Row.video_id && { aweme_id: Row.video_id, aweme_type: 0, desc: Row.description, author: { uid: Row.video_author }, status: { private_status: 0 }, video: { cover: { url_list: [`${Origin}/media/${Row.cover_name}`] } } };
	if (Row.kind === 'follow') return { ...Notice, type: 33, follow: { from_user: From, follow_button_type: Row.relation === 2 ? 0 : 1 } };
	if (Row.kind === 'comment') {
		const Reply = Row.parent_author === Viewer;
		return { ...Notice, type: 31, comment: { comment_type: Reply ? 2 : 1, aweme: Aweme, comment: { cid: Row.comment_id, text: Row.body, text_extra: [], reply_id: Row.parent_id ?? '0', user: From }, ...(Reply ? { reply_comment: { user: { uid: Viewer } } } : {}) } };
	}
	return { ...Notice, type: 41, digg: { digg_type: Row.kind === 'like' ? 1 : 3, merge_count: 1, from_user: [From], aweme: Aweme, ...(Row.kind === 'comment_like' ? { comment: { cid: Row.comment_id, text: Row.body, text_extra: [] } } : {}) } };
}

const ReportReasons = [[101, 'spam', 'Spam or scams'], [102, 'harassment', 'Harassment or bullying'], [103, 'hate', 'Hate speech'], [104, 'nudity', 'Nudity or sexual content'], [105, 'violence', 'Violent or graphic content'],
	[106, 'self_harm', 'Suicide or self-harm'], [107, 'misinformation', 'False information'], [108, 'impersonation', 'Impersonation'], [109, 'copyright', 'Copyright or intellectual property'], [110, 'other', 'Something else']];
const ReportTargets = { video: 'video', photo_mode: 'video', comment: 'comment', user: 'user' };

async function CommentPage(Pool, Origin, Viewer, { video, parent, cursor, count }) {
	const Limit = PageSize(count, 20);
	const After = cursor && cursor !== '0' ? Id(cursor) : null;
	const Result = await Pool.query(`SELECT c.*, u.username, u.display_name, u.avatar_name,
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
		if (Path.includes('/collection/')) { if (!User) throw new HttpError(401, 'NotLoggedIn'); Filter.savedBy = User.id; }
		if (Path.includes('/favorite/') || Path.includes('/user/collect/')) {
			if (!User || (Params.get('secUid') && Params.get('secUid') !== User.id)) { Json(Response, { statusCode: 0, status_code: 0, itemList: [], cursor: '0', hasMore: false, extra: { logid: 'kittok' } }); return true; }
			Filter[Path.includes('/favorite/') ? 'likedBy' : 'savedBy'] = User.id;
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
	if (Path === '/api/user/list/') {
		RequireMethod(Request, ['GET']);
		const Scene = { 21: 'following', 67: 'followers', 150: 'friends', 151: 'suggested' }[Params.get('scene')];
		const Target = Params.get('secUid') && Scene !== 'suggested' ? Id(Params.get('secUid')) : User?.id;
		const Start = Offset(Params.get('minCursor'));
		const List = Scene && Target ? await FollowList(Pool, User?.id, Target, Scene, Start, PageSize(Params.get('count'), 30)) : { users: [], total: 0 };
		const UserList = await Promise.all(List.users.map(async Row => {
			const Stats = await UserStats(Pool, Row.id);
			return { user: UserShape(Row, Config.Origin), stats: Stats, statsV2: Object.fromEntries(Object.entries(Stats).map(([Key, Value]) => [Key, String(Value)])) };
		}));
		Json(Response, { statusCode: 0, status_code: 0, userList: UserList, total: List.total, minCursor: Start + UserList.length, maxCursor: 0, hasMore: Start + UserList.length < List.total }); return true;
	}
	if (Path === '/api/im/spotlight/relation' || Path === '/api/im/spotlight/relation/') {
		RequireMethod(Request, ['GET']);
		const Start = Offset(Params.get('max_time'));
		const List = User ? await FollowList(Pool, User.id, User.id, 'following', Start, PageSize(Params.get('count'), 30)) : { users: [], total: 0 };
		Json(Response, {
			status_code: 0, max_time: Start, min_time: Start + List.users.length, has_more: Start + List.users.length < List.total ? 1 : 0,
			followings: List.users.map(Row => ApiUser(Row, Config.Origin)),
		}); return true;
	}
	if (Path === '/_kittok/view') {
		RequireMethod(Request, ['POST']);
		Limiter.Hit(`view:${Request.socket.remoteAddress}`, 120);
		const VideoId = Id((await ReadBody(Request, 1024)).id);
		await RecordView(Pool, VideoId, User ? `u:${User.id}` : `ip:${createHmac('sha256', ViewSecret).update(Request.socket.remoteAddress ?? '').digest('hex')}`);
		Response.writeHead(204).end(); return true;
	}
	if (Path === '/node/report/reasons') {
		RequireMethod(Request, ['GET']);
		Json(Response, { statusCode: 0, status_code: 0, config: '{}', body: ReportReasons.map(([Code, , Text]) => ({ reason_type: Code, reason_code: Code, text: Text, next_reason: [], special_type: -1, audit_type: -1, option: JSON.stringify({ action: { action_type: 'route', action_params: { route_path: 'Detail_WithDesc', title_text: Text, subtitle_text: 'Add details (optional).' } } }) })) }); return true;
	}
	if (Path === '/aweme/v2/aweme/feedback/' || Path === '/aweme/v1/aweme/feedback/') {
		RequireMethod(Request, ['GET', 'POST']); RequireCsrf(Request, User);
		Limiter.Hit(`report:${User.id}`, 30, 3600000);
		const Body = { ...Object.fromEntries(Params), ...(Request.method === 'POST' ? await ReadBody(Request) : {}) };
		const Type = ReportTargets[Body.report_type];
		const Reason = ReportReasons.find(([Code]) => String(Code) === String(Body.reason));
		if (!Type || !Reason) throw new HttpError(400, 'InvalidReport');
		const Target = Id(Body.object_id || Body.target);
		const Owner = (await Pool.query({ video: 'SELECT author_id AS id FROM videos WHERE id = $1', comment: 'SELECT author_id AS id FROM comments WHERE id = $1', user: 'SELECT id FROM users WHERE id = $1' }[Type], [Target])).rows[0]?.id;
		if (!Owner) throw new HttpError(404, 'ReportTargetNotFound');
		if (Owner === User.id) throw new HttpError(400, 'CannotReportYourself');
		await Pool.query(`INSERT INTO reports(reporter_id, target_type, target_id, owner_id, category, description) VALUES ($1, $2, $3, $4, $5, $6)
			ON CONFLICT (reporter_id, target_type, target_id) WHERE status = 'open' DO NOTHING`, [User.id, Type, Target, Owner, Reason[1], String(Body.report_desc ?? '').trim().slice(0, 500)]);
		Json(Response, { status_code: 0, statusCode: 0, status_msg: '', data: {} }); return true;
	}
	if (Path === '/api/inbox/notice_count/') {
		RequireMethod(Request, ['GET']);
		const Unread = User ? await UnreadActivity(Pool, User.id) : {};
		const Count = Kinds => Kinds.reduce((Sum, Kind) => Sum + (Unread[Kind] ?? 0), 0);
		Json(Response, { status_code: 0, notice_count: [500, 3, 505, 2, 6, 7, 661].map(Group => ({ group: Group, count: Count(NoticeKinds[Group] ?? []) })) }); return true;
	}
	if (Path === '/api/notice/multi/' || Path === '/api/inbox/notice_list/') {
		RequireMethod(Request, ['GET']);
		let Entry;
		try { Entry = JSON.parse(Params.get('group_list') ?? '[]')[0]; } catch { throw new HttpError(400, 'InvalidGroupList'); }
		const Group = Number(Entry?.group);
		const Max = Number(Entry?.max_time) || 0, Min = Number(Entry?.min_time) || 0;
		const Window = Max > 0 ? { Before: Min || Max } : Min > 0 ? { After: Min } : {};
		if (User && Number(Entry?.is_mark_read) === 1) await MarkActivityRead(Pool, User.id);
		const Limit = PageSize(Entry?.count, 20);
		const Rows = User && NoticeKinds[Group] ? await Activity(Pool, User.id, NoticeKinds[Group], Window, Limit + 1) : [];
		const Page = Rows.slice(0, Limit);
		Json(Response, { status_code: 0, notice_lists: [{ group: Group, has_more: Rows.length > Limit ? 1 : 0, max_time: Page[0]?.epoch ?? 0, min_time: Page.at(-1)?.epoch ?? 0, notice_list: Page.map(Row => NoticeShape(Row, User.id, Config.Origin)) }] }); return true;
	}
	if (Path === '/api/upload/image/') {
		RequireMethod(Request, ['POST']); RequireCsrf(Request, User);
		Limiter.Hit(`avatar:${User.id}`, 20, 3600000);
		const Form = await new globalThis.Response(await ReadRaw(Request, 5 * 1024 * 1024), { headers: { 'content-type': Request.headers['content-type'] ?? '' } }).formData().catch(() => null);
		const File = Form?.get('file');
		if (!(File instanceof Blob)) throw new HttpError(400, 'InvalidUpload');
		const Name = await SaveAvatar(Config, User.id, Buffer.from(await File.arrayBuffer()));
		Json(Response, { status_code: 0, data: { uri: Name, url_list: [`${Config.Origin}/media/${Name}`] } }); return true;
	}
	if (Path === '/api/update/profile/') {
		RequireMethod(Request, ['POST']);
		const Body = { ...Object.fromEntries(Params), ...await ReadBody(Request) };
		RequireCsrf(Request, User, Request.headers['x-csrf-token'] ?? Body.tt_csrf_token);
		const Nickname = Body.nickname === undefined ? null : String(Body.nickname).trim();
		const Bio = Body.signature === undefined ? null : String(Body.signature).trim();
		const Avatar = Body.avatar_uri === undefined ? null : String(Body.avatar_uri);
		if (Nickname !== null && (Nickname.length < 1 || Nickname.length > 50)) { Json(Response, { status_code: 2550, status_msg: 'InvalidNickname' }); return true; }
		if (Bio !== null && Bio.length > 160) throw new HttpError(400, 'BioTooLong');
		if (Avatar !== null && !(new RegExp(`^avatar-${User.id}-[0-9a-f-]{36}\\.jpg$`).test(Avatar) && await AvatarExists(Config, Avatar))) throw new HttpError(400, 'InvalidAvatar');
		const Updated = (await Pool.query(`UPDATE users u SET display_name = COALESCE($2, u.display_name), bio = COALESCE($3, u.bio), avatar_name = COALESCE($4, u.avatar_name)
			FROM (SELECT avatar_name FROM users WHERE id = $1) Previous WHERE u.id = $1
			RETURNING u.id, u.username, u.display_name, u.bio, u.avatar_name, Previous.avatar_name AS previous_avatar`, [User.id, Nickname, Bio, Avatar])).rows[0];
		if (Updated.previous_avatar && Updated.previous_avatar !== Updated.avatar_name) await RemoveMedia(Config, Updated.previous_avatar);
		const Changed = [Nickname !== null && 'name', Bio !== null && 'bio', Avatar !== null && 'avatar'].filter(Boolean);
		if (Changed.length) await RecordEvent(Pool, User.id, 'profile_change', ClientInfo(Request, Config), `Changed ${Changed.join(', ')}`);
		const Url = { url_list: [AvatarUrl(Updated, Config.Origin)] };
		Json(Response, { status_code: 0, status_msg: '', user: { uid: Updated.id, sec_uid: Updated.id, unique_id: Updated.username, nickname: Updated.display_name, signature: Updated.bio, avatar_thumb: Url, avatar_medium: Url, avatar_larger: Url } }); return true;
	}
	if (Path === '/api/uniqueid/check/') {
		RequireMethod(Request, ['GET']);
		const Name = String(Params.get('unique_id') ?? '').toLowerCase();
		const Valid = /^[a-z0-9_]{3,24}$/.test(Name) && (Name === User?.username || !(await Pool.query('SELECT 1 FROM users WHERE username = $1', [Name])).rowCount);
		Json(Response, { status_code: 0, is_valid: Valid }); return true;
	}
	if (Path === '/api/user/collection_list/') {
		RequireMethod(Request, ['GET']);
		Json(Response, { statusCode: 0, status_code: 0, collectionList: [], cursor: '0', hasMore: false }); return true;
	}
	async function SearchUsers(Limit) {
		if (Config.Features?.search === false) return [];
		const Query = `%${(Params.get('keyword') ?? '').slice(0, 100).replace(/[\\%_]/g, '\\$&')}%`;
		const Result = await Pool.query(`SELECT u.id, u.username, u.display_name, u.bio, u.avatar_name, ${RelationSql('$3::bigint', 'u.id')} AS relation FROM users u
			WHERE u.username ILIKE $1 ESCAPE '\\' OR u.display_name ILIKE $1 ESCAPE '\\' ORDER BY u.username LIMIT $2`, [Query, Limit, User?.id ?? null]);
		return Promise.all(Result.rows.map(async Row => {
			const Stats = await UserStats(Pool, Row.id);
			return { user_info: { ...ApiUser(Row, Config.Origin), follower_count: Stats.followerCount, following_count: Stats.followingCount, aweme_count: Stats.videoCount, total_favorited: Stats.heartCount } };
		}));
	}
	async function SearchVideos() {
		const Cursor = Params.get('cursor');
		const Keyword = (Params.get('keyword') ?? '').trim();
		if (!Keyword || Config.Features?.search === false) return { items: [], hasMore: false, cursor: Cursor ?? '0' };
		return Videos(Pool, Config.Origin, { query: Keyword, viewer: User?.id, before: Cursor && Cursor !== '0' ? Cursor : undefined, limit: Params.get('count') ?? 12 });
	}
	if (Path === '/api/search/user/full/') {
		RequireMethod(Request, ['GET']);
		Json(Response, { status_code: 0, user_list: await SearchUsers(20), cursor: 0, has_more: 0 }); return true;
	}
	if (Path === '/api/search/item/full/') {
		RequireMethod(Request, ['GET']);
		const Found = await SearchVideos();
		Json(Response, { status_code: 0, item_list: Found.items, cursor: Found.cursor, has_more: Found.hasMore ? 1 : 0, extra: { logid: 'kittok' } }); return true;
	}
	if (Path === '/api/search/general/full/') {
		RequireMethod(Request, ['GET']);
		const First = !Params.get('cursor') || Params.get('cursor') === '0';
		const People = First && Params.get('keyword')?.trim() ? await SearchUsers(5) : [];
		const Found = await SearchVideos();
		const Data = [...(People.length ? [{ type: 4, user_list: People, view_more: People.length === 5, common: {} }] : []), ...Found.items.map(Item => ({ type: 1, item: Item, common: {} }))];
		Json(Response, { status_code: 0, data: Data, cursor: Found.cursor, has_more: Found.hasMore ? 1 : 0, extra: { logid: 'kittok' } }); return true;
	}
	if (Path === '/api/search/photo/full/' || Path === '/api/search/live/full/') {
		RequireMethod(Request, ['GET']);
		Json(Response, { status_code: 0, item_list: [], data: [], cursor: 0, has_more: 0, extra: { logid: 'kittok' } }); return true;
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
	if (Path === '/api/comment/delete/') {
		RequireMethod(Request, ['POST']); RequireCsrf(Request, User);
		const Body = { ...Object.fromEntries(Params), ...await ReadBody(Request) };
		const Deleted = await Pool.query('DELETE FROM comments c USING videos v WHERE c.id = $1 AND v.id = c.video_id AND (c.author_id = $2 OR v.author_id = $2 OR $3) RETURNING c.id', [Id(Body.cid), User.id, User.role === 'admin']);
		if (!Deleted.rowCount) throw new HttpError(404, 'CommentNotFound');
		Json(Response, { status_code: 0, statusCode: 0 }); return true;
	}
	if (Path === '/api/comment/digg/') {
		RequireMethod(Request, ['POST']); RequireCsrf(Request, User);
		const Body = { ...Object.fromEntries(Params), ...await ReadBody(Request) };
		await SetRelation(Pool, 'comment_likes', ['user_id', 'comment_id'], [User.id, Id(Body.cid)], String(Body.digg_type ?? '1') === '1');
		Json(Response, { status_code: 0, statusCode: 0 }); return true;
	}
	if (Path === '/api/comment/publish/') {
		RequireMethod(Request, ['POST']); RequireCsrf(Request, User);
		if (Config.Features?.comments === false) throw new HttpError(403, 'CommentsDisabled');
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
