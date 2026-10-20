import { Transaction } from './db.mjs';
import { HttpError, Id } from './http.mjs';

export const PolicyCategories = ['spam', 'harassment', 'hate', 'nudity', 'violence', 'self_harm', 'misinformation', 'impersonation', 'copyright', 'other'];
export const RemovedSql = (Type, Target) => `EXISTS (SELECT 1 FROM moderation_decisions md WHERE md.target_type = '${Type}' AND md.target_id = ${Target} AND md.content_action = 'remove' AND md.reversed_at IS NULL)`;
export const BannedSql = Owner => `EXISTS (SELECT 1 FROM moderation_decisions mb WHERE mb.owner_id = ${Owner} AND mb.account_action = 'ban' AND mb.reversed_at IS NULL AND (mb.penalty_expires_at IS NULL OR mb.penalty_expires_at > now()))`;

export async function AssertAllowed(Pool, User, Feature = 'account') {
	if (!User) return;
	const Match = { posting: 'restrict_posting', comments: 'restrict_comments' }[Feature] ?? 'ban';
	const Active = await Pool.query(`SELECT account_action FROM moderation_decisions WHERE owner_id=$1 AND account_action IN ('ban', $2) AND reversed_at IS NULL AND (penalty_expires_at IS NULL OR penalty_expires_at > now()) LIMIT 1`, [User.id, Match]);
	if (Active.rowCount) throw new HttpError(403, Active.rows[0].account_action === 'ban' ? 'AccountBanned' : Feature === 'posting' ? 'PostingRestricted' : 'CommentsRestricted');
}

export async function DecideReport(Pool, Moderator, ReportId, Body) {
	const Verdict = Body.verdict;
	const Content = Body.content_action ?? 'none', Account = Body.account_action ?? 'none';
	const Reason = String(Body.reason ?? '').trim(), Category = String(Body.category ?? '');
	const Days = Body.duration_days === 'permanent' ? null : Number(Body.duration_days);
	if (!['no_violation', 'violation'].includes(Verdict)) throw new HttpError(400, 'InvalidDecision');
	if (!PolicyCategories.includes(Category) || !Reason || Reason.length > 1000) throw new HttpError(400, 'InvalidReason');
	if (!['none', 'remove', 'fyf_ineligible'].includes(Content) || !['none', 'warning', 'strike', 'restrict_posting', 'restrict_comments', 'ban'].includes(Account)) throw new HttpError(400, 'InvalidDecision');
	if (Verdict === 'no_violation' && (Content !== 'none' || Account !== 'none') || Verdict === 'violation' && Content === 'none' && Account === 'none') throw new HttpError(400, 'InvalidDecision');
	if (['restrict_posting', 'restrict_comments', 'ban'].includes(Account) && (Days === null ? Account !== 'ban' : ![1, 3, 7, 14, 30].includes(Days))) throw new HttpError(400, 'InvalidDuration');
	return Transaction(Pool, async Client => {
		const Report = (await Client.query('SELECT * FROM reports WHERE id=$1', [Id(ReportId)])).rows[0];
		if (!Report) throw new HttpError(404, 'ReportNotFound');
		await Client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`moderation:${Report.target_type}:${Report.target_id}`]);
		const Current = (await Client.query('SELECT status FROM reports WHERE id=$1 FOR UPDATE', [Report.id])).rows[0];
		if (Current.status !== 'open') throw new HttpError(409, 'ReportAlreadyReviewed');
		const Owner = (await Client.query('SELECT id, role, username FROM users WHERE id=$1', [Report.owner_id])).rows[0];
		if (Verdict === 'violation' && (!Owner || Owner.id === Moderator.id || Owner.role === 'admin')) throw new HttpError(400, 'CannotModerateAdmin');
		if (Content === 'fyf_ineligible' && Report.target_type !== 'video' || Content === 'remove' && Report.target_type === 'user') throw new HttpError(400, 'InvalidDecision');
		const Target = (await Client.query({ video: 'SELECT description AS text, cover_name, file_name FROM videos WHERE id=$1', comment: 'SELECT body AS text, video_id FROM comments WHERE id=$1', user: 'SELECT display_name AS text, username FROM users WHERE id=$1' }[Report.target_type], [Report.target_id])).rows[0];
		if (Content !== 'none' && !Target) throw new HttpError(404, 'ReportTargetNotFound');
		let Decision;
		if (Verdict === 'violation') {
			const Duration = Account === 'strike' ? 90 : ['restrict_posting', 'restrict_comments', 'ban'].includes(Account) ? Days : null;
			Decision = (await Client.query(`INSERT INTO moderation_decisions(owner_id,moderator_id,target_type,target_id,category,reason,content_action,account_action,penalty_expires_at,snapshot)
				VALUES ($1,$2,$3,$4,$5,$6,$7,$8,CASE WHEN $9::int IS NULL THEN NULL ELSE now()+make_interval(days=>$9) END,$10) RETURNING *`, [Owner.id, Moderator.id, Report.target_type, Report.target_id, Category, Reason, Content, Account, Duration, JSON.stringify(Target ?? {})])).rows[0];
		}
		const Closed = await Client.query(`UPDATE reports SET status=$3,resolved_by=$4,resolved_at=now(),resolution=$5,decision_id=$6 WHERE target_type=$1 AND target_id=$2 AND status='open' RETURNING id`, [Report.target_type, Report.target_id, Verdict === 'violation' ? 'resolved' : 'dismissed', Moderator.id, Reason, Decision?.id ?? null]);
		await Client.query('INSERT INTO admin_actions(admin_id,action,target,detail) VALUES ($1,$2,$3,$4)', [Moderator.id, 'report.decision', `${Report.target_type} ${Report.target_id}`, `${Verdict}; ${Content}; ${Account}; ${Category}: ${Reason}`]);
		return { decision: Decision ?? null, closed: Closed.rowCount };
	});
}

export async function ReviewAppeal(Pool, Moderator, AppealId, Outcome, Reason) {
	if (!['restored', 'upheld'].includes(Outcome) || typeof Reason !== 'string' || !Reason.trim() || Reason.length > 1000) throw new HttpError(400, 'InvalidDecision');
	return Transaction(Pool, async Client => {
		const Appeal = (await Client.query('SELECT * FROM moderation_appeals WHERE id=$1 FOR UPDATE', [Id(AppealId)])).rows[0];
		if (!Appeal) throw new HttpError(404, 'AppealNotFound');
		if (Appeal.status !== 'pending') throw new HttpError(409, 'AppealAlreadyReviewed');
		if (Appeal.user_id === Moderator.id) throw new HttpError(403, 'CannotReviewOwnAppeal');
		await Client.query('UPDATE moderation_appeals SET status=$2,resolution=$3,reviewer_id=$4,reviewed_at=now() WHERE id=$1', [Appeal.id, Outcome, Reason.trim(), Moderator.id]);
		if (Outcome === 'restored') await Client.query('UPDATE moderation_decisions SET reversed_at=now(),reversed_by=$2 WHERE id=$1 AND reversed_at IS NULL', [Appeal.decision_id, Moderator.id]);
		await Client.query('INSERT INTO admin_actions(admin_id,action,target,detail) VALUES ($1,$2,$3,$4)', [Moderator.id, `appeal.${Outcome}`, Appeal.id, Reason.trim()]);
		return { ok: true };
	});
}
