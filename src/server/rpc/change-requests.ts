import type { ChangeRequest, Project } from '@/lib/types';
import { AppError, type Ctx } from '../db';
import { getRow, insertRow, updateRow } from '../engine';
import { fmtD, nextSequence, notifyEvent } from '../logic/common';
import { canApproveBaseline, canManageProject, canViewInternal, hasRole } from '../perms';
import { closureAcceptors } from './closure';

/**
 * Change Requests (scope change after the project started):
 *   submitted → assessed → agreed → approved → implemented, or rejected / withdrawn.
 * Raised by the requestor side or the team; the leader assesses the impact; the requestor agrees to it (skipped when the
 * project has no request); a Manager / Supervisor approves; the leader marks it implemented once the plan carries it.
 */
export const CR_TYPES = ['add', 'modify', 'remove'] as const;
export const CR_PRIORITIES = ['low', 'medium', 'high', 'critical'] as const;
/** still needs a decision or work — blocks closing the project */
export const OPEN_CR_STATUSES = ['submitted', 'assessed', 'agreed', 'approved'] as const;

const MAX = 4000;
const blank = (s: unknown) => s === null || s === undefined || String(s).trim() === '';
const link = (c: Pick<ChangeRequest, 'project_id' | 'id'>) => `/projects/${c.project_id}?tab=changes&cr=${c.id}`;

function text(v: unknown, label: string, { required = false, max = MAX } = {}): string | null {
  if (blank(v)) {
    if (required) throw new AppError(`${label} is required`);
    return null;
  }
  const s = String(v).trim();
  if (s.length > max) throw new AppError(`${label} is too long (max ${max} characters)`);
  return s;
}

function oneOf<T extends string>(v: unknown, list: readonly T[], label: string, fallback: T): T {
  if (blank(v)) return fallback;
  if (!(list as readonly string[]).includes(String(v))) throw new AppError(`${label} must be one of ${list.join(', ')}`);
  return String(v) as T;
}

/** Validate the leader's impact assessment */
export function parseImpact(a: { p_impact_md?: unknown; p_impact_target?: unknown; p_impact_summary?: unknown }, today: string) {
  const summary = text(a.p_impact_summary, 'Impact summary', { required: true });
  let md: number | null = null;
  if (!blank(a.p_impact_md)) {
    md = Number(a.p_impact_md);
    if (!Number.isFinite(md) || Math.abs(md) > 9999) throw new AppError('Effort must be a number of man-days');
    md = Math.round(md * 10) / 10;
  }
  let target: string | null = null;
  if (!blank(a.p_impact_target)) {
    target = String(a.p_impact_target);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(target) || Number.isNaN(Date.parse(target))) throw new AppError('New target date must be YYYY-MM-DD');
    if (target < today) throw new AppError('New target date cannot be in the past');
  }
  return { impact_md: md, impact_target: target, impact_summary: summary };
}

/** Status guard: the CR must be in one of `from` for this step */
export function assertFrom(cr: Pick<ChangeRequest, 'status' | 'cr_no'>, from: readonly string[], step: string) {
  if (!from.includes(cr.status)) throw new AppError(`${cr.cr_no} is ${cr.status.replace('_', ' ')} — it cannot be ${step} now`);
}

async function lockCr(ctx: Ctx, id: number): Promise<ChangeRequest> {
  const c = await ctx.one<ChangeRequest>('SELECT * FROM change_requests WHERE id = ? FOR UPDATE', [id]);
  if (!c) throw new AppError('Change request not found', 404);
  return c;
}

async function projectOf(ctx: Ctx, id: number): Promise<Project> {
  const p = (await getRow(ctx, 'projects', id)) as unknown as Project | null;
  if (!p) throw new AppError('Project not found', 404);
  return p;
}

const approvers = async (ctx: Ctx) =>
  (await ctx.q<{ id: number }>(`SELECT id FROM profiles WHERE is_active = 1 AND (JSON_CONTAINS(roles, '"manager"') OR JSON_CONTAINS(roles, '"supervisor"'))`)).map((x) => x.id);

export async function submitChangeRequest(ctx: Ctx, a: {
  p_project_id: number; p_title: string; p_change_type?: string; p_description: string; p_reason: string; p_priority?: string;
}) {
  const p = await projectOf(ctx, Number(a.p_project_id));
  if (['completed', 'cancelled'].includes(p.status)) throw new AppError(`The project is ${p.status} — raise a new request instead`);
  const acceptors = await closureAcceptors(ctx, p);
  if (!(acceptors.includes(ctx.uid ?? -1) || (await canViewInternal(ctx, p.id)))) throw new AppError('Only the requestor side or the project team can raise a change request', 403);
  const row = {
    project_id: p.id,
    title: text(a.p_title, 'Title', { required: true, max: 300 }),
    change_type: oneOf(a.p_change_type, CR_TYPES, 'Change type', 'add'),
    description: text(a.p_description, 'Description', { required: true }),
    reason: text(a.p_reason, 'Reason', { required: true }),
    priority: oneOf(a.p_priority, CR_PRIORITIES, 'Priority', 'medium'),
    requested_by: ctx.uid,
  };
  const cr = (await ctx.asWorkflow(async () => insertRow(ctx, 'change_requests', {
    ...row, cr_no: `CR-${String(await nextSequence(ctx, `cr:${p.id}`)).padStart(3, '0')}`,
  }))) as unknown as ChangeRequest;
  await notifyEvent(ctx, {
    event: 'cr_submitted', projectId: p.id, requestId: p.request_id, explicit: [p.leader_id],
    title: `Change request ${cr.cr_no}: ${cr.title}`, body: `${p.project_code} — assess the impact (effort, target date).`,
    link: link(cr), dedupe: `cr_submitted:${cr.id}`,
  });
  return cr;
}

/** Leader: impact (effort, new target, summary). Without a request there is nobody to agree, so it goes straight to approval. */
export async function assessChangeRequest(ctx: Ctx, a: { p_cr_id: number; p_impact_md?: number | null; p_impact_target?: string | null; p_impact_summary: string }) {
  const cr = await lockCr(ctx, Number(a.p_cr_id));
  if (!(await canManageProject(ctx, cr.project_id))) throw new AppError('Only the Project Leader can assess a change request', 403);
  assertFrom(cr, ['submitted', 'assessed'], 'assessed');
  const p = await projectOf(ctx, cr.project_id);
  const impact = parseImpact(a, ctx.today);
  const needsAgreement = (await closureAcceptors(ctx, p)).length > 0;
  const now = new Date().toISOString();
  const r = (await ctx.asWorkflow(() => updateRow(ctx, 'change_requests', cr.id, {
    ...impact, assessed_by: ctx.uid, assessed_at: now, status: needsAgreement ? 'assessed' : 'agreed',
  }))) as unknown as ChangeRequest;
  const body = [impact.impact_md !== null && `Effort ${impact.impact_md} MD`, impact.impact_target && `new target ${fmtD(impact.impact_target)}`].filter(Boolean).join(' · ');
  if (needsAgreement) {
    await notifyEvent(ctx, {
      event: 'cr_assessed', projectId: p.id, requestId: p.request_id, explicit: await closureAcceptors(ctx, p),
      title: `Please review the impact of ${r.cr_no}: ${r.title}`, body: body || impact.impact_summary, link: link(r), dedupe: `cr_assessed:${r.id}:${now}`,
    });
  } else {
    await notifyEvent(ctx, {
      event: 'cr_agreed', projectId: p.id, explicit: await approvers(ctx),
      title: `Change request waiting for approval: ${p.project_code} ${r.cr_no}`, body: body || impact.impact_summary, link: link(r), dedupe: `cr_agreed:${r.id}`,
    });
  }
  return r;
}

/** Requestor side: accept the assessed impact (→ approval) or turn it down (→ rejected) */
export async function agreeChangeRequest(ctx: Ctx, a: { p_cr_id: number; p_agree: boolean; p_comment?: string | null }) {
  const cr = await lockCr(ctx, Number(a.p_cr_id));
  assertFrom(cr, ['assessed'], 'agreed to');
  const p = await projectOf(ctx, cr.project_id);
  if (!(await closureAcceptors(ctx, p)).includes(ctx.uid ?? -1)) throw new AppError('Only the requestor (or a requestor representative) can agree to the impact', 403);
  // whoever assessed the impact cannot also agree to it for the requestor
  if (cr.assessed_by === ctx.uid) throw new AppError('You assessed this impact — the requestor (or another representative) has to agree to it', 403);
  const comment = text(a.p_comment, 'Comment');
  const now = new Date().toISOString();
  if (!a.p_agree) {
    if (!comment) throw new AppError('Say why the impact is not acceptable');
    const r = (await ctx.asWorkflow(() => updateRow(ctx, 'change_requests', cr.id, {
      status: 'rejected', decided_by: ctx.uid, decided_at: now, decision_comment: comment,
    }))) as unknown as ChangeRequest;
    await notifyEvent(ctx, {
      event: 'cr_decided', projectId: p.id, explicit: [cr.requested_by, cr.assessed_by],
      title: `Change request ${r.cr_no} turned down by the requestor`, body: comment, link: link(r), dedupe: `cr_decided:${r.id}`,
    });
    return r;
  }
  const r = (await ctx.asWorkflow(() => updateRow(ctx, 'change_requests', cr.id, {
    status: 'agreed', agreed_by: ctx.uid, agreed_at: now, decision_comment: comment,
  }))) as unknown as ChangeRequest;
  await notifyEvent(ctx, {
    event: 'cr_agreed', projectId: p.id, explicit: await approvers(ctx),
    title: `Change request waiting for approval: ${p.project_code} ${r.cr_no}`, body: r.title, link: link(r), dedupe: `cr_agreed:${r.id}`,
  });
  return r;
}

/** Manager / Supervisor: approve or reject (not their own request) */
export async function decideChangeRequest(ctx: Ctx, a: { p_cr_id: number; p_approve: boolean; p_comment?: string | null }) {
  const cr = await lockCr(ctx, Number(a.p_cr_id));
  assertFrom(cr, ['agreed'], a.p_approve ? 'approved' : 'rejected');
  if (!(await canApproveBaseline(ctx, cr.project_id))) throw new AppError('Only a Manager / Supervisor can approve change requests', 403);
  if (cr.requested_by === ctx.uid && !hasRole(ctx, 'admin')) throw new AppError('You cannot approve your own change request', 403);
  const comment = text(a.p_comment, 'Comment');
  if (!a.p_approve && !comment) throw new AppError('A comment is required to reject');
  const p = await projectOf(ctx, cr.project_id);
  const r = (await ctx.asWorkflow(() => updateRow(ctx, 'change_requests', cr.id, {
    status: a.p_approve ? 'approved' : 'rejected', decided_by: ctx.uid, decided_at: new Date().toISOString(), decision_comment: comment,
  }))) as unknown as ChangeRequest;
  await notifyEvent(ctx, {
    event: 'cr_decided', projectId: p.id, requestId: p.request_id, explicit: [cr.requested_by, cr.assessed_by, ...(await closureAcceptors(ctx, p))],
    title: `Change request ${r.cr_no} ${r.status}: ${r.title}`,
    body: a.p_approve
      ? `${p.project_code} — update the plan${r.impact_target && r.impact_target !== p.target_date ? ` and request a baseline revision (new target ${fmtD(r.impact_target)})` : ''}.`
      : comment,
    link: link(r), dedupe: `cr_decided:${r.id}`,
  });
  return r;
}

/** Leader: the plan now carries the change */
export async function implementChangeRequest(ctx: Ctx, a: { p_cr_id: number; p_note?: string | null }) {
  const cr = await lockCr(ctx, Number(a.p_cr_id));
  if (!(await canManageProject(ctx, cr.project_id))) throw new AppError('Only the Project Leader can mark a change request implemented', 403);
  assertFrom(cr, ['approved'], 'marked implemented');
  const p = await projectOf(ctx, cr.project_id);
  // a CR that moves the target is carried out by a baseline revision linked to it (once there is a baseline)
  if (cr.impact_target && cr.impact_target !== p.target_date && p.baseline_version > 0) {
    const rev = await ctx.val<string>(`SELECT status FROM baseline_revisions WHERE change_request_id = ? AND status IN ('pending','approved') ORDER BY id DESC LIMIT 1`, [cr.id]);
    if (rev === 'pending') throw new AppError('The baseline revision for this change request is still waiting for approval');
    if (!rev) throw new AppError(`${cr.cr_no} moves the target to ${fmtD(cr.impact_target)} — request a baseline revision linked to it first`);
  }
  return ctx.asWorkflow(() => updateRow(ctx, 'change_requests', cr.id, {
    status: 'implemented', implemented_at: new Date().toISOString(), implemented_note: text(a.p_note, 'Note'),
  }));
}

/** Whoever raised it, or the leader, before it is approved */
export async function withdrawChangeRequest(ctx: Ctx, a: { p_cr_id: number; p_comment?: string | null }) {
  const cr = await lockCr(ctx, Number(a.p_cr_id));
  if (!(cr.requested_by === ctx.uid || (await canManageProject(ctx, cr.project_id)))) throw new AppError('Only who raised it or the Project Leader can withdraw it', 403);
  assertFrom(cr, ['submitted', 'assessed', 'agreed'], 'withdrawn');
  return ctx.asWorkflow(() => updateRow(ctx, 'change_requests', cr.id, { status: 'withdrawn', decision_comment: text(a.p_comment, 'Comment') }));
}
