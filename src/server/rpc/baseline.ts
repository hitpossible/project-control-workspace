import type { Activity, BaselineRevision, Project } from '@/lib/types';
import { AppError, type Ctx, type Row } from '../db';
import { getRow, insertRow, updateRow } from '../engine';
import { fmtD, notifyEvent } from '../logic/common';
import { recomputeProject } from '../logic/project';
import { canApproveBaseline, canManageProject, hasRole } from '../perms';

const blank = (s: unknown) => !s || String(s).trim() === '';

/** Freeze the current User Control Plan as a new baseline version (never overwrites old ones) */
async function freezeBaseline(ctx: Ctx, projectId: string, reason: string | null, approvedBy: string | null) {
  const p = (await getRow(ctx, 'projects', projectId, true)) as unknown as Project;
  const acts = await ctx.q<Activity & { pic_name: string | null }>(
    `SELECT a.*, pr.full_name pic_name FROM activities a LEFT JOIN profiles pr ON pr.id = a.pic_user_id
      WHERE a.project_id = ? AND a.status <> 'cancelled' ORDER BY a.seq`, [projectId]);
  if (!acts.length) throw new AppError('Add at least one activity before setting a baseline');
  if (acts.some((a) => !a.plan_start || !a.plan_finish)) throw new AppError('All activities need Plan Start and Plan Finish before setting a baseline');
  const n = p.baseline_version + 1;

  return ctx.asWorkflow(async () => {
    const b = await insertRow(ctx, 'project_baselines', {
      project_id: projectId, version_no: n,
      planned_start: acts.map((a) => a.plan_start!).sort()[0],
      planned_finish: acts.map((a) => a.plan_finish!).sort().at(-1),
      target_date: p.target_date, reason: blank(reason) ? 'Initial baseline' : String(reason).trim(), approved_by: approvedBy,
    });
    for (const a of acts) {
      await insertRow(ctx, 'project_baseline_items', {
        baseline_id: b.id, activity_id: a.id, seq: a.seq, activity_name: a.name, pic: a.pic_name ?? a.pic_label,
        planned_start: a.plan_start, planned_finish: a.plan_finish, is_milestone: a.is_milestone,
      });
    }
    const cur = (await getRow(ctx, 'projects', projectId)) as unknown as Project;
    await updateRow(ctx, 'projects', projectId, {
      baseline_version: n,
      status: ['draft', 'planning'].includes(cur.status) ? 'in_progress' : cur.status,
      next_action: n === 1 && cur.next_action === 'Prepare project plan and set Baseline V1' ? 'Execute plan' : cur.next_action,
    });
    await notifyEvent(ctx, {
      event: 'baseline_set', projectId, title: `Baseline V${n} set: ${p.project_code}`,
      body: `Planned finish ${fmtD(b.planned_finish as string)}`, link: `/projects/${projectId}?tab=baseline`, dedupe: `baseline:${b.id}`,
    });
    await recomputeProject(ctx, projectId);
    return b;
  });
}

/** V1 by the leader; V2+ only via an approved revision */
export async function createBaseline(ctx: Ctx, a: { p_project_id: string; p_reason?: string | null }) {
  const p = (await getRow(ctx, 'projects', a.p_project_id)) as unknown as Project | null;
  if (!p) throw new AppError('Project not found', 404);
  if (!(await canManageProject(ctx, a.p_project_id))) throw new AppError('Only the Project Leader can manage the baseline', 403);
  if (p.baseline_version > 0) throw new AppError(`Baseline V${p.baseline_version} already exists — submit a Baseline Revision request for approval`);
  return freezeBaseline(ctx, a.p_project_id, a.p_reason ?? null, null);
}

export async function requestBaselineRevision(ctx: Ctx, a: { p_project_id: string; p_reason: string; p_impact?: string | null; p_new_target?: string | null }) {
  const p = (await getRow(ctx, 'projects', a.p_project_id)) as unknown as Project | null;
  if (!p) throw new AppError('Project not found', 404);
  if (!(await canManageProject(ctx, a.p_project_id))) throw new AppError('Only the Project Leader can request a baseline revision', 403);
  if (p.baseline_version === 0) throw new AppError('Set Baseline V1 first');
  if (blank(a.p_reason)) throw new AppError('A reason is required (Rule 14)');
  if (await ctx.val(`SELECT 1 FROM baseline_revisions WHERE project_id = ? AND status = 'pending' LIMIT 1`, [a.p_project_id])) {
    throw new AppError('A baseline revision is already waiting for approval');
  }
  const snapshot = (await ctx.q<Row>(
    `SELECT id activity_id, name, plan_start, plan_finish FROM activities WHERE project_id = ? AND status <> 'cancelled' ORDER BY seq`, [a.p_project_id]));
  const r = await insertRow(ctx, 'baseline_revisions', {
    project_id: a.p_project_id, from_version: p.baseline_version, reason: a.p_reason.trim(), impact: a.p_impact ?? null,
    previous_target_date: p.target_date, proposed_target_date: a.p_new_target ?? p.target_date, plan_snapshot: snapshot,
  });
  const approvers = (await ctx.q<{ id: string }>(`SELECT id FROM profiles WHERE is_active = 1 AND JSON_CONTAINS(roles, '"manager"')`)).map((x) => x.id);
  await notifyEvent(ctx, {
    event: 'baseline_revision_requested', projectId: a.p_project_id, explicit: approvers,
    title: `Baseline revision requested: ${p.project_code} V${p.baseline_version} → V${p.baseline_version + 1}`,
    body: `Reason: ${a.p_reason}`, link: `/projects/${a.p_project_id}?tab=baseline`, dedupe: `baseline_rev:${r.id}`,
  });
  return r;
}

export async function decideBaselineRevision(ctx: Ctx, a: { p_revision_id: string; p_approve: boolean; p_comment?: string | null }) {
  let r = (await getRow(ctx, 'baseline_revisions', a.p_revision_id, true)) as unknown as BaselineRevision | null;
  if (!r) throw new AppError('Revision request not found', 404);
  if (r.status !== 'pending') throw new AppError(`Request is already ${r.status}`);
  if (!(await canApproveBaseline(ctx, r.project_id))) throw new AppError('Only a Manager / Supervisor can approve baseline revisions', 403);
  if (r.requested_by === ctx.uid && !hasRole(ctx, 'admin')) throw new AppError('You cannot approve your own request', 403);
  if (!a.p_approve && blank(a.p_comment)) throw new AppError('A comment is required to reject');
  const p = (await getRow(ctx, 'projects', r.project_id)) as unknown as Project;
  const now = new Date().toISOString();

  if (a.p_approve) {
    const proposed = r.proposed_target_date;
    if (proposed && proposed !== p.target_date) await ctx.asWorkflow(() => updateRow(ctx, 'projects', r!.project_id, { target_date: proposed }));
    const b = await freezeBaseline(ctx, r.project_id, r.reason, ctx.uid);
    r = (await updateRow(ctx, 'baseline_revisions', r.id, { status: 'approved', decided_by: ctx.uid, decided_at: now, decision_comment: a.p_comment ?? null, baseline_id: b.id })) as unknown as BaselineRevision;
  } else {
    r = (await updateRow(ctx, 'baseline_revisions', r.id, { status: 'rejected', decided_by: ctx.uid, decided_at: now, decision_comment: a.p_comment ?? null })) as unknown as BaselineRevision;
  }
  await notifyEvent(ctx, {
    event: 'baseline_revision_decided', projectId: r.project_id, explicit: [r.requested_by],
    title: `Baseline revision ${r.status}: ${p.project_code}`, body: a.p_comment ?? '',
    link: `/projects/${r.project_id}?tab=baseline`, dedupe: `baseline_rev_decided:${r.id}`,
  });
  return r;
}

export async function cancelBaselineRevision(ctx: Ctx, a: { p_revision_id: string }) {
  const r = (await getRow(ctx, 'baseline_revisions', a.p_revision_id, true)) as unknown as BaselineRevision | null;
  if (!r) throw new AppError('Revision request not found', 404);
  if (r.status !== 'pending') throw new AppError(`Request is already ${r.status}`);
  if (!(r.requested_by === ctx.uid || (await canManageProject(ctx, r.project_id)))) throw new AppError('Not allowed', 403);
  return updateRow(ctx, 'baseline_revisions', r.id, { status: 'cancelled' });
}

/** Supervisor / Manager reviews a Recovery Plan */
export async function reviewRecoveryPlan(ctx: Ctx, a: { p_activity_id: string }) {
  const act = (await getRow(ctx, 'activities', a.p_activity_id, true)) as unknown as Activity | null;
  if (!act) throw new AppError('Activity not found', 404);
  if (!(await canApproveBaseline(ctx, act.project_id))) throw new AppError('Only a Supervisor / Manager can review recovery plans', 403);
  if (blank(act.recovery_plan)) throw new AppError('There is no recovery plan to review');
  return updateRow(ctx, 'activities', act.id, { recovery_reviewed_by: ctx.uid, recovery_reviewed_at: new Date().toISOString() });
}
