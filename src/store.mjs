import { HttpError, Id } from './http.mjs';

export function UserShape(User, Origin) {
	return {
		id: User.id, uniqueId: User.username, nickname: User.display_name, secUid: User.id,
		signature: User.bio ?? '', verified: false, privateAccount: false, secret: false,
		avatarThumb: `${Origin}/public/avatar.svg`, avatarMedium: `${Origin}/public/avatar.svg`, avatarLarger: `${Origin}/public/avatar.svg`,
		following: 0, relation: 0,
	};
}

export async function FindUser(Pool, Value, ById = false) {
	const Result = await Pool.query(`SELECT id, username, display_name, bio, role FROM users WHERE ${ById ? 'id' : 'username'} = $1`, [ById ? Id(Value) : String(Value).toLowerCase()]);
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

export async function Videos(Pool, Origin, { before, author, following, likedBy, savedBy, id, viewer, query, limit = 20 } = {}) {
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
	Values.push(Math.min(Math.max(Number(limit) || 20, 1), 50) + 1);
	const Result = await Pool.query(`SELECT v.*, u.username, u.display_name, u.bio,
		(SELECT count(*)::int FROM likes l WHERE l.video_id = v.id) AS likes,
		(SELECT count(*)::int FROM comments c WHERE c.video_id = v.id) AS comments,
		(SELECT count(*)::int FROM favorites f WHERE f.video_id = v.id) AS favorites,
		EXISTS (SELECT 1 FROM likes l WHERE l.video_id = v.id AND l.user_id = $1) AS liked,
		EXISTS (SELECT 1 FROM favorites f WHERE f.video_id = v.id AND f.user_id = $1) AS saved
		FROM videos v JOIN users u ON u.id = v.author_id ${Conditions.length ? `WHERE ${Conditions.join(' AND ')}` : ''}
		ORDER BY v.id DESC LIMIT $${Values.length}`, Values);
	const HasMore = Result.rows.length === Values.at(-1);
	const Rows = HasMore ? Result.rows.slice(0, -1) : Result.rows;
	return { items: Rows.map(Row => VideoShape(Row, Origin)), hasMore: HasMore, cursor: Rows.at(-1)?.id ?? '0' };
}

export function VideoShape(Row, Origin) {
	const Author = UserShape({ ...Row, id: Row.author_id }, Origin);
	const Stats = { diggCount: Row.likes, commentCount: Row.comments, collectCount: Row.favorites, shareCount: 0, playCount: 0 };
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

export async function SetRelation(Pool, Table, Columns, Values, Enabled) {
	const Allowed = { likes: ['user_id', 'video_id'], favorites: ['user_id', 'video_id'], follows: ['follower_id', 'following_id'] };
	if (JSON.stringify(Allowed[Table]) !== JSON.stringify(Columns)) throw new Error('InvalidRelation');
	try {
		if (Enabled) await Pool.query(`INSERT INTO ${Table}(${Columns.join(',')}) VALUES ($1, $2) ON CONFLICT DO NOTHING`, Values);
		else await Pool.query(`DELETE FROM ${Table} WHERE ${Columns[0]} = $1 AND ${Columns[1]} = $2`, Values);
	} catch (Error) {
		if (Error.code === '23503') throw new HttpError(404, 'NotFound');
		if (Error.code === '23514') throw new HttpError(400, 'InvalidRelation');
		throw Error;
	}
}
