import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Escape, HttpError, Id, Json, ReadBody, ReadRaw, RequireMethod } from '../http.mjs';
import { Hash, RequireCsrf, Token } from '../auth.mjs';
import { RemoveMedia, SaveBrandImage } from '../media.mjs';
import { AvatarUrl, UserStats } from '../store.mjs';
import { Asset, ClientDir, LocalAsset, Root } from '../client/archive.mjs';
import { BrandSlots, Features, SaveSetting, Settings } from '../settings.mjs';
import { Page } from './account.mjs';

const Categories = ['spam', 'harassment', 'hate', 'nudity', 'violence', 'self_harm', 'misinformation', 'impersonation', 'copyright', 'other'];
const Before = Value => Value ? Id(Value) : null;
const ReportSql = `SELECT r.*, rep.username AS reporter, own.username AS owner, own.display_name AS owner_name, own.avatar_name, own.suspended_at AS owner_suspended, res.username AS resolver,
	v.description AS video_description, v.cover_name, c.body AS comment_body, c.video_id AS comment_video_id,
	(SELECT count(*)::int FROM reports o WHERE o.target_type = r.target_type AND o.target_id = r.target_id AND o.status = 'open') AS open_on_target
	FROM reports r LEFT JOIN users rep ON rep.id = r.reporter_id LEFT JOIN users own ON own.id = r.owner_id LEFT JOIN users res ON res.id = r.resolved_by
	LEFT JOIN videos v ON r.target_type = 'video' AND v.id = r.target_id LEFT JOIN comments c ON r.target_type = 'comment' AND c.id = r.target_id`;

let Styles;
function TikTokStyles() {
	Styles ??= (async () => {
		const Build = JSON.parse(await readFile(join(ClientDir, 'build.json'), 'utf8'));
		const Names = new Set();
		for (const File of await readdir(join(ClientDir, 'assets'))) {
			for (const Match of (await readFile(join(ClientDir, 'assets', File), 'latin1')).matchAll(/static\/assets\/((?:index|styles)\.[0-9a-f]{8}\.css)/g)) Names.add(Match[1]);
		}
		const Found = [];
		for (const Name of Names) {
			const Url = `https:${Build.publicPath}/static/assets/${Name}`;
			const Css = (await Asset(Url).catch(() => Buffer.alloc(0))).toString('utf8');
			if (Css.includes('--tux-colorTextPrimary')) Found.unshift(LocalAsset(Url));
			else if (Css.includes('.TUXButton')) Found.push(LocalAsset(Url));
		}
		return Found;
	})().catch(Error => { Styles = undefined; throw Error; });
	return Styles;
}

async function Audit(Pool, User, Action, Target, Detail = '') {
	await Pool.query('INSERT INTO admin_actions(admin_id, action, target, detail) VALUES ($1, $2, $3, $4)', [User.id, Action, Target, Detail.slice(0, 500)]);
}

async function DeleteVideos(Pool, Config, Where, Values) {
	const Removed = await Pool.query(`DELETE FROM videos WHERE ${Where} RETURNING file_name, cover_name`, Values);
	for (const Row of Removed.rows) await Promise.all([RemoveMedia(Config, Row.file_name), RemoveMedia(Config, Row.cover_name)]);
	return Removed.rowCount;
}

export async function Admin(Context) {
	const { Request, Response, Url, Pool, Config, User, Unknown } = Context;
	const ReportShape = Row => ({ ...Row, owner_avatar: AvatarUrl(Row, Config.Origin), cover: Row.cover_name ? `${Config.Origin}/media/${Row.cover_name}` : null, exists: Row.target_type === 'user' ? Boolean(Row.owner) : Row.target_type === 'video' ? Boolean(Row.cover_name) : Row.comment_body !== null });
	const Path = Url.pathname;

	const BrandMatch = Path.match(/^\/brand\/([a-zA-Z]+)$/);
	if (BrandMatch && BrandSlots[BrandMatch[1]]) {
		RequireMethod(Request, ['GET', 'HEAD']);
		const Custom = Config.Brand?.[BrandMatch[1]];
		const Default = join(Root, BrandSlots[BrandMatch[1]]);
		const Body = Custom ? await readFile(join(Config.MediaDir, Custom)).catch(() => null) : null;
		Response.writeHead(200, { 'content-type': Body ? 'image/png' : 'image/svg+xml', 'cache-control': 'no-cache' });
		Response.end(Request.method === 'HEAD' ? undefined : Body ?? await readFile(Default)); return true;
	}
	if (Path === '/rules') {
		RequireMethod(Request, ['GET']);
		const Body = Config.Rules ? Config.Rules.split(/\n\s*\n/).map(Paragraph => `<p>${Escape(Paragraph).replaceAll('\n', '<br>')}</p>`).join('') : '<p>This instance has not published rules yet.</p>';
		Response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
		Response.end(Page(Config, 'Rules', `<h1>Rules</h1>${Body}<p><a href="/">Back to ${Escape(Config.Name)}</a></p>`)); return true;
	}

	if (Path === '/admin' || Path.startsWith('/admin/')) {
		RequireMethod(Request, ['GET']);
		if (!User) { Response.writeHead(303, { location: '/login' }); Response.end(); return true; }
		if (User.role !== 'admin') throw new HttpError(404, 'NotFound');
		const Links = (await TikTokStyles().catch(() => [])).map(Href => `<link rel="stylesheet" href="${Escape(Href)}">`).join('');
		const Boot = { name: Config.Name, csrf: User.csrf_token, me: { id: User.id, username: User.username, avatar: AvatarUrl(User, Config.Origin) }, features: Features, categories: Categories };
		Response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
		Response.end(`<!doctype html><html lang="en" data-theme="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Admin · ${Escape(Config.Name)}</title><link rel="icon" href="/brand/favicon">
<script>try{const T=localStorage.getItem('kittok-admin-theme');document.documentElement.dataset.theme=T||(matchMedia('(prefers-color-scheme: light)').matches?'light':'dark')}catch{}</script>
${Links}<link rel="stylesheet" href="/public/admin.css"><script id="kittok-admin-boot" type="application/json">${JSON.stringify(Boot).replaceAll('<', '\\u003c')}</script><script src="/public/admin.js" defer></script></head><body><div id="kittok-admin"></div></body></html>`);
		return true;
	}

	if (!Path.startsWith('/_kittok/admin/')) return false;
	if (User?.role !== 'admin') throw new HttpError(404, 'NotFound');
	const Route = Path.slice('/_kittok/admin/'.length);
	const Params = Url.searchParams;

	if (Request.method === 'GET') {
		if (Route === 'overview') {
			const Stats = (await Pool.query(`SELECT (SELECT count(*)::int FROM users) AS users, (SELECT count(*)::int FROM users WHERE created_at > now() - interval '7 days') AS new_users,
				(SELECT count(*)::int FROM users WHERE suspended_at IS NOT NULL) AS suspended, (SELECT count(*)::int FROM videos) AS videos, (SELECT coalesce(sum(view_count), 0)::int FROM videos) AS views,
				(SELECT count(*)::int FROM comments) AS comments, (SELECT count(*)::int FROM likes) AS likes, (SELECT count(*)::int FROM sessions WHERE expires_at > now()) AS sessions,
				(SELECT count(*)::int FROM violations WHERE revoked_at IS NULL AND created_at > now() - interval '30 days') AS violations,
				(SELECT count(*)::int FROM invites WHERE expires_at > now() AND uses < max_uses) AS invites, (SELECT count(*)::int FROM reports WHERE status = 'open') AS reports`)).rows[0];
			const Signups = (await Pool.query('SELECT u.id, u.username, u.display_name, u.avatar_name, u.created_at, e.country FROM users u LEFT JOIN LATERAL (SELECT country FROM user_events WHERE user_id = u.id AND kind = \'signup\' ORDER BY id LIMIT 1) e ON true ORDER BY u.id DESC LIMIT 6')).rows;
			const Missing = [...(Unknown ?? new Map())].sort((A, B) => B[1] - A[1]).slice(0, 8).map(([Call, Count]) => ({ call: Call, count: Count }));
			Json(Response, { stats: Stats, registration: Config.Registration, signups: Signups.map(Row => ({ ...Row, avatar: AvatarUrl(Row, Config.Origin) })), missing: Missing }); return true;
		}
		if (Route === 'users') {
			const Query = (Params.get('q') ?? '').trim().slice(0, 64);
			const Like = Query.replace(/^@/, '').replace(/[\\%_]/g, '\\$&');
			const IsIp = /^[0-9a-fA-F:.]{3,45}$/.test(Query) && /[.:]/.test(Query);
			const Rows = (await Pool.query(`SELECT u.id, u.username, u.display_name, u.role, u.created_at, u.suspended_at, u.avatar_name,
				(SELECT count(*)::int FROM videos v WHERE v.author_id = u.id) AS videos, (SELECT count(*)::int FROM follows f WHERE f.following_id = u.id) AS followers,
				(SELECT count(*)::int FROM violations x WHERE x.user_id = u.id AND x.revoked_at IS NULL) AS violations
				FROM users u WHERE ($1 = '' OR u.username ILIKE '%' || $1 || '%' ESCAPE '\\' OR u.display_name ILIKE '%' || $1 || '%' ESCAPE '\\' OR u.id::text = $1
					OR ($3 AND EXISTS (SELECT 1 FROM user_events e WHERE e.user_id = u.id AND host(e.ip) = $4)))
				AND ($2::bigint IS NULL OR u.id < $2) ORDER BY u.id DESC LIMIT 50`, [Like, Before(Params.get('before')), IsIp, Query])).rows;
			Json(Response, { users: Rows.map(Row => ({ ...Row, avatar: AvatarUrl(Row, Config.Origin), self: Row.id === User.id })), hasMore: Rows.length === 50 }); return true;
		}
		const UserMatch = Route.match(/^users\/(\d+)$/);
		if (UserMatch) {
			const Target = Id(UserMatch[1]);
			const Profile = (await Pool.query('SELECT id, username, display_name, bio, role, avatar_name, created_at, suspended_at, notices_read_at FROM users WHERE id = $1', [Target])).rows[0];
			if (!Profile) throw new HttpError(404, 'UserNotFound');
			const [Events, Sessions, Videos, Comments, Violations, Related, Seen, Against, Filed] = await Promise.all([
				Pool.query('SELECT id, kind, host(ip) AS ip, country, language, user_agent, detail, created_at FROM user_events WHERE user_id = $1 ORDER BY id DESC LIMIT 100', [Target]),
				Pool.query('SELECT token_hash, host(ip) AS ip, country, user_agent, created_at, last_seen_at, expires_at FROM sessions WHERE user_id = $1 AND expires_at > now() ORDER BY last_seen_at DESC', [Target]),
				Pool.query(`SELECT v.id, v.description, v.cover_name, v.created_at, v.view_count::int AS views, (SELECT count(*)::int FROM likes l WHERE l.video_id = v.id) AS likes, (SELECT count(*)::int FROM comments c WHERE c.video_id = v.id) AS comments FROM videos v WHERE v.author_id = $1 ORDER BY v.id DESC LIMIT 60`, [Target]),
				Pool.query(`SELECT c.id, c.body, c.created_at, c.video_id, c.parent_id, a.username AS video_author FROM comments c JOIN videos v ON v.id = c.video_id JOIN users a ON a.id = v.author_id WHERE c.author_id = $1 ORDER BY c.id DESC LIMIT 50`, [Target]),
				Pool.query('SELECT x.*, u.username AS admin FROM violations x LEFT JOIN users u ON u.id = x.admin_id WHERE x.user_id = $1 ORDER BY x.id DESC', [Target]),
				Pool.query(`SELECT u.id, u.username, u.display_name, u.avatar_name, u.suspended_at, array_agg(DISTINCT host(o.ip)) AS ips FROM user_events mine JOIN user_events o ON o.ip = mine.ip AND o.user_id <> mine.user_id JOIN users u ON u.id = o.user_id
					WHERE mine.user_id = $1 AND mine.ip IS NOT NULL GROUP BY u.id ORDER BY u.id DESC LIMIT 20`, [Target]),
				Pool.query(`SELECT array_remove(array_agg(DISTINCT country), NULL) AS countries, array_remove(array_agg(DISTINCT language), NULL) AS languages, count(DISTINCT ip)::int AS ips FROM user_events WHERE user_id = $1`, [Target]),
				Pool.query(`${ReportSql} WHERE r.owner_id = $1 ORDER BY r.id DESC LIMIT 50`, [Target]),
				Pool.query(`${ReportSql} WHERE r.reporter_id = $1 ORDER BY r.id DESC LIMIT 50`, [Target]),
			]);
			const Signup = [...Events.rows].reverse().find(Row => Row.kind === 'signup') ?? null;
			Json(Response, {
				user: { ...Profile, avatar: AvatarUrl(Profile, Config.Origin), self: Profile.id === User.id, stats: await UserStats(Pool, Target) },
				signup: Signup, seen: Seen.rows[0], events: Events.rows,
				sessions: Sessions.rows.map(Row => ({ ...Row, id: Row.token_hash.slice(0, 16), token_hash: undefined })),
				videos: Videos.rows.map(Row => ({ ...Row, cover: `${Config.Origin}/media/${Row.cover_name}` })),
				comments: Comments.rows, violations: Violations.rows,
				related: Related.rows.map(Row => ({ ...Row, avatar: AvatarUrl(Row, Config.Origin) })),
				reportsAgainst: Against.rows.map(ReportShape), reportsFiled: Filed.rows.map(ReportShape),
			}); return true;
		}
		if (Route === 'reports') {
			const Status = ['open', 'resolved', 'dismissed'].includes(Params.get('status')) ? Params.get('status') : 'open';
			const Rows = (await Pool.query(`${ReportSql} WHERE r.status = $1 AND ($2::bigint IS NULL OR r.id < $2) ORDER BY r.id DESC LIMIT 50`, [Status, Before(Params.get('before'))])).rows;
			Json(Response, { reports: Rows.map(ReportShape), hasMore: Rows.length === 50 }); return true;
		}
		if (Route === 'videos') {
			const Rows = (await Pool.query(`SELECT v.id, v.description, v.cover_name, v.created_at, v.view_count::int AS views, u.id AS author_id, u.username,
				(SELECT count(*)::int FROM likes l WHERE l.video_id = v.id) AS likes, (SELECT count(*)::int FROM comments c WHERE c.video_id = v.id) AS comments
				FROM videos v JOIN users u ON u.id = v.author_id WHERE $1::bigint IS NULL OR v.id < $1 ORDER BY v.id DESC LIMIT 30`, [Before(Params.get('before'))])).rows;
			Json(Response, { videos: Rows.map(Row => ({ ...Row, cover: `${Config.Origin}/media/${Row.cover_name}` })), hasMore: Rows.length === 30 }); return true;
		}
		const CommentSql = `SELECT c.id, c.body, c.created_at, c.video_id, c.parent_id, u.id AS author_id, u.username, u.display_name, u.avatar_name, a.username AS video_author, v.description AS video_description, v.cover_name,
			(SELECT count(*)::int FROM comment_likes l WHERE l.comment_id = c.id) AS likes, (SELECT count(*)::int FROM comments r WHERE r.parent_id = c.id) AS replies
			FROM comments c JOIN users u ON u.id = c.author_id JOIN videos v ON v.id = c.video_id JOIN users a ON a.id = v.author_id`;
		const CommentShape = Row => ({ ...Row, avatar: AvatarUrl(Row, Config.Origin), cover: `${Config.Origin}/media/${Row.cover_name}` });
		if (Route === 'comments') {
			const Rows = (await Pool.query(`${CommentSql} WHERE $1::bigint IS NULL OR c.id < $1 ORDER BY c.id DESC LIMIT 50`, [Before(Params.get('before'))])).rows;
			Json(Response, { comments: Rows.map(CommentShape), hasMore: Rows.length === 50 }); return true;
		}
		const CommentMatch = Route.match(/^comments\/(\d+)$/);
		if (CommentMatch) {
			const Comment = (await Pool.query(`${CommentSql} WHERE c.id = $1`, [Id(CommentMatch[1])])).rows[0];
			if (!Comment) throw new HttpError(404, 'CommentNotFound');
			const [Parent, Replies, Violations] = await Promise.all([
				Comment.parent_id ? Pool.query(`${CommentSql} WHERE c.id = $1`, [Comment.parent_id]) : { rows: [] },
				Pool.query(`${CommentSql} WHERE c.parent_id = $1 ORDER BY c.id LIMIT 50`, [Comment.id]),
				Pool.query('SELECT x.*, u.username AS admin FROM violations x LEFT JOIN users u ON u.id = x.admin_id WHERE x.comment_id = $1 ORDER BY x.id DESC', [Comment.id]),
			]);
			Json(Response, { comment: CommentShape(Comment), parent: Parent.rows[0] ? CommentShape(Parent.rows[0]) : null, replies: Replies.rows.map(CommentShape), violations: Violations.rows }); return true;
		}
		if (Route === 'invites') {
			const Rows = (await Pool.query(`SELECT i.token_hash AS id, i.max_uses, i.uses, i.expires_at, i.created_at, u.username FROM invites i JOIN users u ON u.id = i.created_by
				WHERE i.expires_at > now() AND i.uses < i.max_uses ORDER BY i.created_at DESC`)).rows;
			Json(Response, { registration: Config.Registration, invites: Rows }); return true;
		}
		if (Route === 'audit') {
			const Rows = (await Pool.query('SELECT a.id, a.action, a.target, a.detail, a.created_at, u.username FROM admin_actions a LEFT JOIN users u ON u.id = a.admin_id WHERE $1::bigint IS NULL OR a.id < $1 ORDER BY a.id DESC LIMIT 50', [Before(Params.get('before'))])).rows;
			Json(Response, { actions: Rows, hasMore: Rows.length === 50 }); return true;
		}
		if (Route === 'settings') { Json(Response, Settings(Config)); return true; }
		throw new HttpError(404, 'NotFound');
	}

	RequireMethod(Request, ['POST']);
	RequireCsrf(Request, User);
	const BrandUpload = Route.match(/^brand\/([a-zA-Z]+)(\/reset)?$/);
	if (BrandUpload && BrandSlots[BrandUpload[1]]) {
		const Slot = BrandUpload[1];
		let Name = null;
		if (!BrandUpload[2]) {
			const Form = await new globalThis.Response(await ReadRaw(Request, 2 * 1024 * 1024), { headers: { 'content-type': Request.headers['content-type'] ?? '' } }).formData().catch(() => null);
			const File = Form?.get('file');
			if (!(File instanceof Blob)) throw new HttpError(400, 'InvalidUpload');
			Name = await SaveBrandImage(Config, Slot, Buffer.from(await File.arrayBuffer()));
		}
		const Previous = Config.Brand?.[Slot];
		const Brand = { ...Config.Brand }; if (Name) Brand[Slot] = Name; else delete Brand[Slot];
		await SaveSetting(Pool, Config, 'brand', Brand);
		if (Previous && Previous !== Name) await RemoveMedia(Config, Previous);
		await Audit(Pool, User, Name ? 'brand.upload' : 'brand.reset', Slot);
		Json(Response, Settings(Config).brand); return true;
	}
	const Body = await ReadBody(Request, 32768);
	const SettingMatch = Route.match(/^settings\/([a-z]+)$/);
	if (SettingMatch && SettingMatch[1] !== 'brand') {
		const Saved = await SaveSetting(Pool, Config, SettingMatch[1], Body.value);
		await Audit(Pool, User, `settings.${SettingMatch[1]}`, SettingMatch[1], typeof Saved === 'string' ? Saved.slice(0, 120) : JSON.stringify(Saved).slice(0, 200));
		Json(Response, Settings(Config)); return true;
	}
	const UserAction = Route.match(/^users\/(\d+)\/(suspend|unsuspend|role|delete|violations|sessions\/revoke)$/);
	if (UserAction) {
		const Target = Id(UserAction[1]);
		const Action = UserAction[2];
		if (Target === User.id && Action !== 'violations') throw new HttpError(400, 'CannotChangeYourself');
		const Found = (await Pool.query('SELECT id, username, avatar_name FROM users WHERE id = $1', [Target])).rows[0];
		if (!Found) throw new HttpError(404, 'UserNotFound');
		let Detail = '';
		if (Action === 'suspend') {
			await Pool.query('UPDATE users SET suspended_at = now() WHERE id = $1', [Target]);
			await Pool.query('DELETE FROM sessions WHERE user_id = $1', [Target]);
		} else if (Action === 'unsuspend') {
			await Pool.query('UPDATE users SET suspended_at = NULL WHERE id = $1', [Target]);
		} else if (Action === 'role') {
			if (!['admin', 'member'].includes(Body.role)) throw new HttpError(400, 'InvalidRole');
			await Pool.query('UPDATE users SET role = $2 WHERE id = $1', [Target, Body.role]); Detail = Body.role;
		} else if (Action === 'sessions/revoke') {
			const Prefix = String(Body.session ?? '');
			const Removed = Prefix === 'all' ? await Pool.query('DELETE FROM sessions WHERE user_id = $1', [Target])
				: /^[a-f0-9]{16}$/.test(Prefix) ? await Pool.query('DELETE FROM sessions WHERE user_id = $1 AND left(token_hash, 16) = $2', [Target, Prefix]) : null;
			if (!Removed?.rowCount) throw new HttpError(404, 'SessionNotFound');
			Detail = Prefix === 'all' ? `all ${Removed.rowCount}` : Prefix;
		} else if (Action === 'violations') {
			const Category = String(Body.category ?? ''), Reason = String(Body.reason ?? '').trim();
			if (!Categories.includes(Category)) throw new HttpError(400, 'InvalidCategory');
			if (!Reason || Reason.length > 1000) throw new HttpError(400, 'InvalidReason');
			const VideoId = Body.video_id ? Id(Body.video_id) : null, CommentId = Body.comment_id ? Id(Body.comment_id) : null;
			if (VideoId && !(await Pool.query('SELECT 1 FROM videos WHERE id = $1 AND author_id = $2', [VideoId, Target])).rowCount) throw new HttpError(400, 'VideoNotTheirs');
			if (CommentId && !(await Pool.query('SELECT 1 FROM comments WHERE id = $1 AND author_id = $2', [CommentId, Target])).rowCount) throw new HttpError(400, 'CommentNotTheirs');
			await Pool.query('INSERT INTO violations(user_id, admin_id, category, reason, video_id, comment_id) VALUES ($1, $2, $3, $4, $5, $6)', [Target, User.id, Category, Reason, VideoId, CommentId]);
			Detail = `${Category}: ${Reason}`;
		} else {
			if (Body.confirm !== Found.username) throw new HttpError(400, 'TypeTheUsernameToConfirm');
			await DeleteVideos(Pool, Config, 'author_id = $1', [Target]);
			await Pool.query('DELETE FROM users WHERE id = $1', [Target]);
			if (Found.avatar_name) await RemoveMedia(Config, Found.avatar_name);
		}
		await Audit(Pool, User, `user.${Action.replace('/', '.')}`, `@${Found.username}`, Detail);
		Json(Response, { ok: true }); return true;
	}
	const ReportMatch = Route.match(/^reports\/(\d+)\/(resolve|dismiss)$/);
	if (ReportMatch) {
		const Report = (await Pool.query('SELECT target_type, target_id FROM reports WHERE id = $1', [Id(ReportMatch[1])])).rows[0];
		if (!Report) throw new HttpError(404, 'ReportNotFound');
		const Status = ReportMatch[2] === 'resolve' ? 'resolved' : 'dismissed';
		const Closed = await Pool.query(`UPDATE reports SET status = $3, resolved_by = $4, resolved_at = now(), resolution = $5 WHERE target_type = $1 AND target_id = $2 AND status = 'open'`, [Report.target_type, Report.target_id, Status, User.id, String(Body.resolution ?? '').trim().slice(0, 500)]);
		await Audit(Pool, User, `report.${ReportMatch[2]}`, `${Report.target_type} ${Report.target_id}`, `${Closed.rowCount} report${Closed.rowCount === 1 ? '' : 's'}${Body.resolution ? ': ' + Body.resolution : ''}`);
		Json(Response, { closed: Closed.rowCount }); return true;
	}
	const ViolationMatch = Route.match(/^violations\/(\d+)\/revoke$/);
	if (ViolationMatch) {
		const Revoked = (await Pool.query('UPDATE violations x SET revoked_at = now() FROM users u WHERE x.id = $1 AND x.revoked_at IS NULL AND u.id = x.user_id RETURNING x.category, u.username', [Id(ViolationMatch[1])])).rows[0];
		if (!Revoked) throw new HttpError(404, 'ViolationNotFound');
		await Audit(Pool, User, 'violation.revoke', `@${Revoked.username}`, Revoked.category);
		Json(Response, { ok: true }); return true;
	}
	const VideoMatch = Route.match(/^videos\/(\d+)\/delete$/);
	if (VideoMatch) {
		if (!await DeleteVideos(Pool, Config, 'id = $1', [Id(VideoMatch[1])])) throw new HttpError(404, 'VideoNotFound');
		await Audit(Pool, User, 'video.delete', VideoMatch[1]);
		Json(Response, { ok: true }); return true;
	}
	const CommentDelete = Route.match(/^comments\/(\d+)\/delete$/);
	if (CommentDelete) {
		const Removed = await Pool.query('DELETE FROM comments WHERE id = $1 RETURNING body', [Id(CommentDelete[1])]);
		if (!Removed.rowCount) throw new HttpError(404, 'CommentNotFound');
		await Audit(Pool, User, 'comment.delete', CommentDelete[1], Removed.rows[0].body.slice(0, 200));
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
