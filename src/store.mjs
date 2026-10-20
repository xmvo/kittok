import { HttpError, Id } from './http.mjs';
import { Transaction } from './db.mjs';
import { RemovedSql, ForYouIneligibleSql } from './moderation.mjs';

export const AvatarUrl = (User, Origin) => User.avatar_name ? `${Origin}/media/${User.avatar_name}` : `${Origin}/public/avatar.svg`;

export function UserShape(User, Origin) {
	const Avatar = AvatarUrl(User, Origin);
	return {
		id: User.id, uniqueId: User.username, nickname: User.display_name, secUid: User.id,
		signature: User.bio ?? '', verified: false, privateAccount: false, secret: false,
		avatarThumb: Avatar, avatarMedium: Avatar, avatarLarger: Avatar,
		following: 0, relation: User.relation ?? 0,
	};
}

export const BlockedBetween = (A, B) => `EXISTS (SELECT 1 FROM blocks WHERE (blocker_id = ${A} AND blocked_id = ${B}) OR (blocker_id = ${B} AND blocked_id = ${A}))`;

export const RelationSql = (Viewer, Target) => `CASE
	WHEN EXISTS (SELECT 1 FROM blocks WHERE blocker_id = ${Viewer} AND blocked_id = ${Target}) THEN 4
	WHEN EXISTS (SELECT 1 FROM blocks WHERE blocker_id = ${Target} AND blocked_id = ${Viewer}) THEN 5
	WHEN EXISTS (SELECT 1 FROM follows WHERE follower_id = ${Viewer} AND following_id = ${Target})
		THEN CASE WHEN EXISTS (SELECT 1 FROM follows WHERE follower_id = ${Target} AND following_id = ${Viewer}) THEN 2 ELSE 1 END
	WHEN EXISTS (SELECT 1 FROM follows WHERE follower_id = ${Target} AND following_id = ${Viewer}) THEN 6 ELSE 0 END`;

export async function SetBlock(Pool, Blocker, Blocked, On) {
	if (Blocker === Blocked) throw new HttpError(400, 'CannotBlockYourself');
	return Transaction(Pool, async Client => {
		if (!(await Client.query('SELECT 1 FROM users WHERE id = $1', [Blocked])).rowCount) throw new HttpError(404, 'UserNotFound');
		if (On) {
			await Client.query('INSERT INTO blocks(blocker_id, blocked_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [Blocker, Blocked]);
			await Client.query('DELETE FROM follows WHERE (follower_id = $1 AND following_id = $2) OR (follower_id = $2 AND following_id = $1)', [Blocker, Blocked]);
		} else {
			await Client.query('DELETE FROM blocks WHERE blocker_id = $1 AND blocked_id = $2', [Blocker, Blocked]);
		}
	});
}

export async function BlockList(Pool, Viewer, Offset, Limit) {
	const Result = await Pool.query(`SELECT u.id, u.username, u.display_name, u.bio, u.avatar_name, 4 AS relation, count(*) OVER ()::int AS total
		FROM blocks b JOIN users u ON u.id = b.blocked_id WHERE b.blocker_id = $1 ORDER BY b.created_at DESC, u.id DESC OFFSET $2 LIMIT $3`, [Viewer, Offset, Limit]);
	return { users: Result.rows, total: Result.rows[0]?.total ?? 0 };
}

export const DmAudiences = { dm_setting_friends: 'dm_friends', dm_setting_potential_connection: 'dm_potential', dm_setting_others: 'dm_others' };

export async function DmSettings(Pool, UserId) {
	const Row = (await Pool.query('SELECT dm_friends, dm_potential, dm_others FROM users WHERE id = $1', [UserId])).rows[0];
	return Object.fromEntries(Object.entries(DmAudiences).map(([Field, Column]) => [Field, Row[Column]]));
}

export async function SetDmSetting(Pool, UserId, Field, Value) {
	if (!DmAudiences[Field] || ![1, 3].includes(Number(Value))) throw new HttpError(400, 'InvalidMessageSetting');
	await Pool.query(`UPDATE users SET ${DmAudiences[Field]} = $2 WHERE id = $1`, [UserId, Number(Value)]);
}

export async function Relation(Pool, Viewer, Target) {
	const Result = await Pool.query(`SELECT ${RelationSql('$1::bigint', '$2::bigint')} AS relation`, [Viewer ?? null, Target]);
	return Result.rows[0].relation;
}

export async function FollowList(Pool, Viewer, Target, Scene, Offset, Limit) {
	const From = {
		following: 'follows f JOIN users u ON u.id = f.following_id WHERE f.follower_id = $2',
		followers: 'follows f JOIN users u ON u.id = f.follower_id WHERE f.following_id = $2',
		friends: 'follows f JOIN users u ON u.id = f.following_id WHERE f.follower_id = $2 AND EXISTS (SELECT 1 FROM follows b WHERE b.follower_id = u.id AND b.following_id = $2)',
		suggested: 'users u WHERE u.id <> $2 AND NOT EXISTS (SELECT 1 FROM follows b WHERE b.follower_id = $2 AND b.following_id = u.id)',
	}[Scene];
	const Result = await Pool.query(`SELECT u.id, u.username, u.display_name, u.bio, u.avatar_name, ${RelationSql('$1::bigint', 'u.id')} AS relation, count(*) OVER ()::int AS total
		FROM ${From} AND NOT ${BlockedBetween('$1::bigint', 'u.id')} ORDER BY ${Scene === 'suggested' ? 'u.created_at' : 'f.created_at'} DESC, u.id DESC OFFSET $3 LIMIT $4`, [Viewer ?? null, Target, Offset, Limit]);
	return { users: Result.rows, total: Result.rows[0]?.total ?? 0 };
}

const ActivitySql = `
	SELECT 'like' AS kind, l.created_at AS at, l.user_id AS actor, v.id AS video_id, NULL::bigint AS comment_id FROM likes l JOIN videos v ON v.id = l.video_id WHERE v.author_id = $1 AND l.user_id <> $1
	UNION ALL SELECT 'comment_like', cl.created_at, cl.user_id, c.video_id, c.id FROM comment_likes cl JOIN comments c ON c.id = cl.comment_id WHERE c.author_id = $1 AND cl.user_id <> $1
	UNION ALL SELECT 'comment', c.created_at, c.author_id, c.video_id, c.id FROM comments c JOIN videos v ON v.id = c.video_id LEFT JOIN comments p ON p.id = c.parent_id WHERE c.author_id <> $1 AND (v.author_id = $1 OR p.author_id = $1)
	UNION ALL SELECT 'follow', f.created_at, f.follower_id, NULL, NULL FROM follows f WHERE f.following_id = $1`;
const VisibleActivity = `(a.comment_id IS NULL OR NOT ${RemovedSql('comment', 'a.comment_id')}) AND (a.video_id IS NULL OR NOT ${RemovedSql('video', 'a.video_id')})
	AND NOT EXISTS (SELECT 1 FROM users banned WHERE banned.id = a.actor AND banned.suspended_at IS NOT NULL)`;

export async function Activity(Pool, UserId, Kinds, { Before = null, After = null }, Limit) {
	const Result = await Pool.query(`SELECT a.kind, a.at, extract(epoch FROM a.at)::float8 AS epoch, a.at <= me.notices_read_at AS read,
		u.id, u.username, u.display_name, u.bio, u.avatar_name, ${RelationSql('$1', 'u.id')} AS relation,
		a.video_id, v.author_id AS video_author, v.cover_name, v.description, a.comment_id, c.body, c.parent_id, p.author_id AS parent_author
		FROM (${ActivitySql}) a JOIN users me ON me.id = $1 JOIN users u ON u.id = a.actor
		LEFT JOIN videos v ON v.id = a.video_id LEFT JOIN comments c ON c.id = a.comment_id LEFT JOIN comments p ON p.id = c.parent_id
		WHERE a.kind = ANY($2) AND NOT ${BlockedBetween('$1', 'a.actor')} AND ${VisibleActivity} AND ($3::float8 IS NULL OR a.at < to_timestamp($3)) AND ($5::float8 IS NULL OR a.at > to_timestamp($5))
		ORDER BY a.at DESC LIMIT $4`, [UserId, Kinds, Before, Limit, After]);
	return Result.rows;
}

export async function UnreadActivity(Pool, UserId) {
	const Result = await Pool.query(`SELECT a.kind, count(*)::int AS count FROM (${ActivitySql}) a JOIN users me ON me.id = $1 WHERE a.at > me.notices_read_at AND NOT ${BlockedBetween('$1', 'a.actor')} AND ${VisibleActivity} GROUP BY a.kind`, [UserId]);
	return Object.fromEntries(Result.rows.map(Row => [Row.kind, Row.count]));
}

export async function MarkActivityRead(Pool, UserId) {
	await Pool.query('UPDATE users SET notices_read_at = now() WHERE id = $1', [UserId]);
}

export async function RecordView(Pool, VideoId, Viewer) {
	await Pool.query(`WITH Video AS (SELECT id FROM videos WHERE id = $1),
		Seen AS (INSERT INTO video_views(video_id, viewer) SELECT id, $2 FROM Video
			ON CONFLICT (video_id, viewer) DO UPDATE SET viewed_at = now() WHERE video_views.viewed_at < now() - interval '6 hours'
			RETURNING video_id)
		UPDATE videos SET view_count = view_count + 1 WHERE id IN (SELECT video_id FROM Seen)`, [VideoId, Viewer]);
}

export async function FindUser(Pool, Value, ById = false) {
	const Result = await Pool.query(`SELECT id, username, display_name, bio, role, avatar_name FROM users WHERE ${ById ? 'id' : 'username'} = $1`, [ById ? Id(Value) : String(Value).toLowerCase()]);
	if (!Result.rowCount) throw new HttpError(404, 'UserNotFound');
	return Result.rows[0];
}

export async function UserStats(Pool, UserId) {
	const Result = await Pool.query(`SELECT
		(SELECT count(*)::int FROM follows WHERE following_id = $1) AS "followerCount",
		(SELECT count(*)::int FROM follows WHERE follower_id = $1) AS "followingCount",
		(SELECT count(*)::int FROM videos WHERE author_id = $1) AS "videoCount",
		(SELECT count(*)::int FROM likes l JOIN videos v ON v.id = l.video_id WHERE v.author_id = $1) AS "heartCount",
		(SELECT count(*)::int FROM likes WHERE user_id = $1) AS "diggCount"`, [UserId]);
	return { ...Result.rows[0], heart: Result.rows[0].heartCount };
}

export async function Videos(Pool, Origin, { before, author, following, likedBy, savedBy, id, viewer, query, forYou, limit = 20 } = {}) {
	const Values = [viewer ?? null];
	const Conditions = [];
	function Where(Sql, Value) { Values.push(Value); Conditions.push(Sql.replace('?', `$${Values.length}`)); }
	if (before) Where('v.id < ?', Id(before));
	if (author) Where('v.author_id = ?', Id(author));
	if (following) Where('EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = ? AND f.following_id = v.author_id)', following);
	if (likedBy) Where('EXISTS (SELECT 1 FROM likes l WHERE l.user_id = ? AND l.video_id = v.id)', likedBy);
	if (savedBy) Where('EXISTS (SELECT 1 FROM favorites f WHERE f.user_id = ? AND f.video_id = v.id)', savedBy);
	if (id) Where('v.id = ?', Id(id));
	if (query) Where("v.description ILIKE ? ESCAPE '\\'", `%${String(query).slice(0, 100).replace(/[\\%_]/g, '\\$&')}%`);
	Conditions.push(`NOT ${BlockedBetween('$1', 'v.author_id')}`);
	Conditions.push(`NOT ${RemovedSql('video', 'v.id')}`, 'u.suspended_at IS NULL');
	if (forYou) Conditions.push(`NOT ${ForYouIneligibleSql('v.id')}`);
	Values.push(Math.min(Math.max(Number(limit) || 20, 1), 50) + 1);
	const Result = await Pool.query(`SELECT v.*, u.username, u.display_name, u.bio, u.avatar_name,
		(SELECT count(*)::int FROM likes l WHERE l.video_id = v.id) AS likes,
		(SELECT count(*)::int FROM comments c WHERE c.video_id = v.id AND NOT ${RemovedSql('comment', 'c.id')}) AS comments,
		(SELECT count(*)::int FROM favorites f WHERE f.video_id = v.id) AS favorites,
		EXISTS (SELECT 1 FROM likes l WHERE l.video_id = v.id AND l.user_id = $1) AS liked,
		EXISTS (SELECT 1 FROM favorites f WHERE f.video_id = v.id AND f.user_id = $1) AS saved,
		${RelationSql('$1', 'v.author_id')} AS relation
		FROM videos v JOIN users u ON u.id = v.author_id ${Conditions.length ? `WHERE ${Conditions.join(' AND ')}` : ''}
		ORDER BY v.id DESC LIMIT $${Values.length}`, Values);
	const HasMore = Result.rows.length === Values.at(-1);
	const Rows = HasMore ? Result.rows.slice(0, -1) : Result.rows;
	return { items: Rows.map(Row => VideoShape(Row, Origin)), hasMore: HasMore, cursor: Rows.at(-1)?.id ?? '0' };
}

export function VideoShape(Row, Origin) {
	const Author = UserShape({ ...Row, id: Row.author_id }, Origin);
	const Stats = { diggCount: Row.likes, commentCount: Row.comments, collectCount: Row.favorites, shareCount: 0, playCount: Number(Row.view_count ?? 0) };
	return {
		id: Row.id, desc: Row.description, createTime: Math.floor(new Date(Row.created_at).getTime() / 1000),
		author: Author, stats: Stats, statsV2: Object.fromEntries(Object.entries(Stats).map(([Key, Value]) => [Key, String(Value)])),
		video: {
			id: Row.id, width: Row.width, height: Row.height, duration: Row.duration, ratio: `${Row.height}p`,
			playAddr: `${Origin}/media/${Row.file_name}`, downloadAddr: `${Origin}/media/${Row.file_name}`,
			cover: `${Origin}/media/${Row.cover_name}`, originCover: `${Origin}/media/${Row.cover_name}`, dynamicCover: `${Origin}/media/${Row.cover_name}`,
			format: 'mp4', codecType: 'h264', bitrate: Math.round(Number(Row.bytes) * 8 / Row.duration), bitrateInfo: [],
			encodeUserTag: '', videoQuality: 'normal', subtitleInfos: [], volumeInfo: { Loudness: -15, Peak: 0.8 },
		},
		music: { id: Row.id, title: 'Original sound', authorName: Row.display_name, original: true, duration: Row.duration,
			playUrl: '', coverThumb: Author.avatarThumb, coverMedium: Author.avatarMedium, coverLarge: Author.avatarLarger },
		textExtra: [], challenges: [], digged: Row.liked, collected: Row.saved, itemCommentStatus: 0,
		officalItem: false, secret: false, privateItem: false, shareEnabled: true, duetEnabled: false, stitchEnabled: false,
		forFriend: false, originalItem: false, isAd: false, item_control: {}, contents: [],
	};
}

export async function AddComment(Pool, VideoId, AuthorId, Text, ParentId = null) {
	if (typeof Text !== 'string' || !Text.trim() || Text.length > 1500) throw new HttpError(400, 'InvalidComment');
	const Exists = await Pool.query('SELECT author_id FROM videos WHERE id = $1', [VideoId]);
	if (!Exists.rowCount) throw new HttpError(404, 'VideoNotFound');
	if ((await Pool.query(`SELECT ${BlockedBetween('$1', '$2')} AS blocked`, [AuthorId, Exists.rows[0].author_id])).rows[0].blocked) throw new HttpError(403, 'BlockedRelationship');
	const Added = await Pool.query(`INSERT INTO comments(video_id, author_id, body, parent_id)
		SELECT $1::bigint, $2::bigint, $3::text, Parent.root FROM (
			SELECT NULL::bigint AS root WHERE $4::bigint IS NULL
			UNION ALL SELECT COALESCE(parent_id, id) FROM comments WHERE id = $4::bigint AND video_id = $1::bigint
		) Parent
		RETURNING id, body, created_at, parent_id`, [VideoId, AuthorId, Text.trim(), ParentId]);
	if (!Added.rowCount) throw new HttpError(404, 'CommentNotFound');
	return Added.rows[0];
}

export async function SetRelation(Pool, Table, Columns, Values, Enabled) {
	const Allowed = { likes: ['user_id', 'video_id'], favorites: ['user_id', 'video_id'], follows: ['follower_id', 'following_id'], comment_likes: ['user_id', 'comment_id'] };
	if (JSON.stringify(Allowed[Table]) !== JSON.stringify(Columns)) throw new Error('InvalidRelation');
	if (Table === 'follows' && Enabled && (await Pool.query(`SELECT ${BlockedBetween('$1::bigint', '$2::bigint')} AS blocked`, Values)).rows[0].blocked) throw new HttpError(403, 'BlockedRelationship');
	try {
		if (Enabled) await Pool.query(`INSERT INTO ${Table}(${Columns.join(',')}) VALUES ($1, $2) ON CONFLICT DO NOTHING`, Values);
		else await Pool.query(`DELETE FROM ${Table} WHERE ${Columns[0]} = $1 AND ${Columns[1]} = $2`, Values);
	} catch (Error) {
		if (Error.code === '23503') throw new HttpError(404, 'NotFound');
		if (Error.code === '23514') throw new HttpError(400, 'InvalidRelation');
		throw Error;
	}
}
