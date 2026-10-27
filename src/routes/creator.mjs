import { HttpError, Id, Json, ReadBody, RequireMethod } from '../http.mjs';
import { RequireCsrf } from '../auth.mjs';
import { RemoveMedia } from '../media.mjs';
import { AvatarUrl, UserStats } from '../store.mjs';

const VisibilityType = { public: 1, only_me: 2, friends: 3, followers: 3 };
const VisibilityName = { 1: 'public', 2: 'only_me', 3: 'friends' };
const Show = { visibility_status: 1, show_type: 2 };
const Seconds = Value => Math.floor(new Date(Value).getTime() / 1000);

const ItemSql = `SELECT v.*, (SELECT count(*)::int FROM likes l WHERE l.video_id = v.id) AS likes, (SELECT count(*)::int FROM comments c WHERE c.video_id = v.id) AS comments,
	(SELECT count(*)::int FROM favorites f WHERE f.video_id = v.id) AS favorites, (SELECT count(*)::int FROM reposts r WHERE r.video_id = v.id) AS reposts FROM videos v`;

function ItemShape(Row, Origin) {
	const Cover = `${Origin}/media/${Row.cover_name}`, Play = `${Origin}/media/${Row.file_name}`;
	const Statistics = { play_count: Number(Row.view_count), digg_count: Row.likes, like_count: Row.likes, comment_count: Row.comments, share_count: 0, collect_count: Row.favorites, favorite_count: Row.favorites, repost_count: Row.reposts };
	return {
		item_id: Row.id, aweme_id: Row.id, desc: Row.description, description: Row.description, title: '', create_time: Seconds(Row.created_at), post_time: Seconds(Row.created_at),
		cover_url: [Cover], cover: { url_list: [Cover] }, duration: Math.round(Row.duration * 1000), width: Row.width, height: Row.height, play_url: [Play],
		video: { duration: Math.round(Row.duration * 1000), width: Row.width, height: Row.height, cover: { url_list: [Cover] }, play_addr: { url_list: [Play] } },
		visibility: VisibilityType[Row.visibility] ?? 1, is_pinned: Boolean(Row.pinned_at), statistics: Statistics, ...Statistics,
		permissions: { can_change_privacy: { show_type: 2, visibility_options: { visibility_everyone: Show, visibility_friends: Show, visibility_only_you: Show } }, can_delete: Show, can_pin: Show, can_edit: Show, can_edit_cover: Show, can_edit_caption: Show, can_change_comment: Show },
		status: { is_delete: false, private_status: Row.visibility === 'public' ? 0 : 1, review_status: 0 },
	};
}

const CommentSql = `SELECT c.id, c.video_id, c.body, c.created_at, c.parent_id, u.id AS user_id, u.username, u.display_name, u.avatar_name, v.description, v.cover_name,
	(SELECT count(*)::int FROM comment_likes l WHERE l.comment_id = c.id) AS likes, (SELECT count(*)::int FROM comments r WHERE r.parent_id = c.id) AS replies,
	EXISTS (SELECT 1 FROM comment_likes l WHERE l.comment_id = c.id AND l.user_id = $1) AS creator_liked
	FROM comments c JOIN videos v ON v.id = c.video_id JOIN users u ON u.id = c.author_id`;

function CommentShape(Row, Origin) {
	return {
		commentId: Row.id, text: Row.body, textExtra: [], createTime: String(Seconds(Row.created_at)), likeCount: Row.likes, replyCount: Row.replies, hasCreatorLiked: Row.creator_liked,
		item: { itemId: Row.video_id, desc: Row.description, coverUrl: [`${Origin}/media/${Row.cover_name}`] },
		user: { uid: Row.user_id, uniqueId: Row.username, nickname: Row.display_name, avatarThumb: [AvatarUrl(Row, Origin)] },
	};
}

async function Comments(Pool, Origin, Creator, Body, Sort = null) {
	const Count = Math.min(Math.max(Number(Body.count) || 20, 1), 50), Offset = Math.max(Number(Body.cursor) || 0, 0);
	const Filters = Body.query?.filterConditions ?? [], Field = Name => Filters.find(Entry => Entry?.fieldName === Name)?.field;
	const Text = String((Body.query?.searchConditions ?? []).find(Entry => Entry?.fieldName === 'text')?.field ?? '').trim().slice(0, 100).replace(/[\\%_]/g, '\\$&');
	const Video = Body.itemId ?? Field('item_id'), From = Field('user_id'), Replied = Field('creator_replied'), Follower = Field('is_follower');
	const Start = Number(Body.dateRange?.startDate) || null, End = Number(Body.dateRange?.endDate) || null;
	const Values = [Creator, Video ? Id(Video) : null, From ? Id(From) : null, Text, Start, End, Replied ?? null, Follower ?? null, Offset, Count + 1];
	const Rows = (await Pool.query(`${CommentSql} WHERE v.author_id = $1 AND c.author_id <> $1 AND ($2::bigint IS NULL OR c.video_id = $2) AND ($3::bigint IS NULL OR c.author_id = $3)
		AND ($4 = '' OR c.body ILIKE '%' || $4 || '%') AND ($5::float8 IS NULL OR c.created_at >= to_timestamp($5)) AND ($6::float8 IS NULL OR c.created_at < to_timestamp($6))
		AND ($7::text IS NULL OR EXISTS (SELECT 1 FROM comments r WHERE r.parent_id = c.id AND r.author_id = $1) = ($7 = '1'))
		AND ($8::text IS NULL OR EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = c.author_id AND f.following_id = $1) = ($8 = '1'))
		ORDER BY ${Sort === 'likes' ? 'likes DESC, ' : Sort === 'replies' ? 'replies DESC, ' : ''}c.created_at DESC, c.id DESC OFFSET $9 LIMIT $10`, Values)).rows;
	return { comments: Rows.slice(0, Count).map(Row => CommentShape(Row, Origin)), cursor: String(Offset + Math.min(Rows.length, Count)), hasMore: Rows.length > Count, total: Rows.length };
}

const DailySql = {
	vv_history: 'SELECT count(*)::int FROM video_views w JOIN videos v ON v.id = w.video_id WHERE v.author_id = $1 AND w.viewed_at >= d AND w.viewed_at < d + interval \'1 day\'',
	reached_audience_history: 'SELECT count(DISTINCT w.viewer)::int FROM video_views w JOIN videos v ON v.id = w.video_id WHERE v.author_id = $1 AND w.viewed_at >= d AND w.viewed_at < d + interval \'1 day\'',
	like_history: 'SELECT count(*)::int FROM likes l JOIN videos v ON v.id = l.video_id WHERE v.author_id = $1 AND l.created_at >= d AND l.created_at < d + interval \'1 day\'',
	comment_history: 'SELECT count(*)::int FROM comments c JOIN videos v ON v.id = c.video_id WHERE v.author_id = $1 AND c.author_id <> $1 AND c.created_at >= d AND c.created_at < d + interval \'1 day\'',
	share_history: 'SELECT count(*)::int FROM reposts r JOIN videos v ON v.id = r.video_id WHERE v.author_id = $1 AND r.created_at >= d AND r.created_at < d + interval \'1 day\'',
	follower_num_history: 'SELECT count(*)::int FROM follows f WHERE f.following_id = $1 AND f.created_at < d + interval \'1 day\'',
	pv_history: 'SELECT ($1::bigint * 0)::int',
};

async function Insights(Pool, Creator, Requests) {
	const Result = {};
	for (const Entry of Requests.slice(0, 40)) {
		const Type = String(Entry?.insigh_type ?? ''), Sql = DailySql[Type];
		if (!Sql && !Type.endsWith('_history')) continue;
		const Days = Math.min(Math.max(Number(Entry.days) || 7, 1), 400), End = Math.min(Math.max(Number(Entry.end_days) || 0, 0), Days);
		const Rows = (await Pool.query(`SELECT (${Sql ?? DailySql.pv_history}) AS value FROM generate_series((now() AT TIME ZONE 'UTC')::date - $2::int, (now() AT TIME ZONE 'UTC')::date - $3::int, interval '1 day') AS g(d0),
			LATERAL (SELECT (g.d0 AT TIME ZONE 'UTC') AS d) day ORDER BY g.d0`, [Creator, Days, End])).rows;
		Result[Type] = Rows.map(Row => ({ status: 0, value: Row.value }));
	}
	return Result;
}

export async function Creator(Context) {
	const { Request, Response, Url, Pool, Config, User } = Context;
	const Path = Url.pathname;
	if (!/^\/(?:tiktok\/creator|tiktok\/studio_platform|tiktok\/v1\/creator|tiktok\/v1\/analytics|tiktok\/v1\/spotlight|api\/v1\/web\/project|tiktokstudio\/api|creator_studio|aweme\/v2\/data|tiktok\/post|tiktok_creator)\//.test(Path) && Path !== '/api/v1/user/profile/upload/') return false;
	const Ok = Body => { Json(Response, { status_code: 0, status_msg: '', statusCode: 0, ...Body }); return true; };
	if (!User) { Json(Response, { status_code: 8, status_msg: 'Login expired', statusCode: 8 }); return true; }

	if (Path === '/tiktok/creator/manage/item_list/v1/') {
		RequireMethod(Request, ['POST']);
		const Body = await ReadBody(Request, 65536);
		const Size = Math.min(Math.max(Number(Body.size) || 20, 1), 50), Cursor = Math.max(Number(Body.cursor) || 0, 0);
		const Strings = Value => typeof Value === 'string' ? [Value] : Value && typeof Value === 'object' ? Object.values(Value).flatMap(Strings) : [];
		const Search = Strings(Body.query?.conditions ?? []).find(Value => Value.trim() && !/^(?:desc|description|title|keyword|search)$/i.test(Value))?.trim().slice(0, 100) ?? '';
		const Order = (Body.query?.sort_orders ?? [])[0];
		const Column = { post_time: 'created_at', play_count: 'view_count', like_count: 'likes', comment_count: 'comments' }[Order?.field_name] ?? 'created_at';
		const Direction = Order?.order === 1 ? 'ASC' : 'DESC';
		const Rows = (await Pool.query(`SELECT * FROM (${ItemSql} WHERE v.author_id = $1 AND v.story_expires_at IS NULL AND ($2 = '' OR v.description ILIKE '%' || $2 || '%')) v
			ORDER BY ${Column} ${Direction}, id DESC OFFSET $3 LIMIT $4`, [User.id, Search.replace(/[\\%_]/g, '\\$&'), Cursor, Size + 1])).rows;
		const Total = (await Pool.query('SELECT count(*)::int AS count FROM videos WHERE author_id = $1 AND story_expires_at IS NULL', [User.id])).rows[0].count;
		return Ok({ item_list: Rows.slice(0, Size).map(Row => ItemShape(Row, Config.Origin)), cursor: Cursor + Math.min(Rows.length, Size), has_more: Rows.length > Size, total_count: Total, enable_query: true });
	}
	if (Path === '/tiktok/creator/item/visibility/v1/') {
		RequireMethod(Request, ['POST']); RequireCsrf(Request, User);
		const Body = await ReadBody(Request);
		const Visibility = VisibilityName[Number(Body.item_visibility_type)];
		if (!Visibility) throw new HttpError(400, 'InvalidVisibility');
		if (!(await Pool.query('UPDATE videos SET visibility = $3 WHERE id = $1 AND author_id = $2', [Id(Body.item_id), User.id, Visibility])).rowCount) throw new HttpError(404, 'VideoNotFound');
		return Ok({});
	}
	const Pin = Path.match(/^\/tiktok\/creator\/top\/item\/(create|delete)\/v1\/$/);
	if (Pin) {
		RequireMethod(Request, ['POST']); RequireCsrf(Request, User);
		const VideoId = Id((await ReadBody(Request)).item_id);
		if (Pin[1] === 'create' && (await Pool.query('SELECT count(*)::int AS pinned FROM videos WHERE author_id = $1 AND pinned_at IS NOT NULL AND id <> $2', [User.id, VideoId])).rows[0].pinned >= 3) {
			Json(Response, { status_code: 3101, status_msg: 'You can pin up to 3 videos.', statusCode: 3101 }); return true;
		}
		if (!(await Pool.query('UPDATE videos SET pinned_at = CASE WHEN $3 THEN coalesce(pinned_at, now()) END WHERE id = $1 AND author_id = $2', [VideoId, User.id, Pin[1] === 'create'])).rowCount) throw new HttpError(404, 'VideoNotFound');
		return Ok({});
	}
	if (Path === '/tiktok/post/edit/v1/') {
		RequireMethod(Request, ['POST']); RequireCsrf(Request, User);
		const Body = await ReadBody(Request, 65536);
		const Visibility = Body.visibility ? { 0: 'public', 1: 'only_me', 2: 'friends' }[Number(Body.visibility.visibility)] : null;
		const Text = Body.is_text_changed || typeof Body.text === 'string' ? String(Body.text ?? '').slice(0, 2200) : null;
		if (Body.visibility && !Visibility) throw new HttpError(400, 'InvalidVisibility');
		if (!(await Pool.query('UPDATE videos SET visibility = coalesce($3, visibility), description = coalesce($4, description) WHERE id = $1 AND author_id = $2', [Id(Body.aweme_id), User.id, Visibility, Text])).rowCount) throw new HttpError(404, 'VideoNotFound');
		return Ok({});
	}
	if (Path === '/tiktok/creator/item/delete/v1/') {
		RequireMethod(Request, ['DELETE', 'POST']); RequireCsrf(Request, User);
		const Removed = (await Pool.query('DELETE FROM videos WHERE id = $1 AND author_id = $2 RETURNING file_name, cover_name, download_name', [Id(Url.searchParams.get('item_id')), User.id])).rows[0];
		if (!Removed) throw new HttpError(404, 'VideoNotFound');
		await Promise.all([RemoveMedia(Config, Removed.file_name), RemoveMedia(Config, Removed.cover_name), Removed.download_name && RemoveMedia(Config, Removed.download_name)]);
		return Ok({});
	}
	if (Path === '/tiktokstudio/api/web/user') {
		RequireMethod(Request, ['GET']);
		const Stats = await UserStats(Pool, User.id);
		return Ok({ 'tt-csrf-token': User.csrf_token, user: { uid: User.id, secUid: User.id, uniqueId: User.username, nickname: User.display_name, avatarThumb: [AvatarUrl(User, Config.Origin)], signature: User.bio ?? '' },
			stats: Stats, userExtra: { profileBio: User.bio ?? '', isVerified: Boolean(User.verified), isPrivate: Boolean(User.private_account), isU16: false } });
	}
	const Counter = { '/tiktokstudio/api/web/counter/getHashCount': 'hash', '/tiktokstudio/api/web/relation/multiGetFollowRelationCount': 'relation' }[Path];
	if (Counter) {
		RequireMethod(Request, ['GET']);
		const Ids = [...new Set(String(Url.searchParams.get('userId') ?? User.id).split(',').filter(Value => /^\d{1,19}$/.test(Value)))].slice(0, 20);
		const Stats = Object.fromEntries(await Promise.all(Ids.map(async Value => [Value, await UserStats(Pool, Value)])));
		if (Counter === 'hash') return Ok({ CountData: Object.fromEntries(Ids.map(Value => [Value, { repined_count: Stats[Value].heartCount, item_count: Stats[Value].videoCount }])) });
		return Ok({ FollowerCount: Object.fromEntries(Ids.map(Value => [Value, Stats[Value].followerCount])), FollowingCount: Object.fromEntries(Ids.map(Value => [Value, Stats[Value].followingCount])) });
	}
	if (Path === '/tiktokstudio/api/web/commentsV2' || Path === '/tiktokstudio/api/web/sorted-comments') {
		RequireMethod(Request, ['POST']);
		const Body = await ReadBody(Request, 65536);
		Json(Response, await Comments(Pool, Config.Origin, User.id, Body, Path.endsWith('sorted-comments') ? { 1: 'likes', 2: 'replies' }[Body.sortType] ?? 'likes' : null)); return true;
	}
	if (Path === '/aweme/v2/data/insight/') {
		RequireMethod(Request, ['GET']);
		let Requests = [];
		try { Requests = JSON.parse(Url.searchParams.get('type_requests') ?? '[]'); } catch {}
		return Ok(await Insights(Pool, User.id, Array.isArray(Requests) ? Requests : []));
	}
	if (Path === '/tiktok/v1/analytics/insights/') return Ok({ insights: [] });
	if (Path === '/api/v1/user/profile/upload/') return Ok({ user: { uid: User.id, unique_id: User.username, nickname: User.display_name, avatar_thumb: { url_list: [AvatarUrl(User, Config.Origin)] }, draft_settings: { cloud_draft_enable: false, draft_limitation: 0 } } });
	if (Path === '/tiktok_creator/editor_tool/api/v1/async_tasks/icon_info') return Ok({ data: { icon_info: [] }, icon_info: [] });
	if (Path === '/creator_studio/inspiration/trending/config/v2') return Ok({ data: {} });
	if (Path === '/tiktok/studio_platform/red_dot') return Ok({ red_dots: [], red_dot_list: [] });
	if (Path === '/tiktok/v1/spotlight/promotion_entity_abtest_hit/get') return Ok({ hit_abtest: false });
	if (Path === '/api/v1/web/project/get/ab/') return Ok({ ab: {}, data: {} });
	if (Path === '/tiktok/v1/creator/academy/filter/') return Ok({ filters: [], categories: [] });
	if (Path === '/tiktok/v1/creator/m10n_center/reward_analytics') return Ok({ data: {} });
	return false;
}
