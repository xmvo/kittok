import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { Transaction } from './db.mjs';
import { HttpError, Id } from './http.mjs';

export const PolicyCategories = ['spam', 'harassment', 'hate', 'nudity', 'violence', 'self_harm', 'misinformation', 'impersonation', 'copyright', 'other'];
export const ViolationFeatures = { video: 'Videos', comment: 'Comments', message: 'Direct messages', profile: 'Profile', live: 'LIVE' };
export const RestrictableFeatures = { upload: 'Posting videos', comment: 'Commenting', message: 'Sending direct messages', live: 'Going LIVE', follow: 'Following accounts', profile: 'Editing your profile' };
export const RestrictionHours = [1, 24, 48, 72, 168, 720];
export const DefaultThresholds = { strikeDays: 90, feature: 5, total: 10, policy: { spam: 6, harassment: 4, hate: 3, nudity: 4, violence: 3, self_harm: 4, misinformation: 5, impersonation: 3, copyright: 5, other: 5 } };
const TargetFeature = { video: 'video', comment: 'comment', user: 'profile', message: 'message' };
const PolicyNames = { spam: 'spam', harassment: 'harassment and bullying', hate: 'hateful behavior', nudity: 'nudity and sexual content', violence: 'violent and graphic content', self_harm: 'suicide and self-harm', misinformation: 'misinformation', impersonation: 'impersonation', copyright: 'intellectual property', other: 'our Community Guidelines' };

export function MessageText(Content) {
	try { const Parsed = JSON.parse(Content); return typeof Parsed?.text === 'string' ? Parsed.text : ''; } catch { return String(Content ?? ''); }
}

export const RemovedSql = (Type, Target) => `EXISTS (SELECT 1 FROM moderation_decisions md WHERE md.target_type = '${Type}' AND md.target_id = ${Target} AND md.content_action = 'remove' AND md.reversed_at IS NULL)`;
export const ForYouIneligibleSql = Target => `EXISTS (SELECT 1 FROM moderation_decisions mf WHERE mf.target_type = 'video' AND mf.target_id = ${Target} AND mf.content_action = 'fyf_ineligible' AND mf.reversed_at IS NULL)`;

export class RestrictedError extends HttpError {
	constructor(Restriction) {
		super(403, `${Restriction.feature[0].toUpperCase()}${Restriction.feature.slice(1)}Restricted`);
		this.Restriction = Restriction;
	}
}

export const Until = Restriction => Restriction.expires_at ? new Date(Restriction.expires_at).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'UTC', timeZoneName: 'short' }) : null;

const RestrictionPhrase = Restriction => `you're restricted from ${{ upload: 'posting videos', comment: 'commenting', message: 'sending messages', live: 'going LIVE', follow: 'following accounts', profile: 'editing your profile' }[Restriction.feature]}${Restriction.expires_at ? ` until ${Until(Restriction)}` : ''}`;
export const RestrictionText = Restriction => `Due to Community Guideline violations, ${RestrictionPhrase(Restriction)}.`;

export async function ActiveRestriction(Pool, UserId, Feature) {
	const Result = await Pool.query(`SELECT id, feature, expires_at, reason FROM moderation_restrictions WHERE user_id = $1 AND feature = $2 AND lifted_at IS NULL
		AND (expires_at IS NULL OR expires_at > now()) ORDER BY expires_at DESC NULLS FIRST LIMIT 1`, [UserId, Feature]);
	return Result.rows[0] ?? null;
}

export async function AssertAllowed(Pool, User, Feature) {
	if (!User) return;
	const Restriction = await ActiveRestriction(Pool, User.id, Feature);
	if (Restriction) throw new RestrictedError(Restriction);
}

async function StrikeCounts(Client, UserId) {
	const Result = await Client.query(`SELECT feature, category, count(*)::int AS count FROM moderation_decisions WHERE owner_id = $1 AND account_action = 'strike'
		AND reversed_at IS NULL AND penalty_expires_at > now() GROUP BY feature, category`, [UserId]);
	const Counts = { total: 0, feature: {}, policy: {} };
	for (const Row of Result.rows) {
		Counts.total += Row.count;
		Counts.feature[Row.feature] = (Counts.feature[Row.feature] ?? 0) + Row.count;
		Counts.policy[Row.category] = (Counts.policy[Row.category] ?? 0) + Row.count;
	}
	return Counts;
}

function Breached(Counts, Thresholds) {
	for (const [Feature, Count] of Object.entries(Counts.feature)) if (Count >= Thresholds.feature) return `the strike limit for ${ViolationFeatures[Feature].toLowerCase()}`;
	for (const [Policy, Count] of Object.entries(Counts.policy)) if (Count >= (Thresholds.policy[Policy] ?? Thresholds.feature)) return `the strike limit for ${PolicyNames[Policy]}`;
	return Counts.total >= Thresholds.total ? 'the overall strike limit' : null;
}

async function Ban(Client, UserId) {
	await Client.query('UPDATE users SET suspended_at = coalesce(suspended_at, now()) WHERE id = $1', [UserId]);
	await Client.query('DELETE FROM sessions WHERE user_id = $1', [UserId]);
}

async function Decide(Client, Moderator, Input, Thresholds) {
	const { target_type: Type, category: Category, content_action: Content = 'none', severe: Severe = false } = Input;
	let Account = Input.account_action ?? 'none';
	const Reason = String(Input.reason ?? '').trim();
	const Restrictions = Array.isArray(Input.restrictions) ? Input.restrictions : [];
	if (!TargetFeature[Type]) throw new HttpError(400, 'InvalidTarget');
	if (!PolicyCategories.includes(Category) || !Reason || Reason.length > 1000) throw new HttpError(400, 'InvalidReason');
	if (!['none', 'remove', 'fyf_ineligible'].includes(Content) || !['none', 'strike', 'ban'].includes(Account)) throw new HttpError(400, 'InvalidDecision');
	if (Content === 'fyf_ineligible' && Type !== 'video' || Content === 'remove' && Type === 'user') throw new HttpError(400, 'InvalidDecision');
	if (Restrictions.length > Object.keys(RestrictableFeatures).length || Restrictions.some(Entry => !RestrictableFeatures[Entry?.feature] || !(Entry.hours === null || RestrictionHours.includes(Number(Entry.hours))))) throw new HttpError(400, 'InvalidRestriction');
	if (new Set(Restrictions.map(Entry => Entry.feature)).size !== Restrictions.length) throw new HttpError(400, 'InvalidRestriction');
	if (Content === 'none' && Account === 'none' && !Restrictions.length) throw new HttpError(400, 'InvalidDecision');
	const TargetId = Id(Input.target_id);
	const Target = (await Client.query({
		video: 'SELECT author_id AS owner, description AS text, cover_name FROM videos WHERE id = $1',
		comment: 'SELECT author_id AS owner, body AS text, video_id FROM comments WHERE id = $1',
		user: 'SELECT id AS owner, display_name AS text, username FROM users WHERE id = $1',
		message: 'SELECT sender_id AS owner, content, message_type, conversation_id FROM messages WHERE id = $1',
	}[Type], [TargetId])).rows[0];
	if (Target && Type === 'message') { Target.text = MessageText(Target.content) || { 1802: '[Photo]', 1803: '[Video]' }[Target.message_type] || ''; delete Target.content; delete Target.message_type; }
	if (!Target) throw new HttpError(404, 'TargetNotFound');
	const Owner = (await Client.query('SELECT id, role, username FROM users WHERE id = $1', [Target.owner])).rows[0];
	if (Owner.id === Moderator.id || Owner.role === 'admin') throw new HttpError(400, 'CannotModerateAdmin');
	await Client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`moderation:user:${Owner.id}`]);
	if (Account === 'strike' && !Severe && !(await Client.query("SELECT 1 FROM moderation_decisions WHERE owner_id = $1 AND account_action IN ('warning', 'strike') AND reversed_at IS NULL LIMIT 1", [Owner.id])).rowCount) Account = 'warning';
	const Feature = TargetFeature[Type];
	const Decision = (await Client.query(`INSERT INTO moderation_decisions(owner_id, moderator_id, target_type, target_id, category, reason, content_action, account_action, penalty_expires_at, snapshot, feature, severe)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CASE WHEN $8 = 'strike' THEN now() + make_interval(days => $9) END, $10, $11, $12) RETURNING *`,
		[Owner.id, Moderator.id, Type, TargetId, Category, Reason, Content, Account, Thresholds.strikeDays, JSON.stringify(Target), Feature, Boolean(Severe)])).rows[0];
	for (const Entry of Restrictions) {
		await Client.query(`INSERT INTO moderation_restrictions(decision_id, user_id, moderator_id, feature, reason, expires_at)
			VALUES ($1, $2, $3, $4, $5, CASE WHEN $6::int IS NULL THEN NULL ELSE now() + make_interval(hours => $6) END)`, [Decision.id, Owner.id, Moderator.id, Entry.feature, Reason, Entry.hours === null ? null : Number(Entry.hours)]);
	}
	let AutoBan = null;
	if (Account === 'ban') await Ban(Client, Owner.id);
	else if (Account === 'strike') {
		const Limit = Breached(await StrikeCounts(Client, Owner.id), Thresholds);
		if (Limit) {
			AutoBan = (await Client.query(`INSERT INTO moderation_decisions(owner_id, moderator_id, target_type, target_id, category, reason, content_action, account_action, feature)
				VALUES ($1, $2, 'user', $1, $3, $4, 'none', 'ban', $5) RETURNING *`, [Owner.id, Moderator.id, Category, `Your account reached ${Limit}.`, Feature])).rows[0];
			await Ban(Client, Owner.id);
		}
	}
	await Client.query('INSERT INTO admin_actions(admin_id, action, target, detail) VALUES ($1, $2, $3, $4)', [Moderator.id, 'moderation.decision', `${Type} ${TargetId}`,
		`${Content}; ${Account}${Restrictions.length ? '; restrict ' + Restrictions.map(Entry => `${Entry.feature} ${Entry.hours ?? 'indefinite'}h`).join(', ') : ''}${AutoBan ? '; automatic ban' : ''}; ${Category}: ${Reason}`]);
	return { decision: Decision, autoBan: AutoBan, owner: Owner.id };
}

export async function Enforce(Pool, Moderator, Input, Thresholds = DefaultThresholds) {
	return Transaction(Pool, Client => Decide(Client, Moderator, Input, Thresholds));
}

export async function DecideReport(Pool, Moderator, ReportId, Body, Thresholds = DefaultThresholds) {
	if (!['no_violation', 'violation'].includes(Body.verdict)) throw new HttpError(400, 'InvalidDecision');
	return Transaction(Pool, async Client => {
		const Report = (await Client.query('SELECT * FROM reports WHERE id = $1', [Id(ReportId)])).rows[0];
		if (!Report) throw new HttpError(404, 'ReportNotFound');
		await Client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`moderation:${Report.target_type}:${Report.target_id}`]);
		if ((await Client.query('SELECT status FROM reports WHERE id = $1 FOR UPDATE', [Report.id])).rows[0].status !== 'open') throw new HttpError(409, 'ReportAlreadyReviewed');
		const Result = Body.verdict === 'violation' ? await Decide(Client, Moderator, { ...Body, target_type: Report.target_type, target_id: Report.target_id }, Thresholds) : null;
		const Resolution = String(Body.reason ?? '').trim().slice(0, 1000);
		const Closed = await Client.query(`UPDATE reports SET status = $3, resolved_by = $4, resolved_at = now(), resolution = $5, decision_id = $6 WHERE target_type = $1 AND target_id = $2 AND status = 'open' RETURNING id`,
			[Report.target_type, Report.target_id, Result ? 'resolved' : 'dismissed', Moderator.id, Resolution, Result?.decision.id ?? null]);
		if (!Result) await Client.query('INSERT INTO admin_actions(admin_id, action, target, detail) VALUES ($1, $2, $3, $4)', [Moderator.id, 'report.dismiss', `${Report.target_type} ${Report.target_id}`, Resolution]);
		return { decision: Result?.decision ?? null, autoBan: Result?.autoBan ?? null, closed: Closed.rowCount };
	});
}

async function Undo(Client, Moderator, DecisionId) {
	const Decision = (await Client.query('UPDATE moderation_decisions SET reversed_at = now(), reversed_by = $2 WHERE id = $1 AND reversed_at IS NULL RETURNING *', [DecisionId, Moderator.id])).rows[0];
	if (!Decision) throw new HttpError(404, 'DecisionNotFound');
	await Client.query('UPDATE moderation_restrictions SET lifted_at = now(), lifted_by = $2 WHERE decision_id = $1 AND lifted_at IS NULL', [Decision.id, Moderator.id]);
	if (Decision.account_action === 'ban' && !(await Client.query("SELECT 1 FROM moderation_decisions WHERE owner_id = $1 AND account_action = 'ban' AND reversed_at IS NULL", [Decision.owner_id])).rowCount) {
		await Client.query('UPDATE users SET suspended_at = NULL WHERE id = $1', [Decision.owner_id]);
	}
	return Decision;
}

export async function ReverseDecision(Pool, Moderator, DecisionId, Reason) {
	if (typeof Reason !== 'string' || !Reason.trim() || Reason.length > 1000) throw new HttpError(400, 'InvalidReason');
	return Transaction(Pool, async Client => {
		const Decision = await Undo(Client, Moderator, Id(DecisionId));
		await Client.query('INSERT INTO admin_actions(admin_id, action, target, detail) VALUES ($1, $2, $3, $4)', [Moderator.id, 'moderation.reverse', `decision ${Decision.id}`, Reason.trim()]);
		return Decision;
	});
}

export async function LiftRestriction(Pool, Moderator, RestrictionId) {
	const Lifted = (await Pool.query('UPDATE moderation_restrictions SET lifted_at = now(), lifted_by = $2 WHERE id = $1 AND lifted_at IS NULL RETURNING *', [Id(RestrictionId), Moderator.id])).rows[0];
	if (!Lifted) throw new HttpError(404, 'RestrictionNotFound');
	await Pool.query('INSERT INTO admin_actions(admin_id, action, target, detail) VALUES ($1, $2, $3, $4)', [Moderator.id, 'moderation.lift', `restriction ${Lifted.id}`, Lifted.feature]);
	return Lifted;
}

export async function Appeal(Pool, User, DecisionId, Reason, Email = null) {
	if (typeof Reason !== 'string' || !Reason.trim() || Reason.length > 1000) throw new HttpError(400, 'InvalidReason');
	const Decision = (await Pool.query("SELECT id FROM moderation_decisions WHERE id = $1 AND owner_id = $2 AND reversed_at IS NULL AND (content_action <> 'none' OR account_action <> 'none' OR EXISTS (SELECT 1 FROM moderation_restrictions r WHERE r.decision_id = moderation_decisions.id))", [Id(DecisionId), User.id])).rows[0];
	if (!Decision) throw new HttpError(404, 'DecisionNotFound');
	if (Email !== null && !/^[^\s@]{1,64}@[^\s@]{1,189}$/.test(Email)) throw new HttpError(400, 'InvalidEmail');
	const Added = await Pool.query('INSERT INTO moderation_appeals(decision_id, user_id, reason, contact_email) VALUES ($1, $2, $3, $4) ON CONFLICT (decision_id) DO NOTHING RETURNING id', [Decision.id, User.id, Reason.trim(), Email]);
	if (!Added.rowCount) throw new HttpError(409, 'AlreadyAppealed');
	return Added.rows[0];
}

export async function ReviewAppeal(Pool, Moderator, AppealId, Outcome, Reason) {
	if (!['restored', 'upheld'].includes(Outcome) || typeof Reason !== 'string' || !Reason.trim() || Reason.length > 1000) throw new HttpError(400, 'InvalidDecision');
	return Transaction(Pool, async Client => {
		const Pending = (await Client.query('SELECT * FROM moderation_appeals WHERE id = $1 FOR UPDATE', [Id(AppealId)])).rows[0];
		if (!Pending) throw new HttpError(404, 'AppealNotFound');
		if (Pending.status !== 'pending') throw new HttpError(409, 'AppealAlreadyReviewed');
		if (Pending.user_id === Moderator.id) throw new HttpError(403, 'CannotReviewOwnAppeal');
		await Client.query('UPDATE moderation_appeals SET status = $2, resolution = $3, reviewer_id = $4, reviewed_at = now() WHERE id = $1', [Pending.id, Outcome, Reason.trim(), Moderator.id]);
		if (Outcome === 'restored') await Undo(Client, Moderator, Pending.decision_id);
		await Client.query('INSERT INTO admin_actions(admin_id, action, target, detail) VALUES ($1, $2, $3, $4)', [Moderator.id, `appeal.${Outcome}`, Pending.id, Reason.trim()]);
		return { ok: true };
	});
}

export async function Standing(Pool, UserId, Thresholds = DefaultThresholds) {
	const [User, Counts, Restrictions, Decisions] = await Promise.all([
		Pool.query('SELECT suspended_at FROM users WHERE id = $1', [UserId]).then(Result => Result.rows[0]),
		StrikeCounts(Pool, UserId),
		Pool.query(`SELECT id, decision_id, feature, reason, created_at, expires_at FROM moderation_restrictions WHERE user_id = $1 AND lifted_at IS NULL AND (expires_at IS NULL OR expires_at > now()) ORDER BY created_at DESC`, [UserId]).then(Result => Result.rows),
		Pool.query(`SELECT d.id, d.target_type, d.target_id, d.category, d.reason, d.content_action, d.account_action, d.feature, d.severe, d.penalty_expires_at, d.created_at, d.reversed_at, d.snapshot,
			a.status AS appeal_status, a.resolution AS appeal_resolution FROM moderation_decisions d LEFT JOIN moderation_appeals a ON a.decision_id = d.id WHERE d.owner_id = $1 ORDER BY d.id DESC LIMIT 100`, [UserId]).then(Result => Result.rows),
	]);
	const Near = Object.entries(Counts.feature).some(([, Count]) => Count >= Thresholds.feature - 1) || Object.entries(Counts.policy).some(([Policy, Count]) => Count >= (Thresholds.policy[Policy] ?? Thresholds.feature) - 1) || Counts.total >= Thresholds.total - 1;
	const State = User?.suspended_at ? 'banned' : Restrictions.length ? 'restricted' : Counts.total && Near ? 'at_risk' : 'good';
	return { state: State, strikes: Counts, thresholds: Thresholds, restrictions: Restrictions, decisions: Decisions };
}

const TargetNames = { video: 'video', comment: 'comment', user: 'account', message: 'message' };

function DecisionText(Decision, Restrictions) {
	const Policy = PolicyNames[Decision.category];
	const On = Decision.category === 'other' ? 'our Community Guidelines' : `our Community Guidelines on ${Policy}`;
	const Parts = [];
	if (Decision.account_action === 'ban') Parts.push(Decision.target_type === 'user' && Decision.content_action === 'none' && /strike limit/.test(Decision.reason) ? `Your account was permanently banned. ${Decision.reason}` : `Your account was permanently banned for violating ${On}.`);
	else {
		if (Decision.content_action === 'remove') Parts.push(`Your ${TargetNames[Decision.target_type]} was removed for violating ${On}.`);
		else if (Decision.content_action === 'fyf_ineligible') Parts.push(`Your video isn't eligible for the For You feed because it doesn't meet ${On}.`);
		else Parts.push(`Your ${TargetNames[Decision.target_type]} violated ${On}.`);
		if (Decision.account_action === 'warning') Parts.push('This is a warning. It does not count toward a ban, but future violations will.');
		if (Decision.account_action === 'strike') Parts.push('You received a strike on your account. Strikes expire after 90 days.');
	}
	for (const Restriction of Restrictions) Parts.push(`Y${RestrictionPhrase(Restriction).slice(1)}.`);
	return Parts.join(' ');
}

export async function ModerationNotices(Pool, UserId, { Before = null, After = null }, Limit) {
	const Rows = (await Pool.query(`SELECT * FROM (
		SELECT 'decision' AS kind, d.id, d.created_at AS at, d.target_type, d.category, d.reason, d.content_action, d.account_action, NULL::text AS outcome FROM moderation_decisions d WHERE d.owner_id = $1
		UNION ALL SELECT 'appeal', a.id, a.reviewed_at, d.target_type, d.category, d.reason, d.content_action, d.account_action, a.status FROM moderation_appeals a JOIN moderation_decisions d ON d.id = a.decision_id
			WHERE a.user_id = $1 AND a.reviewed_at IS NOT NULL) n
		WHERE ($2::float8 IS NULL OR n.at < to_timestamp($2)) AND ($3::float8 IS NULL OR n.at > to_timestamp($3)) ORDER BY n.at DESC LIMIT $4`, [UserId, Before, After, Limit])).rows;
	const Restrictions = (await Pool.query('SELECT decision_id, feature, expires_at FROM moderation_restrictions WHERE decision_id = ANY($1::bigint[]) ORDER BY id', [Rows.filter(Row => Row.kind === 'decision').map(Row => Row.id)])).rows;
	const Seen = (await Pool.query('SELECT moderation_seen_at FROM users WHERE id = $1', [UserId])).rows[0].moderation_seen_at;
	return Rows.map(Row => ({
		id: `${Row.kind === 'decision' ? 7 : 8}${Row.id}`, at: new Date(Row.at), read: new Date(Row.at) <= Seen,
		text: Row.kind === 'appeal'
			? Row.outcome === 'restored' ? `We reviewed your appeal and reversed our decision on your ${TargetNames[Row.target_type]}. Any strike or restriction from it was removed.` : `We reviewed your appeal and upheld our decision on your ${TargetNames[Row.target_type]}.`
			: DecisionText(Row, Restrictions.filter(Restriction => Restriction.decision_id === Row.id)),
	}));
}

export async function UnreadModerationNotices(Pool, UserId) {
	const Result = await Pool.query(`SELECT (SELECT count(*) FROM moderation_decisions d WHERE d.owner_id = u.id AND d.created_at > u.moderation_seen_at)
		+ (SELECT count(*) FROM moderation_appeals a WHERE a.user_id = u.id AND a.reviewed_at > u.moderation_seen_at) AS count FROM users u WHERE u.id = $1`, [UserId]);
	return Number(Result.rows[0]?.count ?? 0);
}

export async function MarkModerationNoticesRead(Pool, UserId) {
	await Pool.query('UPDATE users SET moderation_seen_at = now() WHERE id = $1', [UserId]);
}

const TicketSecret = randomBytes(32);
const Sign = Value => createHmac('sha256', TicketSecret).update(Value).digest('hex');
export const BanTicket = UserId => { const Value = `${UserId}.${Date.now() + 1800000}`; return `${Value}.${Sign(Value)}`; };
export function ReadBanTicket(Ticket) {
	const [UserId, Expires, Signature] = String(Ticket ?? '').split('.');
	if (!UserId || !Signature || Number(Expires) < Date.now()) return null;
	const Expected = Buffer.from(Sign(`${UserId}.${Expires}`)), Given = Buffer.from(Signature);
	return Expected.length === Given.length && timingSafeEqual(Expected, Given) ? UserId : null;
}

export async function ActiveBan(Pool, UserId) {
	return (await Pool.query("SELECT d.*, a.status AS appeal_status FROM moderation_decisions d LEFT JOIN moderation_appeals a ON a.decision_id = d.id WHERE d.owner_id = $1 AND d.account_action = 'ban' AND d.reversed_at IS NULL ORDER BY d.id DESC LIMIT 1", [UserId])).rows[0] ?? null;
}

export function BanText(Decision) {
	return DecisionText(Decision, []);
}
