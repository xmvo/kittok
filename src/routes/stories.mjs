import { HttpError, Id, Json, RequireMethod } from '../http.mjs';
import { RequireCsrf } from '../auth.mjs';
import { AssertVideoVisible, VideoVisibleSql } from '../privacy.mjs';
import { StoryStatusSql, UserShape, UserStats, Videos } from '../store.mjs';

const Visible = `s.story_expires_at > now() AND ${VideoVisibleSql('$1::bigint', 's', 'su')}`;
const PageSize = 4;
const UserColumns = 'u.id, u.username, u.display_name, u.bio, u.avatar_name, u.verified, u.pride_flag, u.user_badges, u.private_account, u.allow_downloads';
const Stats = async (Pool, Id) => { const Values = await UserStats(Pool, Id); return { stats: Values, statsV2: Object.fromEntries(Object.entries(Values).map(([Key, Value]) => [Key, String(Value)])) }; };

async function StoryIds(Pool, Viewer, Author) {
	return (await Pool.query(`SELECT s.id::text, s.created_at, EXISTS (SELECT 1 FROM story_views sv WHERE sv.story_id = s.id AND sv.viewer_id = $1) AS viewed
		FROM videos s JOIN users su ON su.id = s.author_id WHERE s.author_id = $2 AND ${Visible} ORDER BY s.id`, [Viewer, Author])).rows;
}

async function Page(Pool, Config, Viewer, Author, { Cursor = 0, Backward = false, Insert = null } = {}) {
	const Ids = await StoryIds(Pool, Viewer, Author), Total = Ids.length;
	if (!Total) return null;
	const Unseen = Ids.findIndex(Row => !Row.viewed), At = Ids.findIndex(Row => Row.id === Insert);
	let Start, End;
	if (At >= 0) [Start, End] = [At, At + PageSize];
	else if (Backward) [Start, End] = [Cursor - PageSize, Cursor];
	else if (Cursor > 0) [Start, End] = [Cursor, Cursor + PageSize];
	else [Start, End] = [Math.max(Unseen, 0), Math.max(Unseen, 0) + PageSize];
	Start = Math.min(Math.max(Start, 0), Total - 1); End = Math.min(Math.max(End, Start + 1), Total);
	const Items = (await Videos(Pool, Config.Origin, { author: Author, viewer: Viewer, story: true, order: 'oldest', offset: Start, limit: End - Start })).items;
	return { AuthorId: String(Author), itemList: Items, TotalCount: String(Total), CurrentPosition: String(Start), MinCursor: String(Start), MaxCursor: String(Start + Items.length),
		HasMoreBefore: Start > 0, HasMoreAfter: Start + Items.length < Total, AllViewed: Ids.every(Row => Row.viewed), LastStoryCreatedAt: String(Math.floor(new Date(Ids.at(-1).created_at).getTime() / 1000)) };
}

const Authors = Value => [...new Set(String(Value ?? '').split(',').filter(Item => /^\d{1,19}$/.test(Item)))].slice(0, 20);

export async function Stories(Context) {
	const { Request, Response, Url, Pool, Config, User } = Context;
	const Path = Url.pathname, Params = Url.searchParams, Viewer = User?.id ?? null;
	const Ok = Body => { Json(Response, { statusCode: 0, status_code: 0, ...Body }); return true; };
	if (Path === '/api/story/user_list/') {
		RequireMethod(Request, ['GET']);
		if (!User) return Ok({ storyUsers: [], totalCount: '0', hasMore: false });
		const Start = Math.max(0, Math.floor(Number(Params.get('cursor')) || 0)), Count = Math.min(Math.max(Number(Params.get('count')) || 10, 1), 30);
		const Rows = (await Pool.query(`SELECT ${UserColumns}, ${StoryStatusSql('$1::bigint', 'u.id')} AS story_status, count(*) OVER ()::int AS total,
			(SELECT max(s.id) FROM videos s JOIN users su ON su.id = s.author_id WHERE s.author_id = u.id AND ${Visible}) AS latest
			FROM users u WHERE (u.id = $1 OR EXISTS (SELECT 1 FROM follows WHERE follower_id = $1 AND following_id = u.id)) AND u.suspended_at IS NULL
			AND EXISTS (SELECT 1 FROM videos s JOIN users su ON su.id = s.author_id WHERE s.author_id = u.id AND ${Visible})
			ORDER BY (u.id = $1) DESC, story_status, latest DESC LIMIT $2 OFFSET $3`, [User.id, Count, Start])).rows;
		const Total = Rows[0]?.total ?? 0;
		return Ok({ storyUsers: await Promise.all(Rows.map(async Row => ({ user: UserShape(Row, Config.Origin), ...await Stats(Pool, Row.id) }))), totalCount: String(Total), hasMore: Start + Rows.length < Total });
	}
	if (Path === '/api/story/item_list/') {
		RequireMethod(Request, ['GET']);
		const Found = await Page(Pool, Config, Viewer, Id(Params.get('authorId')), { Cursor: Math.max(0, Math.floor(Number(Params.get('cursor')) || 0)), Backward: Params.get('loadBackward') === 'true' });
		return Ok(Found ?? { itemList: [], TotalCount: '0', CurrentPosition: '0', MinCursor: '0', MaxCursor: '0', HasMoreBefore: false, HasMoreAfter: false, AllViewed: true });
	}
	if (Path === '/api/story/batch/item_list/') {
		RequireMethod(Request, ['GET']);
		const Insert = /^\d{1,19}$/.test(Params.get('insertStoryId') ?? '') ? Params.get('insertStoryId') : null;
		const Lists = await Promise.all(Authors(Params.get('authorIds')).map(Author => Page(Pool, Config, Viewer, Author, { Insert })));
		return Ok({ batchStoryItemLists: Lists.filter(Boolean) });
	}
	if (Path === '/api/story/user/story_list/') {
		RequireMethod(Request, ['GET']);
		return Ok({ storyIdListStructs: await Promise.all(Authors(Params.get('authorIds')).map(async Author => ({ AuthorId: Author, storyIds: (await StoryIds(Pool, Viewer, Author)).map(Row => Row.id) }))) });
	}
	if (Path === '/api/story/viewer_list/') {
		RequireMethod(Request, ['GET']);
		const StoryId = Id(Params.get('storyId'));
		if (!User || !(await Pool.query('SELECT 1 FROM videos WHERE id = $1 AND author_id = $2 AND story_expires_at IS NOT NULL', [StoryId, User.id])).rowCount) throw new HttpError(404, 'StoryNotFound');
		const Start = Math.max(0, Math.floor(Number(Params.get('cursor')) || 0)), Count = Math.min(Math.max(Number(Params.get('count')) || 10, 1), 50);
		const Rows = (await Pool.query(`SELECT ${UserColumns}, count(*) OVER ()::int AS total FROM story_views sv JOIN users u ON u.id = sv.viewer_id
			WHERE sv.story_id = $1 AND sv.viewer_id <> $2 AND u.suspended_at IS NULL ORDER BY sv.viewed_at DESC LIMIT $3 OFFSET $4`, [StoryId, User.id, Count, Start])).rows;
		const Total = Rows[0]?.total ?? 0;
		return Ok({ storyViewerList: await Promise.all(Rows.map(async Row => ({ user: { user: UserShape(Row, Config.Origin), ...await Stats(Pool, Row.id) } }))), cursor: String(Start + Rows.length), totalViewers: String(Total), hasMore: Start + Rows.length < Total });
	}
	if (Path === '/tiktok/story/view/report/v1') {
		RequireMethod(Request, ['POST']); RequireCsrf(Request, User);
		const StoryId = Id(Params.get('story_id'));
		await AssertVideoVisible(Pool, StoryId, User.id);
		await Pool.query('INSERT INTO story_views(story_id, viewer_id) SELECT id, $2 FROM videos WHERE id = $1 AND story_expires_at IS NOT NULL ON CONFLICT DO NOTHING', [StoryId, User.id]);
		return Ok({});
	}
	return false;
}
