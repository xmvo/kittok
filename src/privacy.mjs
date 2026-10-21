import { HttpError } from './http.mjs';
import { Transaction } from './db.mjs';
import { RemovedSql } from './moderation.mjs';

export const FollowsSql = (Viewer, Author) => `EXISTS (SELECT 1 FROM follows WHERE follower_id = ${Viewer} AND following_id = ${Author})`;
export const FriendsSql = (Viewer, Author) => `(${FollowsSql(Viewer, Author)} AND ${FollowsSql(Author, Viewer)})`;
export const PairBlockedSql = (A, B) => `EXISTS (SELECT 1 FROM blocks WHERE (blocker_id = ${A} AND blocked_id = ${B}) OR (blocker_id = ${B} AND blocked_id = ${A}))`;
export const VideoVisibleSql = (Viewer, Video = 'v', Author = 'u') => `(${Author}.suspended_at IS NULL AND NOT ${RemovedSql('video', `${Video}.id`)} AND NOT ${PairBlockedSql(Viewer, `${Video}.author_id`)} AND (
	${Video}.author_id = ${Viewer} OR (${Video}.story_expires_at IS NULL OR ${Video}.story_expires_at > now()) AND (
		(NOT ${Author}.private_account OR ${FollowsSql(Viewer, `${Video}.author_id`)}) AND (
			${Video}.visibility = 'public' OR (${Video}.visibility = 'followers' AND ${FollowsSql(Viewer, `${Video}.author_id`)})
			OR (${Video}.visibility = 'friends' AND ${FriendsSql(Viewer, `${Video}.author_id`)})))))`;

export const CommentsAllowedSql = (Viewer, Video = 'v', Author = 'u') => `(${Video}.comment_permission <> 'none' AND ${Author}.comment_permission <> 'none' AND (${Video}.author_id = ${Viewer} OR (
	(${Author}.comment_permission = 'everyone' OR (${Author}.comment_permission = 'followers' AND ${FollowsSql(Viewer, `${Video}.author_id`)}) OR (${Author}.comment_permission = 'friends' AND ${FriendsSql(Viewer, `${Video}.author_id`)}))
	AND (${Video}.comment_permission IN ('default', 'everyone') OR (${Video}.comment_permission = 'followers' AND ${FollowsSql(Viewer, `${Video}.author_id`)}) OR (${Video}.comment_permission = 'friends' AND ${FriendsSql(Viewer, `${Video}.author_id`)})))))`;

export async function AssertVideoVisible(Pool, VideoId, Viewer) {
	if (!(await Pool.query(`SELECT v.id FROM videos v JOIN users u ON u.id = v.author_id WHERE v.id = $1 AND ${VideoVisibleSql('$2::bigint')}`, [VideoId, Viewer ?? null])).rowCount) throw new HttpError(404, 'VideoNotFound');
}

export function PostSettings(Visibility, Comments) {
	if (!['public', 'followers', 'friends', 'only_me'].includes(Visibility) || !['default', 'everyone', 'followers', 'friends', 'none'].includes(Comments)) throw new HttpError(400, 'InvalidPostPrivacy');
	return { visibility: Visibility, comment_permission: Comments };
}

async function LockPair(Client, A, B) {
	await Client.query('SELECT id FROM users WHERE id = ANY($1::bigint[]) ORDER BY id FOR NO KEY UPDATE', [[A, B]]);
}

export async function SetFollow(Pool, Viewer, Target, On) {
	if (Viewer === Target) throw new HttpError(400, 'CannotFollowYourself');
	return Transaction(Pool, async Client => {
		await LockPair(Client, Viewer, Target);
		const Account = (await Client.query(`SELECT private_account, suspended_at, ${PairBlockedSql('$1', '$2')} AS blocked FROM users WHERE id = $2`, [Viewer, Target])).rows[0];
		if (!Account || Account.suspended_at) throw new HttpError(404, 'UserNotFound');
		if (On && Account.blocked) throw new HttpError(403, 'BlockedRelationship');
		if (!On) {
			await Client.query('DELETE FROM follows WHERE follower_id = $1 AND following_id = $2', [Viewer, Target]);
			await Client.query('DELETE FROM follow_requests WHERE follower_id = $1 AND following_id = $2', [Viewer, Target]);
		} else if (Account.private_account) {
			await Client.query('INSERT INTO follow_requests(follower_id, following_id) SELECT $1, $2 WHERE NOT EXISTS (SELECT 1 FROM follows WHERE follower_id = $1 AND following_id = $2) ON CONFLICT DO NOTHING', [Viewer, Target]);
		} else {
			await Client.query('INSERT INTO follows(follower_id, following_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [Viewer, Target]);
		}
	});
}

export async function SetPrivateAccount(Pool, Viewer, Value) {
	if (![0, 1, '0', '1', true, false].includes(Value)) throw new HttpError(400, 'InvalidAccountPrivacy');
	const Private = Value === true || Number(Value) === 1;
	await Transaction(Pool, async Client => {
		await Client.query('SELECT id FROM users WHERE id = $1 FOR NO KEY UPDATE', [Viewer]);
		await Client.query('UPDATE users SET private_account = $2 WHERE id = $1', [Viewer, Private]);
		if (!Private) {
			await Client.query(`INSERT INTO follows(follower_id, following_id) SELECT r.follower_id, r.following_id FROM follow_requests r JOIN users u ON u.id = r.follower_id WHERE r.following_id = $1 AND u.suspended_at IS NULL AND NOT ${PairBlockedSql('r.follower_id', 'r.following_id')} ON CONFLICT DO NOTHING`, [Viewer]);
			await Client.query('DELETE FROM follow_requests WHERE following_id = $1', [Viewer]);
		}
	});
}

export async function DecideFollowRequest(Pool, Viewer, Follower, Accept) {
	return Transaction(Pool, async Client => {
		await LockPair(Client, Viewer, Follower);
		const Deleted = await Client.query('DELETE FROM follow_requests WHERE following_id = $1 AND follower_id = $2 RETURNING follower_id', [Viewer, Follower]);
		if (!Deleted.rowCount) throw new HttpError(404, 'FollowRequestNotFound');
		if (Accept) await Client.query(`INSERT INTO follows(follower_id, following_id, approved_at) SELECT $2, $1, now() WHERE NOT ${PairBlockedSql('$1', '$2')} AND EXISTS (SELECT 1 FROM users WHERE id = $2 AND suspended_at IS NULL) ON CONFLICT DO NOTHING`, [Viewer, Follower]);
	});
}

export async function FollowRequests(Pool, Viewer) {
	return (await Pool.query(`SELECT u.id, u.username, u.display_name, u.avatar_name, r.created_at FROM follow_requests r JOIN users u ON u.id = r.follower_id WHERE r.following_id = $1 AND u.suspended_at IS NULL AND NOT ${PairBlockedSql('$1', 'u.id')} ORDER BY r.created_at DESC LIMIT 100`, [Viewer])).rows;
}
