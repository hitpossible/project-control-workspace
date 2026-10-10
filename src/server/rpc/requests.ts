import type { ApprovalStep, ProjectRequest } from '@/lib/types';
import { AppError, type Ctx, type Row, addDays } from '../db';
import { getRow, insertRow, updateRow } from '../engine';
import { generateCode, notifyEvent, settingValue } from '../logic/common';
import { recomputeProject } from '../logic/project';
import { hasRole, invalidatePerms } from '../perms';

const blank = (s: unknown) => !s || String(s).trim() === '';

const STATUS_FOR_STEP: Record<string, ProjectRequest['status']> = {
  requestor_approval: 'waiting_requestor_approval',
  system_review: 'waiting_system_review',
  authority_approval: 'waiting_authority_approval',
};

async function notifyStepWaiting(ctx: Ctx, step: ApprovalStep) {
  const r = (await getRow(ctx, 'project_requests', step.request_id)) as unknown as ProjectRequest;
  const users = step.approver_id
    ? [step.approver_id]
    : (await ctx.q<{ id: string }>('SELECT id FROM profiles WHERE is_active = 1 AND JSON_CONTAINS(roles, JSON_QUOTE(?))', [step.approver_role])).map((p) => p.id);
  await notifyEvent(ctx, {
    event: 'approval_waiting', requestId: r.id, explicit: users,
    title: `Approval required: ${r.request_no}`, body: `${step.step_name} — ${r.project_name}`,
    link: `/requests/${r.id}`, dedupe: `approval_waiting:${step.id}`,
  });
}

async function lockRequest(ctx: Ctx, id: string): Promise<ProjectRequest> {
  const r = await getRow(ctx, 'project_requests', id, true);
  if (!r) throw new AppError('Request not found', 404);
  return r as unknown as ProjectRequest;
}

export async function submitRequest(ctx: Ctx, a: { p_request_id: string }) {
  let r = await lockRequest(ctx, a.p_request_id);
  if (r.requestor_id !== ctx.uid) throw new AppError('Only the requestor can submit this request', 403);
  if (!['draft', 'need_more_information'].includes(r.status)) throw new AppError(`Request cannot be submitted from status ${r.status}`);

  const missing: string[] = [];
  if (blank(r.project_name)) missing.push('Project Name');
  if (blank(r.description)) missing.push('Brief Description');
  if (blank(r.reason)) missing.push('Reason for Request');
  if (!r.date_required) missing.push('Date Required');
  if (!r.requestor_approver_id) missing.push('Requestor Approver');
  if (blank(r.req_full_name)) missing.push('Requestor Name');
  if (blank(r.req_department)) missing.push('Department');
  if (missing.length) throw new AppError(`Missing required fields: ${missing.join(', ')}`);

  return ctx.asWorkflow(async () => {
    // Resume after "Request More Information": same step goes back to waiting
    if (r.status === 'need_more_information') {
      const s = await ctx.one<ApprovalStep>(`SELECT * FROM approval_steps WHERE request_id = ? AND status = 'more_info' LIMIT 1`, [r.id]);
      if (s) {
        const step = (await updateRow(ctx, 'approval_steps', s.id, { status: 'waiting', action: null, acted_at: null, acted_by: null })) as unknown as ApprovalStep;
        r = (await updateRow(ctx, 'project_requests', r.id, { status: STATUS_FOR_STEP[step.step_code] })) as unknown as ProjectRequest;
        await insertRow(ctx, 'approval_actions', { request_id: r.id, step_id: step.id, step_code: step.step_code, action: 'resubmit', comment: 'Information provided' });
        await notifyStepWaiting(ctx, step);
        return r;
      }
    }

    const cycle = Number(await ctx.val('SELECT COALESCE(MAX(cycle), 0) + 1 FROM approval_steps WHERE request_id = ?', [r.id]));
    await ctx.exec(`UPDATE approval_steps SET status = 'cancelled' WHERE request_id = ? AND status IN ('pending','waiting')`, [r.id]);
    const steps: Row[] = [
      { step_no: 1, step_code: 'requestor_approval', step_name: 'Requestor Approval', approver_id: r.requestor_approver_id, approver_role: 'requestor_approver', status: 'waiting' },
      { step_no: 2, step_code: 'system_review', step_name: 'System Service Review', approver_id: null, approver_role: 'system_reviewer', status: 'pending' },
      { step_no: 3, step_code: 'authority_approval', step_name: 'Authority Approval', approver_id: r.authority_approver_id, approver_role: 'authority_approver', status: 'pending' },
    ];
    let first: ApprovalStep | null = null;
    for (const s of steps) {
      const row = (await insertRow(ctx, 'approval_steps', { request_id: r.id, cycle, ...s })) as unknown as ApprovalStep;
      first ??= row;
    }
    r = (await updateRow(ctx, 'project_requests', r.id, {
      request_no: r.request_no ?? await generateCode(ctx, await settingValue(ctx, 'request_no_format', 'REQ-SYS-{YYYY}-{SEQ:4}'), null),
      date_submitted: ctx.today,
      submitted_at: new Date().toISOString(),
      status: 'waiting_requestor_approval',
    })) as unknown as ProjectRequest;
    await insertRow(ctx, 'approval_actions', { request_id: r.id, action: cycle === 1 ? 'submit' : 'resubmit', comment: null });
    await notifyStepWaiting(ctx, first!);
    return r;
  });
}

/** System Service Review data (only while the review step is waiting) */
export async function saveReview(ctx: Ctx, a: {
  p_request_id: string; p_project_type_id: number | null; p_template_id: number | null;
  p_proposed_leader_id: string | null; p_authority_approver_id: string | null; p_scope_assessment: string | null;
}) {
  if (!hasRole(ctx, 'system_reviewer')) throw new AppError('Only System Service Reviewer can review requests', 403);
  const waiting = await ctx.val(`SELECT 1 FROM approval_steps WHERE request_id = ? AND step_code = 'system_review' AND status = 'waiting' LIMIT 1`, [a.p_request_id]);
  if (!waiting) throw new AppError('Request is not waiting for System Service Review');
  return ctx.asWorkflow(async () => {
    const r = await updateRow(ctx, 'project_requests', a.p_request_id, {
      project_type_id: a.p_project_type_id, template_id: a.p_template_id, proposed_leader_id: a.p_proposed_leader_id,
      authority_approver_id: a.p_authority_approver_id, scope_assessment: a.p_scope_assessment, reviewed_by: ctx.uid,
    });
    // keep authority step approver in sync
    await ctx.exec(`UPDATE approval_steps SET approver_id = ? WHERE request_id = ? AND step_code = 'authority_approval' AND status = 'pending'`,
      [a.p_authority_approver_id, a.p_request_id]);
    return r;
  });
}

export async function actOnApproval(ctx: Ctx, a: { p_step_id: string; p_action: string; p_comment?: string | null }) {
  const s = (await getRow(ctx, 'approval_steps', a.p_step_id, true)) as unknown as ApprovalStep | null;
  if (!s) throw new AppError('Approval step not found', 404);
  let r = await lockRequest(ctx, s.request_id);

  // Validate status before update (never skip approval)
  if (s.status !== 'waiting') throw new AppError(`This step is not waiting for action (status: ${s.status})`);
  if (r.status !== STATUS_FOR_STEP[s.step_code]) throw new AppError(`Request status ${r.status} does not match step ${s.step_code}`);
  if (s.approver_id && s.approver_id !== ctx.uid) throw new AppError('You are not the assigned approver for this step', 403);
  if (!s.approver_id && !ctx.me?.roles.includes(s.approver_role as never)) throw new AppError(`You need role ${s.approver_role} to act on this step`, 403);
  if (!['approve', 'reject', 'send_back', 'request_more_info'].includes(a.p_action)) throw new AppError(`Unsupported action ${a.p_action}`);
  if (a.p_action !== 'approve' && blank(a.p_comment)) throw new AppError(`A comment is required for ${a.p_action.replaceAll('_', ' ')}`);
  if (a.p_action === 'approve' && s.step_code === 'system_review' && (!r.project_type_id || !r.proposed_leader_id || !r.authority_approver_id)) {
    throw new AppError('Complete the review (Project Type, Project Leader, Authority Approver) before approving');
  }

  return ctx.asWorkflow(async () => {
    const stepStatus = { approve: 'approved', reject: 'rejected', send_back: 'sent_back', request_more_info: 'more_info' }[a.p_action];
    await updateRow(ctx, 'approval_steps', s.id, { status: stepStatus, action: a.p_action, comment: a.p_comment ?? null, acted_by: ctx.uid, acted_at: new Date().toISOString() });
    await insertRow(ctx, 'approval_actions', { request_id: r.id, step_id: s.id, step_code: s.step_code, action: a.p_action, comment: a.p_comment ?? null });

    if (a.p_action === 'approve') {
      const next = await ctx.one<ApprovalStep>(
        `SELECT * FROM approval_steps WHERE request_id = ? AND cycle = ? AND step_no > ? AND status = 'pending' ORDER BY step_no LIMIT 1`, [r.id, s.cycle, s.step_no]);
      if (next) {
        const patch: Row = { status: 'waiting' };
        if (next.step_code === 'authority_approval') patch.approver_id = r.authority_approver_id;
        const step = (await updateRow(ctx, 'approval_steps', next.id, patch)) as unknown as ApprovalStep;
        r = (await updateRow(ctx, 'project_requests', r.id, { status: STATUS_FOR_STEP[step.step_code] })) as unknown as ProjectRequest;
        await notifyStepWaiting(ctx, step);
      } else {
        r = (await updateRow(ctx, 'project_requests', r.id, { status: 'approved' })) as unknown as ProjectRequest;
        await notifyEvent(ctx, {
          event: 'request_approved', requestId: r.id, explicit: [r.requestor_id, r.proposed_leader_id, r.reviewed_by],
          title: `Request approved: ${r.request_no}`, body: `${r.project_name} is approved and ready to convert to a Controlled Project.`,
          link: `/requests/${r.id}`, dedupe: `request_approved:${r.id}`,
        });
      }
    } else {
      const status = a.p_action === 'reject' ? 'rejected' : a.p_action === 'send_back' ? 'draft' : 'need_more_information';
      r = (await updateRow(ctx, 'project_requests', r.id, { status })) as unknown as ProjectRequest;
      if (a.p_action === 'send_back' || a.p_action === 'reject') {
        await ctx.exec(`UPDATE approval_steps SET status = 'cancelled' WHERE request_id = ? AND cycle = ? AND status = 'pending'`, [r.id, s.cycle]);
      }
      const label = a.p_action === 'reject' ? 'Request rejected' : a.p_action === 'send_back' ? 'Request sent back' : 'More information requested';
      await notifyEvent(ctx, {
        event: `request_${a.p_action}`, requestId: r.id, explicit: [r.requestor_id],
        title: `${label}: ${r.request_no}`, body: `${s.step_name} — ${a.p_comment}`, link: `/requests/${r.id}`,
      });
    }
    return r;
  });
}

export async function cancelRequest(ctx: Ctx, a: { p_request_id: string; p_comment?: string | null }) {
  const r = await lockRequest(ctx, a.p_request_id);
  if (r.requestor_id !== ctx.uid && !hasRole(ctx, 'admin')) throw new AppError('Only the requestor can cancel', 403);
  if (!['draft', 'need_more_information', 'waiting_requestor_approval'].includes(r.status)) throw new AppError(`Request cannot be cancelled from status ${r.status}`);
  return ctx.asWorkflow(async () => {
    await ctx.exec(`UPDATE approval_steps SET status = 'cancelled' WHERE request_id = ? AND status IN ('pending','waiting','more_info')`, [r.id]);
    const out = await updateRow(ctx, 'project_requests', r.id, { status: 'cancelled' });
    await insertRow(ctx, 'approval_actions', { request_id: r.id, action: 'cancel', comment: a.p_comment ?? null });
    return out;
  });
}

type TplActivity = { name: string; pic_label?: string; duration_days?: number; is_milestone?: boolean; tasks?: { name: string; task_type?: string; duration_days?: number }[] };

/** Convert approved request → Controlled Project */
export async function convertRequestToProject(ctx: Ctx, a: { p_request_id: string; p_start_date: string; p_target_date: string; p_sponsor?: string | null }) {
  const r = await lockRequest(ctx, a.p_request_id);
  // Business rule 1: only approved requests can be converted
  if (r.status !== 'approved') throw new AppError(`Only approved requests can be converted (status: ${r.status})`);
  if (!(hasRole(ctx, 'system_reviewer') || r.proposed_leader_id === ctx.uid)) {
    throw new AppError('Only System Service Reviewer or the assigned Project Leader can convert', 403);
  }
  if (!a.p_start_date || !a.p_target_date || a.p_target_date < a.p_start_date) throw new AppError('Valid start and target dates are required');

  return ctx.asWorkflow(async () => {
    const type = await ctx.val<string>('SELECT code FROM project_types WHERE id = ?', [r.project_type_id]);
    const p = await insertRow(ctx, 'projects', {
      project_code: await generateCode(ctx, await settingValue(ctx, 'project_code_format', 'SYS-{TYPE}-{YYYY}-{SEQ:3}'), type),
      project_name: r.project_name, project_type_id: r.project_type_id, template_id: r.template_id, request_id: r.id,
      leader_id: r.proposed_leader_id, sponsor: a.p_sponsor ?? null, department: r.req_department, priority: r.priority,
      start_date: a.p_start_date, target_date: a.p_target_date, status: 'planning', next_action: 'Prepare project plan and set Baseline V1',
    });
    const pid = String(p.id);

    // Project Team
    const addMember = async (userId: string | null, role: string) => {
      if (userId && !(await ctx.val('SELECT 1 FROM project_members WHERE project_id = ? AND user_id = ? AND member_role = ?', [pid, userId, role]))) {
        await insertRow(ctx, 'project_members', { project_id: pid, user_id: userId, member_role: role });
      }
    };
    await addMember(r.proposed_leader_id, 'leader');
    await addMember(r.requestor_id, 'requestor_rep');
    invalidatePerms(ctx);

    // Default activities from template, scheduled sequentially from start date
    if (r.template_id) {
      const tpl = await ctx.one<{ default_activities: TplActivity[] }>('SELECT default_activities FROM project_templates WHERE id = ?', [r.template_id]);
      let cursor = a.p_start_date;
      let seq = 0;
      for (const act of tpl?.default_activities ?? []) {
        seq++;
        const astart = cursor;
        cursor = addDays(astart, Math.max(act.duration_days ?? 1, 1) - 1);
        const pic = act.pic_label ?? 'System';
        const created = await insertRow(ctx, 'activities', {
          project_id: pid, seq, name: act.name, pic_label: pic, pic_user_id: pic === 'System' ? r.proposed_leader_id : null,
          plan_start: astart, plan_finish: cursor, is_milestone: act.is_milestone ?? false,
        });
        let tcursor = astart;
        let tseq = 0;
        for (const t of act.tasks ?? []) {
          tseq++;
          const dur = Math.max(t.duration_days ?? 1, 1);
          const due = addDays(tcursor, dur - 1) < cursor ? addDays(tcursor, dur - 1) : cursor;
          await insertRow(ctx, 'internal_tasks', {
            project_id: pid, activity_id: created.id, seq: tseq, name: t.name, task_type: t.task_type ?? 'dev',
            owner_id: r.proposed_leader_id, planned_start: tcursor, due_date: due,
          });
          tcursor = addDays(tcursor, dur) < cursor ? addDays(tcursor, dur) : cursor;
        }
        cursor = addDays(cursor, 1);
      }
    }

    await updateRow(ctx, 'project_requests', r.id, { status: 'converted', project_id: pid });
    await insertRow(ctx, 'approval_actions', { request_id: r.id, action: 'convert', comment: p.project_code });
    await notifyEvent(ctx, {
      event: 'project_converted', projectId: pid, requestId: r.id, explicit: [r.requestor_id, r.proposed_leader_id],
      title: `Project created: ${p.project_code}`, body: `${p.project_name} has been converted to a Controlled Project.`,
      link: `/projects/${pid}`, dedupe: `project_converted:${pid}`,
    });
    await recomputeProject(ctx, pid);
    return getRow(ctx, 'projects', pid);
  });
}
