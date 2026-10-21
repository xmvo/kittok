import { createHash } from 'node:crypto';
import { HttpError, Id } from './http.mjs';
import { Transaction } from './db.mjs';
import { RemovedSql, ForYouIneligibleSql } from './moderation.mjs';
import { PublicBadges } from './badges.mjs';
import { Misc } from './settings.mjs';
import { VideoVisibleSql, CommentsAllowedSql, SetFollow, AssertVideoVisible } from './privacy.mjs';

export const AvatarUrl = (User, Origin) => User.avatar_name ? `${Origin}/media/${User.avatar_name}` : `${Origin}/public/avatar.svg`;

export function UserShape(User, Origin) {
	const Avatar = AvatarUrl(User, Origin);
	return {
		id: User.id, uniqueId: User.username, nickname: User.display_name, secUid: User.id,
		signature: User.bio ?? '', verified: Misc.verifiedBadges && Boolean(User.verified), privateAccount: Boolean(User.private_account), secret: Boolean(User.private_account), downloadSetting: User.allow_downloads === false ? 3 : 0,
		UserStoryStatus: User.story_status ?? 0,
		prideFlag: User.pride_flag ?? '', kittokBadges: PublicBadges(User),
		avatarThumb: Avatar, avatarMedium: Avatar, avatarLarger: Avatar,
		following: 0, relation: User.relation ?? 0,
	};
}

const TagNames = new Map();
const TagPattern = /#([\p{L}\p{N}_]{1,100})/gu;
const MentionPattern = /(?<![\p{L}\p{N}_])@([a-z0-9_]{3,24})(?![a-z0-9_])/giu;
export function TagId(Name) {
	const Lower = Name.toLowerCase();
	const Value = BigInt('0x' + createHash('sha256').update(Lower).digest('hex').slice(0, 15)).toString();
	TagNames.set(Value, Lower);
	return Value;
}
export async function TagName(Pool, Value) {
	if (TagNames.has(Value)) return TagNames.get(Value);
	const Result = await Pool.query(`SELECT DISTINCT lower(m[1]) AS name FROM videos v, regexp_matches(v.description, '#([[:alnum:]_]+)', 'g') m`);
	for (const Row of Result.rows) TagId(Row.name);
	return TagNames.get(Value) ?? null;
}
export const TagSql = Column => `${Column} ~* ('#' || ? || '([^[:alnum:]_]|$)')`;

export function Entities(Text, Mentioned = new Map()) {
	const List = [];
	for (const Match of String(Text ?? '').matchAll(TagPattern)) List.push({ start: Match.index, end: Match.index + Match[0].length, type: 1, name: Match[1].toLowerCase() });
	for (const Match of String(Text ?? '').matchAll(MentionPattern)) {
		const User = Mentioned.get(Match[1].toLowerCase());
		if (User) List.push({ start: Match.index, end: Match.index + Match[0].length, type: 0, user: User });
	}
	return List.sort((A, B) => A.start - B.start);
}

export async function MentionedUsers(Pool, Texts) {
	const Names = [...new Set(Texts.flatMap(Text => [...String(Text ?? '').matchAll(MentionPattern)].map(Match => Match[1].toLowerCase())))];
	if (!Names.length) return new Map();
	const Result = await Pool.query('SELECT id, username FROM users WHERE username = ANY($1) AND suspended_at IS NULL', [Names]);
	return new Map(Result.rows.map(Row => [Row.username, Row]));
}

export function CommentExtra(Text, Mentioned) {
	if (!Misc.hashtags) return [];
	return Entities(Text, Mentioned).filter(Entity => Entity.type === 0)
		.map(Entity => ({ start: Entity.start, end: Entity.end, type: 0, user_id: Entity.user.id, sec_uid: Entity.user.username, hashtag_name: '', is_commerce: false }));
}

export const BlockedBetween = (A, B) => `EXISTS (SELECT 1 FROM blocks WHERE (blocker_id = ${A} AND blocked_id = ${B}) OR (blocker_id = ${B} AND blocked_id = ${A}))`;

export const RelationSql = (Viewer, Target) => `CASE
	WHEN EXISTS (SELECT 1 FROM blocks WHERE blocker_id = ${Viewer} AND blocked_id = ${Target}) THEN 4
	WHEN EXISTS (SELECT 1 FROM blocks WHERE blocker_id = ${Target} AND blocked_id = ${Viewer}) THEN 5
	WHEN EXISTS (SELECT 1 FROM follows WHERE follower_id = ${Viewer} AND following_id = ${Target})
		THEN CASE WHEN EXISTS (SELECT 1 FROM follows WHERE follower_id = ${Target} AND following_id = ${Viewer}) THEN 2 ELSE 1 END
	WHEN EXISTS (SELECT 1 FROM follow_requests WHERE follower_id = ${Viewer} AND following_id = ${Target}) THEN 3
	WHEN EXISTS (SELECT 1 FROM follows WHERE follower_id = ${Target} AND following_id = ${Viewer}) THEN 6 ELSE 0 END`;

export async function SetBlock(Pool, Blocker, Blocked, On) {
	if (Blocker === Blocked) throw new HttpError(400, 'CannotBlockYourself');
	return Transaction(Pool, async Client => {
		await Client.query('SELECT id FROM users WHERE id = ANY($1::bigint[]) ORDER BY id FOR NO KEY UPDATE', [[Blocker, Blocked]]);
		if (!(await Client.query('SELECT 1 FROM users WHERE id = $1', [Blocked])).rowCount) throw new HttpError(404, 'UserNotFound');
		if (On) {
			await Client.query('INSERT INTO blocks(blocker_id, blocked_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [Blocker, Blocked]);
			await Client.query('DELETE FROM follow_requests WHERE (follower_id = $1 AND following_id = $2) OR (follower_id = $2 AND following_id = $1)', [Blocker, Blocked]);
			await Client.query('DELETE FROM follows WHERE (follower_id = $1 AND following_id = $2) OR (follower_id = $2 AND following_id = $1)', [Blocker, Blocked]);
		} else {
			await Client.query('DELETE FROM blocks WHERE blocker_id = $1 AND blocked_id = $2', [Blocker, Blocked]);
		}
	});
}

export async function BlockList(Pool, Viewer, Offset, Limit) {
	const Result = await Pool.query(`SELECT u.id, u.username, u.display_name, u.bio, u.avatar_name, u.verified, u.pride_flag, u.user_badges, u.private_account, 4 AS relation, count(*) OVER ()::int AS total
		FROM blocks b JOIN users u ON u.id = b.blocked_id WHERE b.blocker_id = $1 ORDER BY b.created_at DESC, u.id DESC OFFSET $2 LIMIT $3`, [Viewer, Offset, Limit]);
	return { users: Result.rows, total: Result.rows[0]?.total ?? 0 };
}

export const DmAudiences = { dm_setting_friends: 'dm_friends', dm_setting_potential_connection: 'dm_potential', dm_setting_others: 'dm_others' };

export async function DmSettings(Pool, UserId) {
	const Row = (await Pool.query('SELECT dm_friends, dm_potential, dm_others, dm_read_status FROM users WHERE id = $1', [UserId])).rows[0];
	return { ...Object.fromEntries(Object.entries(DmAudiences).map(([Field, Column]) => [Field, Row[Column]])), message_read_status: Row.dm_read_status ? 1 : 0 };
}

export async function SetDmSetting(Pool, UserId, Field, Value) {
	const ReadStatus = Field === 'message_read_status';
	if ((!ReadStatus && !DmAudiences[Field]) || !['number', 'string'].includes(typeof Value) || !String(Value).trim() || !(ReadStatus ? [0, 1] : [1, 2, 3]).includes(Number(Value))) throw new HttpError(400, 'InvalidMessageSetting');
	await Pool.query(`UPDATE users SET ${ReadStatus ? 'dm_read_status' : DmAudiences[Field]} = $2 WHERE id = $1`, [UserId, ReadStatus ? Number(Value) === 1 : Number(Value)]);
}

export async function Relation(Pool, Viewer, Target) {
	const Result = await Pool.query(`SELECT ${RelationSql('$1::bigint', '$2::bigint')} AS relation`, [Viewer ?? null, Target]);
	return Result.rows[0].relation;
}

export async function FollowList(Pool, Viewer, Target, Scene, Offset, Limit) {
	if (Viewer !== Target && (await Pool.query('SELECT 1 FROM users u WHERE u.id = $2 AND u.private_account AND NOT EXISTS (SELECT 1 FROM follows WHERE follower_id = $1 AND following_id = $2)', [Viewer ?? null, Target])).rowCount) return { users: [], total: 0 };
	const From = {
		following: 'follows f JOIN users u ON u.id = f.following_id WHERE f.follower_id = $2',
		followers: 'follows f JOIN users u ON u.id = f.follower_id WHERE f.following_id = $2',
		friends: 'follows f JOIN users u ON u.id = f.following_id WHERE f.follower_id = $2 AND EXISTS (SELECT 1 FROM follows b WHERE b.follower_id = u.id AND b.following_id = $2)',
		suggested: 'users u WHERE u.id <> $2 AND NOT EXISTS (SELECT 1 FROM follows b WHERE b.follower_id = $2 AND b.following_id = u.id)',
	}[Scene];
	const Result = await Pool.query(`SELECT u.id, u.username, u.display_name, u.bio, u.avatar_name, u.verified, u.pride_flag, u.user_badges, u.private_account, ${RelationSql('$1::bigint', 'u.id')} AS relation, count(*) OVER ()::int AS total
		FROM ${From} AND u.suspended_at IS NULL AND NOT ${BlockedBetween('$1::bigint', 'u.id')} ORDER BY ${Scene === 'suggested' ? 'u.created_at' : 'f.created_at'} DESC, u.id DESC OFFSET $3 LIMIT $4`, [Viewer ?? null, Target, Offset, Limit]);
	return { users: Result.rows, total: Result.rows[0]?.total ?? 0 };
}

const ActivitySql = `
	SELECT 'like' AS kind, l.created_at AS at, l.user_id AS actor, v.id AS video_id, NULL::bigint AS comment_id FROM likes l JOIN videos v ON v.id = l.video_id WHERE v.author_id = $1 AND l.user_id <> $1
	UNION ALL SELECT 'comment_like', cl.created_at, cl.user_id, c.video_id, c.id FROM comment_likes cl JOIN comments c ON c.id = cl.comment_id WHERE c.author_id = $1 AND cl.user_id <> $1
	UNION ALL SELECT 'comment', c.created_at, c.author_id, c.video_id, c.id FROM comments c JOIN videos v ON v.id = c.video_id LEFT JOIN comments p ON p.id = c.parent_id WHERE c.author_id <> $1 AND (v.author_id = $1 OR p.author_id = $1)
	UNION ALL SELECT 'follow', f.created_at, f.follower_id, NULL, NULL FROM follows f WHERE f.following_id = $1
	UNION ALL SELECT 'approved', f.approved_at, f.following_id, NULL, NULL FROM follows f WHERE f.follower_id = $1 AND f.approved_at IS NOT NULL
	UNION ALL SELECT 'mention', c.created_at, c.author_id, c.video_id, c.id FROM comments c JOIN users m ON m.id = $1 WHERE c.author_id <> $1 AND c.body ~* ('(^|[^[:alnum:]_])@' || m.username || '([^[:alnum:]_]|$)')
	UNION ALL SELECT 'mention', v.created_at, v.author_id, v.id, NULL FROM videos v JOIN users m ON m.id = $1 WHERE v.author_id <> $1 AND v.description ~* ('(^|[^[:alnum:]_])@' || m.username || '([^[:alnum:]_]|$)')`;
const Merged = "a.kind IN ('like', 'comment_like')";
const NoticeKey = () => `CASE WHEN ${Misc.groupedLikes ? Merged : 'false'} THEN a.kind || ':' || a.video_id || ':' || coalesce(a.comment_id, 0) ELSE a.kind || ':' || a.actor || ':' || a.at || ':' || coalesce(a.comment_id, 0) END`;
const VisibleActivity = `(a.video_id IS NULL OR EXISTS (SELECT 1 FROM videos pv JOIN users pu ON pu.id = pv.author_id WHERE pv.id = a.video_id AND ${VideoVisibleSql('$1', 'pv', 'pu')})) AND (a.comment_id IS NULL OR NOT ${RemovedSql('comment', 'a.comment_id')}) AND (a.video_id IS NULL OR NOT ${RemovedSql('video', 'a.video_id')})
	AND NOT EXISTS (SELECT 1 FROM users banned WHERE banned.id = a.actor AND banned.suspended_at IS NOT NULL)`;

export async function Activity(Pool, UserId, Kinds, { Before = null, After = null }, Limit) {
	const Result = await Pool.query(`WITH Grouped AS (
			SELECT a.kind, max(a.at) AS at, (array_agg(a.actor ORDER BY a.at DESC))[1] AS actor, (array_agg(a.actor ORDER BY a.at DESC))[2] AS second_actor,
				count(*)::int AS merge_count, a.video_id, a.comment_id
			FROM (${ActivitySql}) a WHERE a.kind = ANY($2) AND NOT ${BlockedBetween('$1', 'a.actor')} AND ${VisibleActivity}
			GROUP BY ${NoticeKey()}, a.kind, a.video_id, a.comment_id)
		SELECT a.kind, a.at, extract(epoch FROM a.at)::float8 AS epoch, a.at <= me.notices_read_at AS read, a.merge_count,
		u.id, u.username, u.display_name, u.bio, u.avatar_name, u.verified, u.pride_flag, u.user_badges, u.private_account, ${RelationSql('$1', 'u.id')} AS relation,
		CASE WHEN s.id IS NOT NULL THEN json_build_object('id', s.id, 'username', s.username, 'display_name', s.display_name, 'bio', s.bio, 'avatar_name', s.avatar_name, 'verified', s.verified, 'pride_flag', s.pride_flag, 'user_badges', s.user_badges, 'relation', ${RelationSql('$1', 's.id')}) END AS second,
		a.video_id, v.author_id AS video_author, v.cover_name, v.description, a.comment_id, c.body, c.parent_id, p.author_id AS parent_author
		FROM Grouped a JOIN users me ON me.id = $1 JOIN users u ON u.id = a.actor LEFT JOIN users s ON s.id = a.second_actor
		LEFT JOIN videos v ON v.id = a.video_id LEFT JOIN comments c ON c.id = a.comment_id LEFT JOIN comments p ON p.id = c.parent_id
		WHERE ($3::float8 IS NULL OR a.at < to_timestamp($3)) AND ($5::float8 IS NULL OR a.at > to_timestamp($5))
		ORDER BY a.at DESC LIMIT $4`, [UserId, Kinds, Before, Limit, After]);
	return Result.rows;
}

export async function UnreadActivity(Pool, UserId) {
	const Result = await Pool.query(`SELECT a.kind, count(DISTINCT ${NoticeKey()})::int AS count FROM (${ActivitySql}) a JOIN users me ON me.id = $1 WHERE a.at > me.notices_read_at AND NOT ${BlockedBetween('$1', 'a.actor')} AND ${VisibleActivity} GROUP BY a.kind`, [UserId]);
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
	const Result = await Pool.query(`SELECT id, username, display_name, bio, role, avatar_name, verified, pride_flag, user_badges, private_account, comment_permission, allow_downloads FROM users WHERE ${ById ? 'id' : 'username'} = $1 AND deactivated_at IS NULL`, [ById ? Id(Value) : String(Value).toLowerCase()]);
	if (!Result.rowCount) throw new HttpError(404, 'UserNotFound');
	return Result.rows[0];
}

export const StoryStatusSql = (Viewer, Author) => `(SELECT CASE WHEN ${Viewer} IS NULL OR count(*) = 0 THEN 0 WHEN bool_and(EXISTS (SELECT 1 FROM story_views sv WHERE sv.story_id = s.id AND sv.viewer_id = ${Viewer})) THEN 2 ELSE 1 END
	FROM videos s JOIN users su ON su.id = s.author_id WHERE s.author_id = ${Author} AND s.story_expires_at > now() AND ${VideoVisibleSql(Viewer, 's', 'su')})`;

export async function StoryStatus(Pool, Viewer, Author) {
	return (await Pool.query(`SELECT ${StoryStatusSql('$1::bigint', '$2::bigint')} AS status`, [Viewer ?? null, Author])).rows[0].status;
}

export async function UserStats(Pool, UserId) {
	const Result = await Pool.query(`SELECT
		(SELECT count(*)::int FROM follows WHERE following_id = $1) AS "followerCount",
		(SELECT count(*)::int FROM follows WHERE follower_id = $1) AS "followingCount",
		(SELECT count(*)::int FROM videos WHERE author_id = $1 AND story_expires_at IS NULL) AS "videoCount",
		(SELECT count(*)::int FROM likes l JOIN videos v ON v.id = l.video_id WHERE v.author_id = $1) AS "heartCount",
		(SELECT count(*)::int FROM likes WHERE user_id = $1) AS "diggCount"`, [UserId]);
	return { ...Result.rows[0], heart: Result.rows[0].heartCount };
}

export async function Videos(Pool, Origin, { before, author, following, likedBy, savedBy, repostedBy, collection, id, exclude, tag, viewer, query, forYou, category, pinned, friendsOf, story = false, offset = 0, order = 'latest', limit = 20 } = {}) {
	const Values = [viewer ?? null];
	const Conditions = [];
	function Where(Sql, Value) { Values.push(Value); Conditions.push(Sql.replace('?', `$${Values.length}`)); }
	const Offset = order === 'popular' ? Math.max(0, Math.floor(Number(before) || 0)) : Math.max(0, Math.floor(Number(offset) || 0));
	if (story) Conditions.push('v.story_expires_at > now()');
	else if (!id) Conditions.push('v.story_expires_at IS NULL');
	if (before && order === 'latest') Where('v.id < ?', Id(before));
	if (before && order === 'oldest') Where('v.id > ?', Id(before));
	if (pinned === true) Conditions.push('v.pinned_at IS NOT NULL');
	if (pinned === false) Conditions.push('v.pinned_at IS NULL');
	if (author) Where('v.author_id = ?', Id(author));
	if (following) Where('EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = ? AND f.following_id = v.author_id)', following);
	if (friendsOf) Where('EXISTS (SELECT 1 FROM follows a JOIN follows b ON b.follower_id = a.following_id AND b.following_id = a.follower_id WHERE a.follower_id = ? AND a.following_id = v.author_id)', friendsOf);
	if (likedBy) Where('EXISTS (SELECT 1 FROM likes l WHERE l.user_id = ? AND l.video_id = v.id)', likedBy);
	if (savedBy) Where('EXISTS (SELECT 1 FROM favorites f WHERE f.user_id = ? AND f.video_id = v.id)', savedBy);
	if (id) Where('v.id = ?', Id(id));
	if (exclude) Where('v.id <> ?', Id(exclude));
	if (collection) Where('EXISTS (SELECT 1 FROM collection_items c WHERE c.collection_id = ? AND c.video_id = v.id)', collection);
	if (repostedBy) Where('EXISTS (SELECT 1 FROM reposts r WHERE r.user_id = ? AND r.video_id = v.id)', repostedBy);
	if (tag) Where(TagSql('v.description'), String(tag).toLowerCase());
	if (category) Where('v.category = ?', category);
	if (query) Where("v.description ILIKE ? ESCAPE '\\'", `%${String(query).slice(0, 100).replace(/[\\%_]/g, '\\$&')}%`);
	Conditions.push(`NOT ${BlockedBetween('$1', 'v.author_id')}`);
	Conditions.push(VideoVisibleSql('$1::bigint'));
	if (forYou) Conditions.push(`NOT ${ForYouIneligibleSql('v.id')}`);
	Values.push(Math.min(Math.max(Number(limit) || 20, 1), 50) + 1);
	const Result = await Pool.query(`SELECT v.*, u.username, u.display_name, u.bio, u.avatar_name, u.verified, u.pride_flag, u.user_badges, u.private_account, u.allow_downloads,
		(SELECT count(*)::int FROM likes l WHERE l.video_id = v.id) AS likes,
		(SELECT count(*)::int FROM comments c WHERE c.video_id = v.id AND NOT ${RemovedSql('comment', 'c.id')}) AS comments,
		(SELECT count(*)::int FROM favorites f WHERE f.video_id = v.id) AS favorites,
		(SELECT count(*)::int FROM reposts r WHERE r.video_id = v.id) AS reposts,
		EXISTS (SELECT 1 FROM reposts r WHERE r.video_id = v.id AND r.user_id = $1) AS reposted,
		EXISTS (SELECT 1 FROM likes l WHERE l.video_id = v.id AND l.user_id = $1) AS liked,
		EXISTS (SELECT 1 FROM favorites f WHERE f.video_id = v.id AND f.user_id = $1) AS saved,
		${RelationSql('$1', 'v.author_id')} AS relation, ${CommentsAllowedSql('$1::bigint')} AS can_comment, ${StoryStatusSql('$1::bigint', 'v.author_id')} AS story_status,
		v.story_expires_at IS NOT NULL AND EXISTS (SELECT 1 FROM story_views sv WHERE sv.story_id = v.id AND sv.viewer_id = $1) AS story_viewed
		FROM videos v JOIN users u ON u.id = v.author_id ${Conditions.length ? `WHERE ${Conditions.join(' AND ')}` : ''}
		ORDER BY ${pinned ? 'v.pinned_at DESC' : order === 'oldest' ? 'v.id ASC' : order === 'popular' ? 'v.view_count DESC, v.id DESC' : 'v.id DESC'} LIMIT $${Values.length} OFFSET ${Offset}`, Values);
	const HasMore = Result.rows.length === Values.at(-1);
	const Rows = HasMore ? Result.rows.slice(0, -1) : Result.rows;
	const Mentioned = await MentionedUsers(Pool, Rows.map(Row => Row.description));
	return { items: Rows.map(Row => VideoShape(Row, Origin, Mentioned, viewer)), hasMore: HasMore, cursor: order === 'popular' ? String(Offset + Rows.length) : Rows.at(-1)?.id ?? '0' };
}

export function VideoShape(Row, Origin, Mentioned, Viewer) {
	const Author = UserShape({ ...Row, id: Row.author_id }, Origin);
	const Stats = { diggCount: Row.likes, commentCount: Row.comments, collectCount: Row.favorites, shareCount: 0, playCount: Number(Row.view_count ?? 0), repostCount: Misc.reposts ? Row.reposts ?? 0 : 0 };
	const Found = Misc.hashtags ? Entities(Row.description, Mentioned) : [];
	const TextExtra = Found.map(Entity => Entity.type === 1
		? { awemeId: '', start: Entity.start, end: Entity.end, hashtagId: TagId(Entity.name), hashtagName: Entity.name, isCommerce: false, subType: 0, type: 1 }
		: { awemeId: '', start: Entity.start, end: Entity.end, hashtagName: '', isCommerce: false, secUid: Entity.user.id, subType: 0, type: 0, userId: Entity.user.id, userUniqueId: Entity.user.username });
	const Challenges = [...new Set(Found.filter(Entity => Entity.type === 1).map(Entity => Entity.name))]
		.map(Name => ({ id: TagId(Name), title: Name, desc: '', profileThumb: '', profileMedium: '', profileLarger: '', coverThumb: '', coverMedium: '', coverLarger: '', isCommerce: false }));
	return {
		id: Row.id, desc: Row.description, createTime: Math.floor(new Date(Row.created_at).getTime() / 1000), isPinnedItem: Boolean(Row.pinned_at),
		author: Author, stats: Stats, statsV2: Object.fromEntries(Object.entries(Stats).map(([Key, Value]) => [Key, String(Value)])),
		video: {
			id: Row.id, width: Row.width, height: Row.height, duration: Row.duration, ratio: `${Row.height}p`,
			playAddr: `${Origin}/media/${Row.file_name}`, downloadAddr: `${Origin}/api/v1/videos/${Row.id}/download`,
			cover: `${Origin}/media/${Row.cover_name}`, originCover: `${Origin}/media/${Row.cover_name}`, dynamicCover: `${Origin}/media/${Row.cover_name}`,
			format: 'mp4', codecType: 'h264', bitrate: Math.round(Number(Row.bytes) * 8 / Row.duration), bitrateInfo: [],
			encodeUserTag: '', videoQuality: 'normal', subtitleInfos: [], volumeInfo: { Loudness: -15, Peak: 0.8 },
		},
		music: { id: Row.id, title: 'Original sound', authorName: Row.display_name, original: true, duration: Row.duration,
			playUrl: '', coverThumb: Author.avatarThumb, coverMedium: Author.avatarMedium, coverLarge: Author.avatarLarger },
		textExtra: TextExtra, challenges: Challenges, repostList: Misc.reposts && Row.reposted && Viewer ? [{ secUid: Viewer, uid: Viewer }] : [], digged: Row.liked, collected: Row.saved, itemCommentStatus: Row.can_comment === false ? 1 : 0,
		officalItem: false, secret: Row.visibility === 'only_me', privateItem: Row.visibility === 'only_me', shareEnabled: true, duetEnabled: false, stitchEnabled: false,
		authorPrivate: Boolean(Row.private_account), downloadSetting: Row.allow_downloads === false ? 3 : 0, itemMute: false,
		...(Row.story_expires_at ? { story: { Viewed: Boolean(Row.story_viewed), ExpiredAt: String(Math.floor(new Date(Row.story_expires_at).getTime() / 1000)) } } : {}),
		forFriend: Row.visibility === 'friends', originalItem: false, isAd: false, item_control: {}, contents: [{ desc: Row.description, textExtra: TextExtra }],
	};
}

export async function AddComment(Pool, VideoId, AuthorId, Text, ParentId = null) {
	if (typeof Text !== 'string' || !Text.trim() || Text.length > 1500) throw new HttpError(400, 'InvalidComment');
	await AssertVideoVisible(Pool, VideoId, AuthorId);
	const Exists = await Pool.query(`SELECT v.author_id, ${CommentsAllowedSql('$2::bigint')} AS allowed FROM videos v JOIN users u ON u.id = v.author_id WHERE v.id = $1`, [VideoId, AuthorId]);
	if (!Exists.rows[0]?.allowed) throw new HttpError(403, 'CommentsNotAllowed');
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
	const Allowed = { likes: ['user_id', 'video_id'], favorites: ['user_id', 'video_id'], reposts: ['user_id', 'video_id'], follows: ['follower_id', 'following_id'], comment_likes: ['user_id', 'comment_id'] };
	if (JSON.stringify(Allowed[Table]) !== JSON.stringify(Columns)) throw new Error('InvalidRelation');
	if (Table === 'follows') return SetFollow(Pool, Values[0], Values[1], Enabled);
	if (Enabled && ['likes', 'favorites', 'reposts'].includes(Table)) await AssertVideoVisible(Pool, Values[1], Values[0]);
	if (Enabled && Table === 'comment_likes') {
		const Comment = (await Pool.query('SELECT video_id FROM comments WHERE id = $1', [Values[1]])).rows[0];
		if (!Comment) throw new HttpError(404, 'CommentNotFound');
		await AssertVideoVisible(Pool, Comment.video_id, Values[0]);
	}
	try {
		if (Enabled) await Pool.query(`INSERT INTO ${Table}(${Columns.join(',')}) VALUES ($1, $2) ON CONFLICT DO NOTHING`, Values);
		else await Pool.query(`DELETE FROM ${Table} WHERE ${Columns[0]} = $1 AND ${Columns[1]} = $2`, Values);
	} catch (Error) {
		if (Error.code === '23503') throw new HttpError(404, 'NotFound');
		if (Error.code === '23514') throw new HttpError(400, 'InvalidRelation');
		throw Error;
	}
}
