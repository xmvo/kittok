import { readFile } from 'node:fs/promises';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Escape, HttpError, Id, Json, ReadBody, ReadRaw, RequireMethod } from '../http.mjs';
import { Hash, RateLimiter, RequireCsrf, Token } from '../auth.mjs';
import { HashIp, InstanceKey, LocalSeal, Open, Unlock } from '../ips.mjs';
import { SendMail } from '../mail.mjs';
import { CollectibleCounts, SaveCollectibles } from '../decorations.mjs';
import { RemoveMedia, SaveBrandImage, WarmDownloads } from '../media.mjs';
import { AvatarUrl, UserStats } from '../store.mjs';
import { ClientDir, Root } from '../client/archive.mjs';
import { BrandSlots, Features, MiscFeatures, RestoreEnvMail, SaveSetting, Settings } from '../settings.mjs';
import { Page } from './account.mjs';
import { Enforce, DecideReport, ReverseDecision, LiftRestriction, MessageText, ReviewAppeal, Standing } from '../moderation.mjs';
import { Transaction } from '../db.mjs';
import { BadgeCatalog, PrideFlag, UserBadges, PublicBadges } from '../badges.mjs';
import { Public, Shell } from '../client/shell.mjs';
import { DeleteAccount } from '../accounts.mjs';

let ClientPage;

const Categories = ['spam', 'harassment', 'hate', 'nudity', 'violence', 'self_harm', 'misinformation', 'impersonation', 'copyright', 'other'];
const Before = Value => Value ? Id(Value) : null;
const MediaSql = Alias => `(SELECT json_build_object('uri', mm.uri, 'kind', mm.kind) FROM message_media mm WHERE mm.message_id = ${Alias}.id ORDER BY mm.id LIMIT 1)`;
const ReportSql = `SELECT r.*, rep.username AS reporter, own.username AS owner, own.display_name AS owner_name, own.avatar_name, own.suspended_at AS owner_suspended, res.username AS resolver,
	v.description AS video_description, v.cover_name, c.body AS comment_body, c.video_id AS comment_video_id, mc.content AS message_content, ${MediaSql('mc')} AS message_media,
	(SELECT count(*)::int FROM reports o WHERE o.target_type = r.target_type AND o.target_id = r.target_id AND o.status = 'open') AS open_on_target
	FROM reports r LEFT JOIN users rep ON rep.id = r.reporter_id LEFT JOIN users own ON own.id = r.owner_id LEFT JOIN users res ON res.id = r.resolved_by
	LEFT JOIN videos v ON r.target_type = 'video' AND v.id = r.target_id LEFT JOIN comments c ON r.target_type = 'comment' AND c.id = r.target_id
	LEFT JOIN messages mc ON r.target_type = 'message' AND mc.id = r.target_id`;

const IpState = "CASE WHEN ip_sealed IS NOT NULL THEN 'sealed' WHEN ip_hash IS NOT NULL THEN 'hidden' END";
const Reveals = RateLimiter();
const Fingerprint = () => ['src', 'src/routes', 'src/client', 'migrations', '.'].flatMap(Directory => readdirSync(join(Root, Directory)).filter(Name => /\.(mjs|js|sql)$|^package\.json$/.test(Name))
	.map(Name => { const Info = statSync(join(Root, Directory, Name)); return `${Directory}/${Name}:${Info.size}:${Info.mtimeMs}`; })).sort().join('|');
const Booted = Fingerprint();
let CheckedAt = 0, Stale = false;
export function Outdated() {
	if (Date.now() - CheckedAt > 5000) { CheckedAt = Date.now(); try { Stale = Fingerprint() !== Booted; } catch { Stale = true; } }
	return Stale;
}
async function Audit(Pool, User, Action, Target, Detail = '') {
	await Pool.query('INSERT INTO admin_actions(admin_id, action, target, detail) VALUES ($1, $2, $3, $4)', [User.id, Action, Target, Detail.slice(0, 500)]);
}

async function DeleteVideos(Pool, Config, Where, Values) {
	const Removed = await Pool.query(`DELETE FROM videos WHERE ${Where} RETURNING file_name, cover_name, download_name`, Values);
	for (const Row of Removed.rows) await Promise.all([RemoveMedia(Config, Row.file_name), RemoveMedia(Config, Row.cover_name), Row.download_name && RemoveMedia(Config, Row.download_name)]);
	return Removed.rowCount;
}

export async function Admin(Context) {
	const { Request, Response, Url, Pool, Config, User, Unknown } = Context;
	const MediaShape = Media => Media && { kind: Media.kind, url: `${Config.Origin}/api/v1/im/media/${Media.uri}?review=1`, cover: Media.kind === 'video' ? `${Config.Origin}/api/v1/im/media/${Media.uri}/cover?review=1` : null };
	const Text = (Content, Media) => MessageText(Content) || { image: '[Photo]', video: '[Video]' }[Media?.kind] || '';
	const ReportShape = Row => ({ ...Row, owner_avatar: AvatarUrl(Row, Config.Origin), cover: Row.cover_name ? `${Config.Origin}/media/${Row.cover_name}?review=1` : null, message_text: Row.message_content === null ? null : Text(Row.message_content, Row.message_media), message_content: undefined, message_media: MediaShape(Row.message_media),
		exists: Row.target_type === 'user' ? Boolean(Row.owner) : Row.target_type === 'video' ? Boolean(Row.cover_name) : Row.target_type === 'message' ? Row.message_content !== null : Row.comment_body !== null });
	const Path = Url.pathname;

	const BrandMatch = Path.match(/^\/brand\/([a-zA-Z]+)$/);
	if (BrandMatch && BrandSlots[BrandMatch[1]]) {
		RequireMethod(Request, ['GET', 'HEAD']);
		const Custom = Config.Brand?.[BrandMatch[1]];
		const Default = join(Root, BrandSlots[BrandMatch[1]]);
		const Body = Custom ? await readFile(join(Config.MediaDir, Custom)).catch(() => null) : null;
		Response.writeHead(200, { 'content-type': Body ? 'image/png' : 'image/svg+xml', 'cache-control': Url.searchParams.has('v') ? 'public, max-age=31536000, immutable' : 'no-cache' });
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
		const Boot = { name: Config.Name, csrf: User.csrf_token, me: { id: User.id, username: User.username, avatar: AvatarUrl(User, Config.Origin) }, features: Features, misc: MiscFeatures, categories: Categories, badges: BadgeCatalog, ipKey: Boolean(await InstanceKey(Pool)), outdated: Outdated() };
		ClientPage ??= readFile(join(ClientDir, 'index.html'), 'utf8');
		const Html = Shell(await ClientPage, Config.Origin, { Config, User }).replace('</head>', `<link rel="stylesheet" href="${Public('admin.css')}"><script id="kittok-admin-boot" type="application/json">${JSON.stringify(Boot).replaceAll('<', '\\u003c')}</script><script src="${Public('admin.js')}" defer></script></head>`);
		Response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
		Response.end(Html);
		return true;
	}

	if (!Path.startsWith('/_kittok/admin/')) return false;
	if (User?.role !== 'admin') throw new HttpError(404, 'NotFound');
	if (Outdated()) Response.setHeader('x-kittok-outdated', '1');
	const Route = Path.slice('/_kittok/admin/'.length);
	const Params = Url.searchParams;

	if (Request.method === 'GET') {
		if (Route === 'overview') {
			const Stats = (await Pool.query(`SELECT (SELECT count(*)::int FROM users) AS users, (SELECT count(*)::int FROM users WHERE created_at > now() - interval '7 days') AS new_users,
				(SELECT count(*)::int FROM users WHERE suspended_at IS NOT NULL AND deactivated_at IS NULL) AS suspended, (SELECT count(*)::int FROM videos) AS videos, (SELECT coalesce(sum(view_count), 0)::int FROM videos) AS views,
				(SELECT count(*)::int FROM comments) AS comments, (SELECT count(*)::int FROM likes) AS likes, (SELECT count(*)::int FROM sessions WHERE expires_at > now()) AS sessions,
				(SELECT count(*)::int FROM moderation_decisions WHERE reversed_at IS NULL AND account_action <> 'none' AND created_at > now() - interval '30 days') AS violations,
				(SELECT count(*)::int FROM invites WHERE expires_at > now() AND uses < max_uses) AS invites, (SELECT count(*)::int FROM reports WHERE status = 'open') AS reports`)).rows[0];
			const Signups = (await Pool.query('SELECT u.id, u.username, u.display_name, u.avatar_name, u.created_at, e.country FROM users u LEFT JOIN LATERAL (SELECT country FROM user_events WHERE user_id = u.id AND kind = \'signup\' ORDER BY id LIMIT 1) e ON true ORDER BY u.id DESC LIMIT 6')).rows;
			const Missing = [...(Unknown ?? new Map())].sort((A, B) => B[1] - A[1]).slice(0, 8).map(([Call, Count]) => ({ call: Call, count: Count }));
			Json(Response, { stats: Stats, registration: Config.Registration, signups: Signups.map(Row => ({ ...Row, avatar: AvatarUrl(Row, Config.Origin) })), missing: Missing }); return true;
		}
		if (Route === 'users') {
			const Query = (Params.get('q') ?? '').trim().slice(0, 64);
			const Like = Query.replace(/^@/, '').replace(/[\\%_]/g, '\\$&');
			const IsIp = /^[0-9a-fA-F:.]{3,45}$/.test(Query) && /[.:]/.test(Query);
			const Rows = (await Pool.query(`SELECT u.id, u.username, u.display_name, u.role, u.verified, u.pride_flag, u.user_badges, u.created_at, u.suspended_at, u.deactivated_at, u.delete_after, u.avatar_name,
				(SELECT count(*)::int FROM videos v WHERE v.author_id = u.id) AS videos, (SELECT count(*)::int FROM follows f WHERE f.following_id = u.id) AS followers,
				(SELECT count(*)::int FROM moderation_decisions x WHERE x.owner_id = u.id AND x.reversed_at IS NULL AND x.account_action IN ('strike', 'ban')) AS violations
				FROM users u WHERE ($1 = '' OR u.username ILIKE '%' || $1 || '%' ESCAPE '\\' OR u.display_name ILIKE '%' || $1 || '%' ESCAPE '\\' OR u.id::text = $1
					OR ($3 AND EXISTS (SELECT 1 FROM user_events e WHERE e.user_id = u.id AND e.ip_hash = $4)))
				AND ($2::bigint IS NULL OR u.id < $2) ORDER BY u.id DESC LIMIT 50`, [Like, Before(Params.get('before')), IsIp && Boolean(HashIp(Query)), HashIp(Query) ?? ''])).rows;
			Json(Response, { users: Rows.map(Row => ({ ...Row, avatar: AvatarUrl(Row, Config.Origin), self: Row.id === User.id })), hasMore: Rows.length === 50 }); return true;
		}
		const UserMatch = Route.match(/^users\/(\d+)$/);
		if (UserMatch) {
			const Target = Id(UserMatch[1]);
			const Profile = (await Pool.query('SELECT id, username, display_name, bio, role, verified, pride_flag, user_badges, avatar_name, created_at, suspended_at, deactivated_at, delete_after, notices_read_at, ip_consent FROM users WHERE id = $1', [Target])).rows[0];
			if (!Profile) throw new HttpError(404, 'UserNotFound');
			const [Events, Sessions, Videos, Comments, Violations, Related, Seen, Against, Filed] = await Promise.all([
				Pool.query(`SELECT id, kind, ${IpState} AS ip, country, language, user_agent, detail, created_at FROM user_events WHERE user_id = $1 ORDER BY id DESC LIMIT 100`, [Target]),
				Pool.query(`SELECT token_hash, ${IpState} AS ip, country, user_agent, created_at, last_seen_at, expires_at FROM sessions WHERE user_id = $1 AND expires_at > now() ORDER BY last_seen_at DESC`, [Target]),
				Pool.query(`SELECT v.id, v.description, v.cover_name, v.created_at, v.view_count::int AS views, (SELECT count(*)::int FROM likes l WHERE l.video_id = v.id) AS likes, (SELECT count(*)::int FROM comments c WHERE c.video_id = v.id) AS comments FROM videos v WHERE v.author_id = $1 ORDER BY v.id DESC LIMIT 60`, [Target]),
				Pool.query(`SELECT c.id, c.body, c.created_at, c.video_id, c.parent_id, a.username AS video_author FROM comments c JOIN videos v ON v.id = c.video_id JOIN users a ON a.id = v.author_id WHERE c.author_id = $1 ORDER BY c.id DESC LIMIT 50`, [Target]),
				Pool.query(`SELECT d.*, d.owner_id AS user_id, d.reversed_at AS revoked_at, CASE WHEN d.target_type = 'video' THEN d.target_id END AS video_id, CASE WHEN d.target_type = 'comment' THEN d.target_id END AS comment_id, u.username AS admin FROM moderation_decisions d LEFT JOIN users u ON u.id = d.moderator_id WHERE d.owner_id = $1 ORDER BY d.id DESC`, [Target]),
				Pool.query(`SELECT u.id, u.username, u.display_name, u.avatar_name, u.suspended_at, count(DISTINCT o.ip_hash)::int AS shared FROM user_events mine JOIN user_events o ON o.ip_hash = mine.ip_hash AND o.user_id <> mine.user_id JOIN users u ON u.id = o.user_id
					WHERE mine.user_id = $1 AND mine.ip_hash IS NOT NULL GROUP BY u.id ORDER BY u.id DESC LIMIT 20`, [Target]),
				Pool.query(`SELECT array_remove(array_agg(DISTINCT country), NULL) AS countries, array_remove(array_agg(DISTINCT language), NULL) AS languages, count(DISTINCT ip_hash)::int AS ips FROM user_events WHERE user_id = $1`, [Target]),
				Pool.query(`${ReportSql} WHERE r.owner_id = $1 ORDER BY r.id DESC LIMIT 50`, [Target]),
				Pool.query(`${ReportSql} WHERE r.reporter_id = $1 ORDER BY r.id DESC LIMIT 50`, [Target]),
			]);
			const Signup = [...Events.rows].reverse().find(Row => Row.kind === 'signup') ?? null;
			Json(Response, {
				user: { ...Profile, avatar: AvatarUrl(Profile, Config.Origin), self: Profile.id === User.id, stats: await UserStats(Pool, Target) },
				signup: Signup, seen: Seen.rows[0], events: Events.rows,
				sessions: Sessions.rows.map(Row => ({ ...Row, id: Row.token_hash.slice(0, 16), token_hash: undefined })),
				videos: Videos.rows.map(Row => ({ ...Row, cover: `${Config.Origin}/media/${Row.cover_name}?review=1` })),
				comments: Comments.rows, violations: Violations.rows, standing: await Standing(Pool, Target, Config.Moderation),
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
			Json(Response, { videos: Rows.map(Row => ({ ...Row, cover: `${Config.Origin}/media/${Row.cover_name}?review=1` })), hasMore: Rows.length === 30 }); return true;
		}
		const CommentSql = `SELECT c.id, c.body, c.created_at, c.video_id, c.parent_id, u.id AS author_id, u.username, u.display_name, u.avatar_name, a.username AS video_author, v.description AS video_description, v.cover_name,
			(SELECT count(*)::int FROM comment_likes l WHERE l.comment_id = c.id) AS likes, (SELECT count(*)::int FROM comments r WHERE r.parent_id = c.id) AS replies
			FROM comments c JOIN users u ON u.id = c.author_id JOIN videos v ON v.id = c.video_id JOIN users a ON a.id = v.author_id`;
		const CommentShape = Row => ({ ...Row, avatar: AvatarUrl(Row, Config.Origin), cover: `${Config.Origin}/media/${Row.cover_name}?review=1` });
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
				Pool.query(`SELECT d.*, d.owner_id AS user_id, d.reversed_at AS revoked_at, CASE WHEN d.target_type = 'video' THEN d.target_id END AS video_id, CASE WHEN d.target_type = 'comment' THEN d.target_id END AS comment_id, u.username AS admin FROM moderation_decisions d LEFT JOIN users u ON u.id = d.moderator_id WHERE d.target_type = 'comment' AND d.target_id = $1 ORDER BY d.id DESC`, [Comment.id]),
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
		if (Route === 'collectibles') { Json(Response, CollectibleCounts()); return true; }
		if (Route === 'console') {
			const Counts = (await Pool.query(`SELECT (SELECT count(DISTINCT (target_type, target_id))::int FROM reports WHERE status = 'open') AS tickets,
				(SELECT count(*)::int FROM moderation_appeals WHERE status = 'pending') AS appeals,
				(SELECT count(*)::int FROM moderation_decisions WHERE created_at > now() - interval '24 hours') AS decisions_today,
				(SELECT count(*)::int FROM moderation_restrictions WHERE lifted_at IS NULL AND (expires_at IS NULL OR expires_at > now())) AS restrictions,
				(SELECT count(*)::int FROM users WHERE suspended_at IS NOT NULL AND deactivated_at IS NULL) AS banned,
				(SELECT min(created_at) FROM reports WHERE status = 'open') AS oldest_ticket,
				(SELECT count(*)::int FROM moderation_appeals WHERE reviewed_at > now() - interval '30 days') AS appeals_reviewed,
				(SELECT count(*)::int FROM moderation_appeals WHERE status = 'restored' AND reviewed_at > now() - interval '30 days') AS appeals_restored,
				(SELECT count(*)::int FROM users) AS users, (SELECT count(*)::int FROM users WHERE created_at > now() - interval '7 days') AS new_users,
				(SELECT count(*)::int FROM videos) AS videos, (SELECT count(*)::int FROM comments) AS comments, (SELECT count(*)::int FROM sessions WHERE expires_at > now()) AS sessions`)).rows[0];
			const Daily = (await Pool.query(`SELECT d::date AS day, (SELECT count(*)::int FROM moderation_decisions WHERE created_at::date = d::date) AS decisions,
				(SELECT count(*)::int FROM reports WHERE created_at::date = d::date) AS reports FROM generate_series(current_date - 13, current_date, interval '1 day') d ORDER BY d`)).rows;
			const Missing = [...(Unknown ?? new Map())].sort((A, B) => B[1] - A[1]).slice(0, 6).map(([Call, Count]) => ({ call: Call, count: Count }));
			Json(Response, { counts: Counts, daily: Daily, missing: Missing, registration: Config.Registration }); return true;
		}
		if (Route === 'tickets') {
			const Rows = (await Pool.query(`SELECT r.target_type, r.target_id, count(*)::int AS reports, min(r.created_at) AS first_at, max(r.created_at) AS last_at, min(r.id) AS report_id,
				array_agg(r.category ORDER BY r.id) AS categories, r.owner_id, own.username, own.display_name, own.avatar_name, own.suspended_at,
				v.description, v.cover_name, c.body, cv.cover_name AS comment_cover, msg.content AS message_content, ${MediaSql('msg')} AS message_media,
				(SELECT count(*)::int FROM moderation_decisions d WHERE d.owner_id = r.owner_id AND d.account_action = 'strike' AND d.reversed_at IS NULL AND d.penalty_expires_at > now()) AS strikes
				FROM reports r LEFT JOIN users own ON own.id = r.owner_id LEFT JOIN videos v ON r.target_type = 'video' AND v.id = r.target_id
				LEFT JOIN comments c ON r.target_type = 'comment' AND c.id = r.target_id LEFT JOIN videos cv ON cv.id = c.video_id LEFT JOIN messages msg ON r.target_type = 'message' AND msg.id = r.target_id
				WHERE r.status = 'open' AND ($1 = '' OR r.target_type = $1)
				GROUP BY r.target_type, r.target_id, r.owner_id, own.id, v.id, c.id, cv.id, msg.id`, [['video', 'comment', 'user', 'message'].includes(Params.get('type')) ? Params.get('type') : ''])).rows;
			const Severity = { self_harm: 5, violence: 5, hate: 4, nudity: 4, harassment: 3, impersonation: 3, misinformation: 2, copyright: 2, spam: 1, other: 1 };
			const Tickets = Rows.map(Row => {
				const Tally = {}; for (const Category of Row.categories) Tally[Category] = (Tally[Category] ?? 0) + 1;
				const Top = Object.entries(Tally).sort((A, B) => B[1] - A[1] || Severity[B[0]] - Severity[A[0]])[0][0];
				const Priority = Math.max(...Row.categories.map(Category => Severity[Category] ?? 1)) * 10 + Math.min(Row.reports, 9);
				return { type: Row.target_type, id: Row.target_id, report: Row.report_id, reports: Row.reports, first_at: Row.first_at, last_at: Row.last_at, reasons: Tally, top: Top, priority: Priority,
					preview: { video: Row.description, comment: Row.body, message: Row.message_content === null ? null : Text(Row.message_content, Row.message_media) }[Row.target_type] ?? Row.display_name,
					thumb: Row.cover_name || Row.comment_cover ? `${Config.Origin}/media/${Row.cover_name || Row.comment_cover}?review=1` : Row.message_media ? (({ url, cover }) => cover ?? url)(MediaShape(Row.message_media)) : null,
					owner: Row.owner_id ? { id: Row.owner_id, username: Row.username, display_name: Row.display_name, avatar: AvatarUrl(Row, Config.Origin), banned: Boolean(Row.suspended_at), strikes: Row.strikes } : null };
			}).sort((A, B) => B.priority - A.priority || new Date(A.first_at) - new Date(B.first_at));
			Json(Response, { tickets: Tickets }); return true;
		}
		const TicketMatch = Route.match(/^tickets\/(video|comment|user|message)\/(\d+)$/);
		if (TicketMatch) {
			const [, Type, RawId] = TicketMatch, TargetId = Id(RawId);
			const Content = (await Pool.query({
				video: `SELECT v.id, v.description AS text, v.file_name, v.cover_name, v.width, v.height, v.duration, v.created_at, v.view_count::int AS views, v.author_id AS owner,
					(SELECT count(*)::int FROM likes l WHERE l.video_id = v.id) AS likes, (SELECT count(*)::int FROM comments c WHERE c.video_id = v.id) AS comments FROM videos v WHERE v.id = $1`,
				comment: `SELECT c.id, c.body AS text, c.created_at, c.video_id, c.parent_id, c.author_id AS owner, v.description AS video_text, v.cover_name, p.body AS parent_text, pu.username AS parent_author,
					(SELECT count(*)::int FROM comment_likes l WHERE l.comment_id = c.id) AS likes FROM comments c JOIN videos v ON v.id = c.video_id LEFT JOIN comments p ON p.id = c.parent_id LEFT JOIN users pu ON pu.id = p.author_id WHERE c.id = $1`,
				user: 'SELECT u.id, u.display_name AS text, u.bio, u.created_at, u.id AS owner FROM users u WHERE u.id = $1',
				message: `SELECT m.id, m.content AS text, m.created_at, m.conversation_id, m.index_in_conversation, m.sender_id AS owner, ${MediaSql('m')} AS media FROM messages m WHERE m.id = $1`,
			}[Type], [TargetId])).rows[0] ?? null;
			if (Content && Type === 'message') {
				Content.text = MessageText(Content.text); Content.media = MediaShape(Content.media);
				Content.thread = (await Pool.query(`SELECT m.id, m.sender_id, u.username, m.content, m.created_at, ${MediaSql('m')} AS media FROM messages m LEFT JOIN users u ON u.id = m.sender_id
					WHERE m.conversation_id = $1 AND m.index_in_conversation BETWEEN $2 - 8 AND $2 + 3 ORDER BY m.index_in_conversation`, [Content.conversation_id, Content.index_in_conversation])).rows.map(Row => ({ ...Row, content: undefined, text: MessageText(Row.content), media: MediaShape(Row.media) }));
			}
			const Reports = (await Pool.query('SELECT r.id, r.category, r.description, r.status, r.created_at, r.resolution, u.username AS reporter FROM reports r LEFT JOIN users u ON u.id = r.reporter_id WHERE r.target_type = $1 AND r.target_id = $2 ORDER BY r.id DESC', [Type, TargetId])).rows;
			const OwnerId = Content?.owner ?? (await Pool.query('SELECT owner_id FROM reports WHERE target_type = $1 AND target_id = $2 LIMIT 1', [Type, TargetId])).rows[0]?.owner_id;
			const Owner = OwnerId ? (await Pool.query('SELECT id, username, display_name, avatar_name, role, created_at, suspended_at FROM users WHERE id = $1', [OwnerId])).rows[0] : null;
			const Decisions = (await Pool.query(`SELECT d.*, m.username AS moderator FROM moderation_decisions d LEFT JOIN users m ON m.id = d.moderator_id WHERE d.target_type = $1 AND d.target_id = $2 ORDER BY d.id DESC`, [Type, TargetId])).rows;
			const Media = Name => Name ? `${Config.Origin}/media/${Name}?review=1` : null;
			Json(Response, {
				type: Type, id: TargetId, open: Reports.filter(Row => Row.status === 'open').map(Row => Row.id),
				content: Content && { ...Content, file: Media(Content.file_name), cover: Media(Content.cover_name), file_name: undefined, cover_name: undefined },
				reports: Reports, decisions: Decisions,
				owner: Owner && { ...Owner, avatar: AvatarUrl(Owner, Config.Origin), standing: await Standing(Pool, Owner.id, Config.Moderation) },
			}); return true;
		}
		if (Route === 'decisions') {
			const Action = ['warning', 'strike', 'ban', 'none'].includes(Params.get('action')) ? Params.get('action') : null;
			const Category = Categories.includes(Params.get('category')) ? Params.get('category') : null;
			const Rows = (await Pool.query(`SELECT d.id, d.target_type, d.target_id, d.category, d.reason, d.content_action, d.account_action, d.feature, d.severe, d.created_at, d.reversed_at, d.snapshot,
				o.id AS owner_id, o.username AS owner, o.avatar_name, m.username AS moderator, (SELECT array_agg(r.feature) FROM moderation_restrictions r WHERE r.decision_id = d.id) AS restrictions
				FROM moderation_decisions d LEFT JOIN users o ON o.id = d.owner_id LEFT JOIN users m ON m.id = d.moderator_id
				WHERE ($1::bigint IS NULL OR d.id < $1) AND ($2::text IS NULL OR d.account_action = $2) AND ($3::text IS NULL OR d.category = $3) ORDER BY d.id DESC LIMIT 50`, [Before(Params.get('before')), Action, Category])).rows;
			Json(Response, { decisions: Rows.map(Row => ({ ...Row, avatar: AvatarUrl(Row, Config.Origin) })), hasMore: Rows.length === 50 }); return true;
		}
		if (Route === 'appeals') {
			const Status = ['pending', 'restored', 'upheld'].includes(Params.get('status')) ? Params.get('status') : 'pending';
			const Rows = (await Pool.query(`SELECT a.*, u.username, u.display_name, u.avatar_name, d.target_type, d.target_id, d.category, d.reason AS decision_reason, d.content_action, d.account_action, d.snapshot, d.created_at AS decided_at,
				r.username AS reviewer FROM moderation_appeals a JOIN users u ON u.id = a.user_id JOIN moderation_decisions d ON d.id = a.decision_id LEFT JOIN users r ON r.id = a.reviewer_id
				WHERE a.status = $1 AND ($2::bigint IS NULL OR a.id < $2) ORDER BY a.id DESC LIMIT 50`, [Status, Before(Params.get('before'))])).rows;
			Json(Response, { appeals: Rows.map(Row => ({ ...Row, avatar: AvatarUrl(Row, Config.Origin) })), hasMore: Rows.length === 50 }); return true;
		}
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
		if (Slot === 'wordmarkDark') WarmDownloads(Pool, Config).catch(() => {});
		Json(Response, Settings(Config).brand); return true;
	}
	if (Route === 'collectibles') {
		const Type = Request.headers['content-type'] ?? '';
		let Categories;
		if (Type.startsWith('multipart/form-data')) {
			const File = (await new globalThis.Response(await ReadRaw(Request, 20 * 1024 * 1024), { headers: { 'content-type': Type } }).formData().catch(() => null))?.get('file');
			if (!(File instanceof Blob)) throw new HttpError(400, 'InvalidUpload');
			try { Categories = JSON.parse(await File.text()); } catch { throw new HttpError(400, 'InvalidCollectibles'); }
		} else {
			const Address = String((await ReadBody(Request, 4096)).url ?? '');
			let Url;
			try { Url = new URL(Address); } catch { throw new HttpError(400, 'InvalidUrl'); }
			if (Url.protocol !== 'https:') throw new HttpError(400, 'InvalidUrl');
			const Remote = await fetch(Url, { signal: AbortSignal.timeout(30000), redirect: 'follow' }).catch(() => null);
			if (!Remote?.ok) throw new HttpError(502, 'CouldntDownload');
			const Raw = await Remote.arrayBuffer();
			if (Raw.byteLength > 20 * 1024 * 1024) throw new HttpError(413, 'TooLarge');
			try { Categories = JSON.parse(Buffer.from(Raw).toString('utf8')); } catch { throw new HttpError(400, 'InvalidCollectibles'); }
		}
		const Counts = await SaveCollectibles(Config, Array.isArray(Categories?.categories) ? Categories.categories : Categories);
		await Audit(Pool, User, 'collectibles.import', 'discord', `${Counts.decorations} decorations, ${Counts.nameplates} nameplates`);
		Json(Response, Counts); return true;
	}
	const Body = await ReadBody(Request, 32768);
	if (Route === 'settings/mail') {
		const Input = Body.value ?? {};
		if (!String(Input.host ?? '').trim()) {
			await Pool.query("DELETE FROM settings WHERE key = 'mail'");
			RestoreEnvMail(Config);
			await Audit(Pool, User, 'settings.mail', 'mail', 'cleared');
			Json(Response, Settings(Config)); return true;
		}
		const Previous = Config.MailSetting;
		const Password = typeof Input.password === 'string' && Input.password ? LocalSeal(Input.password) : Input.keepPassword === false ? '' : Previous?.password ?? '';
		const Saved = await SaveSetting(Pool, Config, 'mail', { host: String(Input.host).trim(), port: Number(Input.port), secure: Input.secure, username: String(Input.username ?? '').trim(), password: Password, from: String(Input.from ?? '') });
		await Audit(Pool, User, 'settings.mail', 'mail', `${Saved.host}:${Saved.port}`);
		Json(Response, Settings(Config)); return true;
	}
	if (Route === 'mail/test') {
		const To = String(Body.to ?? '').trim();
		if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(To) || To.length > 254) throw new HttpError(400, 'InvalidEmail');
		try { await SendMail(Config, { To, Subject: `${Config.Name} test email`, Text: `This is a test email from ${Config.Name}. Your mail settings work.`, Html: `<p>This is a test email from ${Escape(Config.Name)}. Your mail settings work.</p>` }); }
		catch (Failure) { throw Failure instanceof HttpError ? Failure : new HttpError(502, 'MailFailed'); }
		await Audit(Pool, User, 'mail.test', To);
		Json(Response, { ok: true }); return true;
	}
	const SettingMatch = Route.match(/^settings\/([a-z]+)$/);
	if (SettingMatch && SettingMatch[1] !== 'brand') {
		const Saved = await SaveSetting(Pool, Config, SettingMatch[1], Body.value);
		await Audit(Pool, User, `settings.${SettingMatch[1]}`, SettingMatch[1], typeof Saved === 'string' ? Saved.slice(0, 120) : JSON.stringify(Saved).slice(0, 200));
		Json(Response, Settings(Config)); return true;
	}
	const Reveal = Route.match(/^users\/(\d+)\/ips$/);
	if (Reveal) {
		const Target = Id(Reveal[1]);
		const Account = (await Pool.query('SELECT username, ip_consent FROM users WHERE id = $1', [Target])).rows[0];
		if (!Account) throw new HttpError(404, 'UserNotFound');
		if (Account.ip_consent !== true) throw new HttpError(403, 'OptedOut');
		const Record = await InstanceKey(Pool);
		if (!Record) throw new HttpError(409, 'NoSecurityKey');
		Reveals.Hit(User.id, 5, 10 * 60000);
		const Private = Unlock(Record, String(Body.key ?? ''));
		if (!Private) { await Audit(Pool, User, 'ips.denied', `@${Account.username}`); throw new HttpError(403, 'WrongSecurityKey'); }
		const [Events, Sessions] = await Promise.all([
			Pool.query('SELECT id, ip_sealed FROM user_events WHERE user_id = $1 AND ip_sealed IS NOT NULL ORDER BY id DESC LIMIT 100', [Target]),
			Pool.query('SELECT left(token_hash, 16) AS id, ip_sealed FROM sessions WHERE user_id = $1 AND ip_sealed IS NOT NULL AND expires_at > now()', [Target]),
		]);
		await Audit(Pool, User, 'ips.reveal', `@${Account.username}`);
		const Map = Rows => Object.fromEntries(Rows.map(Row => [Row.id, Open(Private, Row.ip_sealed)]).filter(Pair => Pair[1]));
		Json(Response, { events: Map(Events.rows), sessions: Map(Sessions.rows) }); return true;
	}
	const Verification = Route.match(/^users\/(\d+)\/verification$/);
	if (Verification) {
		if (typeof Body.verified !== 'boolean') throw new HttpError(400, 'InvalidVerification');
		const Target = Id(Verification[1]);
		await Transaction(Pool, async Client => {
			const Account = (await Client.query('SELECT username, verified FROM users WHERE id = $1 FOR UPDATE', [Target])).rows[0];
			if (!Account) throw new HttpError(404, 'UserNotFound');
			if (Account.verified === Body.verified) return;
			await Client.query('UPDATE users SET verified = $2 WHERE id = $1', [Target, Body.verified]);
			await Audit(Client, User, 'user.verification', `@${Account.username}`, Body.verified ? 'verified' : 'unverified');
		});
		Json(Response, { ok: true, verified: Body.verified }); return true;
	}
	const Badges = Route.match(/^users\/(\d+)\/badges$/);
	if (Badges) {
		if (Body.prideFlag === undefined && Body.userBadges === undefined) throw new HttpError(400, 'InvalidUserBadges');
		const Flag = Body.prideFlag === undefined ? undefined : PrideFlag(Body.prideFlag);
		const Awards = Body.userBadges === undefined ? undefined : UserBadges(Body.userBadges);
		const Updated = await Transaction(Pool, async Client => {
			const Account = (await Client.query('SELECT id, username, pride_flag, user_badges FROM users WHERE id=$1 FOR UPDATE', [Id(Badges[1])])).rows[0];
			if (!Account) throw new HttpError(404, 'UserNotFound');
			const Next = { ...Account, pride_flag: Flag ?? Account.pride_flag, user_badges: Awards ?? Account.user_badges };
			if (Next.pride_flag !== Account.pride_flag || JSON.stringify(Next.user_badges) !== JSON.stringify(Account.user_badges)) {
				await Client.query('UPDATE users SET pride_flag=$2, user_badges=$3 WHERE id=$1', [Account.id, Next.pride_flag, Next.user_badges]);
				await Audit(Client, User, 'user.badges', `@${Account.username}`, 'Profile badges updated');
			}
			return Next;
		});
		Json(Response, { ok: true, prideFlag: Updated.pride_flag, userBadges: Updated.user_badges, kittokBadges: PublicBadges(Updated) }); return true;
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
			await Enforce(Pool, User, { target_type: 'user', target_id: Target, category: Categories.includes(Body.category) ? Body.category : 'other', reason: String(Body.reason ?? '').trim() || 'Suspended by an administrator', account_action: 'ban', severe: true }, Config.Moderation);
		} else if (Action === 'unsuspend') {
			const Bans = (await Pool.query("SELECT id FROM moderation_decisions WHERE owner_id = $1 AND account_action = 'ban' AND reversed_at IS NULL", [Target])).rows;
			for (const Ban of Bans) await ReverseDecision(Pool, User, Ban.id, String(Body.reason ?? '').trim() || 'Unsuspended by an administrator');
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
			await Enforce(Pool, User, { target_type: VideoId ? 'video' : CommentId ? 'comment' : 'user', target_id: VideoId ?? CommentId ?? Target, category: Category, reason: Reason, account_action: 'strike' }, Config.Moderation);
			Detail = `${Category}: ${Reason}`;
		} else {
			if (Body.confirm !== Found.username) throw new HttpError(400, 'TypeTheUsernameToConfirm');
			await DeleteAccount(Pool, Config, Target);
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
	const ViolationMatch = Route.match(/^(?:violations|decisions)\/(\d+)\/(?:revoke|reverse)$/);
	if (ViolationMatch) {
		await ReverseDecision(Pool, User, ViolationMatch[1], String(Body.reason ?? '').trim() || 'Revoked by an administrator');
		Json(Response, { ok: true }); return true;
	}
	if (Route === 'enforce') { Json(Response, await Enforce(Pool, User, Body, Config.Moderation)); return true; }
	const DecideMatch = Route.match(/^reports\/(\d+)\/decide$/);
	if (DecideMatch) { Json(Response, await DecideReport(Pool, User, DecideMatch[1], Body, Config.Moderation)); return true; }
	const LiftMatch = Route.match(/^restrictions\/(\d+)\/lift$/);
	if (LiftMatch) { Json(Response, await LiftRestriction(Pool, User, LiftMatch[1])); return true; }
	const AppealMatch = Route.match(/^appeals\/(\d+)\/review$/);
	if (AppealMatch) { Json(Response, await ReviewAppeal(Pool, User, AppealMatch[1], Body.outcome, Body.reason)); return true; }
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
