import { HttpError, Id, Json, ReadBody, RequireMethod } from '../http.mjs';
import { Hash, RequireCsrf, Token } from '../auth.mjs';
import { RemoveMedia } from '../media.mjs';
import { AvatarUrl } from '../store.mjs';

async function Audit(Pool, User, Action, Target, Detail = '') {
	await Pool.query('INSERT INTO admin_actions(admin_id, action, target, detail) VALUES ($1, $2, $3, $4)', [User.id, Action, Target, Detail]);
}

async function DeleteVideos(Pool, Config, Where, Values) {
	const Removed = await Pool.query(`DELETE FROM videos WHERE ${Where} RETURNING file_name, cover_name`, Values);
	for (const Row of Removed.rows) await Promise.all([RemoveMedia(Config, Row.file_name), RemoveMedia(Config, Row.cover_name)]);
	return Removed.rowCount;
}

const Before = Value => Value ? Id(Value) : null;

export async function Admin(Context) {
	const { Request, Response, Url, Pool, Config, User, Unknown, ClientShell } = Context;
	const Path = Url.pathname;
	if (Path === '/admin' || Path === '/admin/') {
		RequireMethod(Request, ['GET']);
		if (!User) { Response.writeHead(303, { location: '/login' }); Response.end(); return true; }
		if (User.role !== 'admin') throw new HttpError(404, 'NotFound');
		Response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
		Response.end(ClientShell().replace('<head>', `<head><script>history.replaceState(null,'','/@.kittok-admin'+location.hash);for(const T of['popstate','hashchange'])addEventListener(T,E=>{if(location.pathname!=='/admin')return;E.stopImmediatePropagation();if(document.getElementById('kittok-admin'))dispatchEvent(new Event('kittok-admin-navigate'));else location.reload()},true)</script>`).replace('</head>', '<link rel="stylesheet" href="/public/admin.css"><script src="/public/admin.js" defer></script></head>'));
		return true;
	}
	if (!Path.startsWith('/_kittok/admin/')) return false;
	if (User?.role !== 'admin') throw new HttpError(404, 'NotFound');
	const Route = Path.slice('/_kittok/admin/'.length);

	if (Request.method === 'GET') {
		if (Route === 'overview') {
			const Stats = (await Pool.query(`SELECT (SELECT count(*)::int FROM users) AS users, (SELECT count(*)::int FROM users WHERE suspended_at IS NOT NULL) AS suspended,
				(SELECT count(*)::int FROM users WHERE role = 'admin') AS admins, (SELECT count(*)::int FROM videos) AS videos, (SELECT coalesce(sum(view_count), 0)::int FROM videos) AS views,
				(SELECT count(*)::int FROM comments) AS comments, (SELECT count(*)::int FROM likes) AS likes, (SELECT count(*)::int FROM sessions WHERE expires_at > now()) AS sessions,
				(SELECT count(*)::int FROM invites WHERE expires_at > now() AND uses < max_uses) AS invites`)).rows[0];
			const Actions = (await Pool.query('SELECT a.action, a.target, a.detail, a.created_at, u.username FROM admin_actions a LEFT JOIN users u ON u.id = a.admin_id ORDER BY a.id DESC LIMIT 20')).rows;
			const Missing = [...(Unknown ?? new Map())].sort((A, B) => B[1] - A[1]).slice(0, 10).map(([Call, Count]) => ({ call: Call, count: Count }));
			Json(Response, { registration: Config.Registration, stats: Stats, actions: Actions, missing: Missing }); return true;
		}
		if (Route === 'users') {
			const Query = (Url.searchParams.get('q') ?? '').slice(0, 50).replace(/[\\%_]/g, '\\$&');
			const Rows = (await Pool.query(`SELECT u.id, u.username, u.display_name, u.role, u.created_at, u.suspended_at, u.avatar_name,
				(SELECT count(*)::int FROM videos v WHERE v.author_id = u.id) AS videos, (SELECT count(*)::int FROM follows f WHERE f.following_id = u.id) AS followers
				FROM users u WHERE ($1 = '' OR u.username ILIKE '%' || $1 || '%' ESCAPE '\\' OR u.display_name ILIKE '%' || $1 || '%' ESCAPE '\\') AND ($2::bigint IS NULL OR u.id < $2)
				ORDER BY u.id DESC LIMIT 50`, [Query, Before(Url.searchParams.get('before'))])).rows;
			Json(Response, { users: Rows.map(Row => ({ ...Row, avatar: AvatarUrl(Row, Config.Origin), self: Row.id === User.id })), hasMore: Rows.length === 50 }); return true;
		}
		if (Route === 'videos') {
			const Rows = (await Pool.query(`SELECT v.id, v.description, v.cover_name, v.created_at, v.view_count::int AS views, u.username,
				(SELECT count(*)::int FROM likes l WHERE l.video_id = v.id) AS likes, (SELECT count(*)::int FROM comments c WHERE c.video_id = v.id) AS comments
				FROM videos v JOIN users u ON u.id = v.author_id WHERE $1::bigint IS NULL OR v.id < $1 ORDER BY v.id DESC LIMIT 30`, [Before(Url.searchParams.get('before'))])).rows;
			Json(Response, { videos: Rows.map(Row => ({ ...Row, cover: `${Config.Origin}/media/${Row.cover_name}` })), hasMore: Rows.length === 30 }); return true;
		}
		if (Route === 'comments') {
			const Rows = (await Pool.query(`SELECT c.id, c.body, c.created_at, c.video_id, c.parent_id, u.username, u.display_name, u.avatar_name, a.username AS video_author
				FROM comments c JOIN users u ON u.id = c.author_id JOIN videos v ON v.id = c.video_id JOIN users a ON a.id = v.author_id
				WHERE $1::bigint IS NULL OR c.id < $1 ORDER BY c.id DESC LIMIT 50`, [Before(Url.searchParams.get('before'))])).rows;
			Json(Response, { comments: Rows.map(Row => ({ ...Row, avatar: AvatarUrl(Row, Config.Origin) })), hasMore: Rows.length === 50 }); return true;
		}
		if (Route === 'invites') {
			const Rows = (await Pool.query(`SELECT i.token_hash AS id, i.max_uses, i.uses, i.expires_at, i.created_at, u.username FROM invites i JOIN users u ON u.id = i.created_by
				WHERE i.expires_at > now() AND i.uses < i.max_uses ORDER BY i.created_at DESC`)).rows;
			Json(Response, { registration: Config.Registration, invites: Rows }); return true;
		}
		throw new HttpError(404, 'NotFound');
	}

	RequireMethod(Request, ['POST']);
	RequireCsrf(Request, User);
	const Body = await ReadBody(Request);
	const UserMatch = Route.match(/^users\/(\d+)\/(suspend|unsuspend|role|delete)$/);
	if (UserMatch) {
		const Target = Id(UserMatch[1]);
		if (Target === User.id) throw new HttpError(400, 'CannotChangeYourself');
		const Found = (await Pool.query('SELECT id, username, avatar_name FROM users WHERE id = $1', [Target])).rows[0];
		if (!Found) throw new HttpError(404, 'UserNotFound');
		if (UserMatch[2] === 'suspend') {
			await Pool.query('UPDATE users SET suspended_at = now() WHERE id = $1', [Target]);
			await Pool.query('DELETE FROM sessions WHERE user_id = $1', [Target]);
		} else if (UserMatch[2] === 'unsuspend') {
			await Pool.query('UPDATE users SET suspended_at = NULL WHERE id = $1', [Target]);
		} else if (UserMatch[2] === 'role') {
			if (!['admin', 'member'].includes(Body.role)) throw new HttpError(400, 'InvalidRole');
			await Pool.query('UPDATE users SET role = $2 WHERE id = $1', [Target, Body.role]);
		} else {
			if (Body.confirm !== Found.username) throw new HttpError(400, 'TypeTheUsernameToConfirm');
			await DeleteVideos(Pool, Config, 'author_id = $1', [Target]);
			await Pool.query('DELETE FROM users WHERE id = $1', [Target]);
			if (Found.avatar_name) await RemoveMedia(Config, Found.avatar_name);
		}
		await Audit(Pool, User, `user.${UserMatch[2]}`, `@${Found.username}`, UserMatch[2] === 'role' ? Body.role : '');
		Json(Response, { ok: true }); return true;
	}
	const VideoMatch = Route.match(/^videos\/(\d+)\/delete$/);
	if (VideoMatch) {
		if (!await DeleteVideos(Pool, Config, 'id = $1', [Id(VideoMatch[1])])) throw new HttpError(404, 'VideoNotFound');
		await Audit(Pool, User, 'video.delete', VideoMatch[1]);
		Json(Response, { ok: true }); return true;
	}
	const CommentMatch = Route.match(/^comments\/(\d+)\/delete$/);
	if (CommentMatch) {
		const Removed = await Pool.query('DELETE FROM comments WHERE id = $1 RETURNING body', [Id(CommentMatch[1])]);
		if (!Removed.rowCount) throw new HttpError(404, 'CommentNotFound');
		await Audit(Pool, User, 'comment.delete', CommentMatch[1], Removed.rows[0].body.slice(0, 200));
		Json(Response, { ok: true }); return true;
	}
	if (Route === 'invites') {
		const Uses = Math.floor(Number(Body.uses)), Days = Math.floor(Number(Body.days));
		if (!(Uses >= 1 && Uses <= 100 && Days >= 1 && Days <= 90)) throw new HttpError(400, 'InvalidInvite');
		const Code = Token();
		await Pool.query('INSERT INTO invites(token_hash, created_by, max_uses, expires_at) VALUES ($1, $2, $3, now() + make_interval(days => $4))', [Hash(Code), User.id, Uses, Days]);
		await Audit(Pool, User, 'invite.create', Hash(Code).slice(0, 12), `${Uses} uses, ${Days} days`);
		Json(Response, { code: Code, uses: Uses, days: Days }); return true;
	}
	const InviteMatch = Route.match(/^invites\/([a-f0-9]{64})\/delete$/);
	if (InviteMatch) {
		if (!(await Pool.query('DELETE FROM invites WHERE token_hash = $1', [InviteMatch[1]])).rowCount) throw new HttpError(404, 'InviteNotFound');
		await Audit(Pool, User, 'invite.revoke', InviteMatch[1].slice(0, 12));
		Json(Response, { ok: true }); return true;
	}
	throw new HttpError(404, 'NotFound');
}
