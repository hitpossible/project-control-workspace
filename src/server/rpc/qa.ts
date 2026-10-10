import type { Bug, BugFix, Retest } from '@/lib/types';
import { AppError, type Ctx, addDays } from '../db';
import { getRow, insertRow, updateRow } from '../engine';
import { fmtD, nextSequence, notifyEvent } from '../logic/common';
import { recomputeProject } from '../logic/project';
import { canManageProject, canQa, canTriageBug, canViewInternal } from '../perms';

const blank = (s: unknown) => !s || String(s).trim() === '';
const SLA: Record<string, number> = { critical: 1, high: 3, medium: 5 };
const slaDays = (severity: string) => SLA[severity] ?? 10;
const bugLink = (b: Pick<Bug, 'project_id' | 'id'>) => `/projects/${b.project_id}?tab=qa&bug=${b.id}`;

async function lockBug(ctx: Ctx, id: string): Promise<Bug> {
  const b = await getRow(ctx, 'bugs', id, true);
  if (!b) throw new AppError('Bug not found', 404);
  return b as unknown as Bug;
}

export async function reportBug(ctx: Ctx, a: {
  p_project_id: string; p_title: string; p_description?: string | null; p_severity?: string | null; p_priority?: string | null;
  p_test_round_id?: string | null; p_activity_id?: string | null; p_task_id?: string | null; p_steps?: string | null;
  p_expected?: string | null; p_actual?: string | null; p_assigned_dev_id?: string | null; p_due_date?: string | null;
}) {
  if (!(await canViewInternal(ctx, a.p_project_id))) throw new AppError('Not allowed to report bugs in this project', 403);
  if (blank(a.p_title)) throw new AppError('Bug title is required');
  const code = await ctx.val<string>('SELECT project_code FROM projects WHERE id = ?', [a.p_project_id]);
  const sup = await ctx.val<string>(`SELECT user_id FROM project_members WHERE project_id = ? AND member_role = 'supervisor' ORDER BY created_at LIMIT 1`, [a.p_project_id]);
  const severity = a.p_severity ?? 'medium';
  const activity = a.p_activity_id ?? (a.p_test_round_id ? await ctx.val<string>('SELECT activity_id FROM test_rounds WHERE id = ?', [a.p_test_round_id]) : null);

  return ctx.asWorkflow(async () => {
    const b = (await insertRow(ctx, 'bugs', {
      bug_no: `BUG-${String(await nextSequence(ctx, `bug:${a.p_project_id}`)).padStart(4, '0')}`,
      project_id: a.p_project_id, test_round_id: a.p_test_round_id ?? null, activity_id: activity, task_id: a.p_task_id ?? null,
      title: a.p_title.trim(), description: a.p_description ?? null, steps_to_reproduce: a.p_steps ?? null,
      expected_result: a.p_expected ?? null, actual_result: a.p_actual ?? null, severity, priority: a.p_priority ?? severity,
      reporter_id: ctx.uid, assigned_dev_id: a.p_assigned_dev_id ?? null, supervisor_id: sup,
      due_date: a.p_due_date ?? addDays(ctx.today, slaDays(severity)), status: a.p_assigned_dev_id ? 'assigned' : 'new',
    })) as unknown as Bug;
    await notifyEvent(ctx, {
      event: 'bug_reported', projectId: b.project_id, explicit: [b.assigned_dev_id, b.supervisor_id],
      title: `Bug reported: ${b.bug_no} ${b.title} [${b.severity.toUpperCase()}]`, body: `Project ${code} — due ${fmtD(b.due_date)}`,
      link: bugLink(b), dedupe: `bug_reported:${b.id}`,
    });
    await recomputeProject(ctx, b.project_id);
    return b;
  });
}

export async function assignBug(ctx: Ctx, a: { p_bug_id: string; p_dev_id: string | null; p_due_date?: string | null }) {
  let b = await lockBug(ctx, a.p_bug_id);
  if (!(await canTriageBug(ctx, b))) throw new AppError('Only QA, the Project Leader or Supervisor can assign bugs', 403);
  if (['closed', 'cancelled'].includes(b.status)) throw new AppError(`Bug ${b.bug_no} is ${b.status}`);
  if (!a.p_dev_id) throw new AppError('Choose a developer');
  return ctx.asWorkflow(async () => {
    b = (await updateRow(ctx, 'bugs', b.id, {
      assigned_dev_id: a.p_dev_id, due_date: a.p_due_date ?? b.due_date, status: b.status === 'new' ? 'assigned' : b.status,
    })) as unknown as Bug;
    for (const f of await ctx.q<{ id: string }>(`SELECT id FROM bug_fixes WHERE bug_id = ? AND status = 'in_progress'`, [b.id])) {
      await updateRow(ctx, 'bug_fixes', f.id, { fix_owner_id: a.p_dev_id });
    }
    await notifyEvent(ctx, {
      event: 'bug_assigned', projectId: b.project_id, explicit: [a.p_dev_id],
      title: `Bug assigned to you: ${b.bug_no} ${b.title} [${b.severity.toUpperCase()}]`, body: `Fix due ${fmtD(b.due_date)}`,
      link: bugLink(b), dedupe: `bug_assigned:${b.id}:${a.p_dev_id}`,
    });
    return b;
  });
}

export async function startFix(ctx: Ctx, a: { p_bug_id: string }) {
  const b = await lockBug(ctx, a.p_bug_id);
  if (!(b.assigned_dev_id === ctx.uid || (await canManageProject(ctx, b.project_id)))) throw new AppError('Only the assigned developer can start the fix', 403);
  if (!b.assigned_dev_id) throw new AppError('Assign a developer first');
  if (!['assigned', 'reopened', 'new'].includes(b.status)) throw new AppError(`Fix cannot start from status ${b.status}`);
  return ctx.asWorkflow(async () => {
    const cycle = Number(await ctx.val('SELECT COALESCE(MAX(fix_cycle), 0) + 1 FROM bug_fixes WHERE bug_id = ?', [b.id]));
    const f = await insertRow(ctx, 'bug_fixes', {
      bug_id: b.id, project_id: b.project_id, fix_cycle: cycle, fix_owner_id: b.assigned_dev_id, fix_start_date: ctx.today, fix_due_date: b.due_date,
    });
    await updateRow(ctx, 'bugs', b.id, { status: 'in_progress' });
    return f;
  });
}

/** Developer: Fix Ready → creates a Retest and notifies QA / Tester (Rule 8, AC-013) */
export async function markFixReady(ctx: Ctx, a: {
  p_fix_id: string; p_description: string; p_unit_test_result?: string | null; p_technical_note?: string | null;
  p_build_link?: string | null; p_commit_link?: string | null; p_tester_id?: string | null;
}) {
  const f = (await getRow(ctx, 'bug_fixes', a.p_fix_id, true)) as unknown as BugFix | null;
  if (!f) throw new AppError('Fix not found', 404);
  const b = await lockBug(ctx, f.bug_id);
  if (!(f.fix_owner_id === ctx.uid || b.assigned_dev_id === ctx.uid || (await canManageProject(ctx, b.project_id)))) {
    throw new AppError('Only the fix owner can mark Fix Ready', 403);
  }
  if (f.status !== 'in_progress' || b.status !== 'in_progress') throw new AppError('Fix is not in progress');
  if (blank(a.p_description)) throw new AppError('Describe the fix before marking Fix Ready');

  const reporterIsQa = b.reporter_id
    ? await ctx.val(`SELECT 1 FROM profiles WHERE id = ? AND JSON_CONTAINS(roles, '"qa"')`, [b.reporter_id]) : null;
  const tester = a.p_tester_id
    ?? (reporterIsQa ? b.reporter_id : null)
    ?? await ctx.val<string>(`SELECT user_id FROM project_members WHERE project_id = ? AND member_role = 'qa' ORDER BY created_at LIMIT 1`, [b.project_id])
    ?? b.reporter_id;

  return ctx.asWorkflow(async () => {
    await updateRow(ctx, 'bug_fixes', f.id, {
      status: 'ready', fix_ready_at: new Date().toISOString(), fix_description: a.p_description,
      unit_test_result: a.p_unit_test_result ?? f.unit_test_result, technical_note: a.p_technical_note ?? f.technical_note,
      build_link: a.p_build_link ?? f.build_link, commit_link: a.p_commit_link ?? f.commit_link,
    });
    await updateRow(ctx, 'bugs', b.id, { status: 'fix_ready' });
    const round = Number(await ctx.val('SELECT COALESCE(MAX(retest_round), 0) + 1 FROM retests WHERE bug_id = ?', [b.id]));
    const t = (await insertRow(ctx, 'retests', {
      bug_id: b.id, project_id: b.project_id, fix_id: f.id, retest_round: round, tester_id: tester, due_date: addDays(ctx.today, 2),
    })) as unknown as Retest;
    await notifyEvent(ctx, {
      event: 'fix_ready', projectId: b.project_id, explicit: [tester],
      title: `Fix ready for retest: ${b.bug_no} ${b.title}`, body: `Fix cycle ${f.fix_cycle} — retest due ${fmtD(t.due_date)}`,
      link: bugLink(b), dedupe: `fix_ready:${f.id}`,
    });
    return t;
  });
}

/** QA: Retest → Passed closes the bug (Rule 7); otherwise Reopen (AC-014) */
export async function recordRetest(ctx: Ctx, a: { p_retest_id: string; p_result: string; p_comment?: string | null }) {
  const t = (await getRow(ctx, 'retests', a.p_retest_id, true)) as unknown as Retest | null;
  if (!t) throw new AppError('Retest not found', 404);
  let b = await lockBug(ctx, t.bug_id);
  if (!(t.tester_id === ctx.uid || (await canQa(ctx, b.project_id)))) throw new AppError('Only QA / Tester can record a retest', 403);
  if (t.status !== 'pending') throw new AppError('Retest already recorded');
  if (!['passed', 'failed', 'partially_passed', 'blocked'].includes(a.p_result)) throw new AppError(`Invalid result ${a.p_result}`);
  if (a.p_result !== 'passed' && blank(a.p_comment)) throw new AppError('A comment is required when the retest does not pass');

  return ctx.asWorkflow(async () => {
    const now = new Date().toISOString();
    await updateRow(ctx, 'retests', t.id, { status: 'done', result: a.p_result, comment: a.p_comment ?? null, tested_at: now, tester_id: t.tester_id ?? ctx.uid });
    if (a.p_result === 'passed') {
      if (t.fix_id) await updateRow(ctx, 'bug_fixes', t.fix_id, { status: 'verified' });
      b = (await updateRow(ctx, 'bugs', b.id, { status: 'closed', closed_at: now })) as unknown as Bug;
      await notifyEvent(ctx, {
        event: 'bug_closed', projectId: b.project_id, explicit: [b.assigned_dev_id, b.reporter_id],
        title: `Bug closed: ${b.bug_no} ${b.title}`, body: 'Retest passed', link: bugLink(b), dedupe: `bug_closed:${b.id}`,
      });
    } else {
      if (t.fix_id) await updateRow(ctx, 'bug_fixes', t.fix_id, { status: 'failed' });
      const base = b.due_date && b.due_date > ctx.today ? b.due_date : ctx.today;
      b = (await updateRow(ctx, 'bugs', b.id, { status: 'reopened', reopen_count: b.reopen_count + 1, due_date: addDays(base, slaDays(b.severity)) })) as unknown as Bug;
      await notifyEvent(ctx, {
        event: 'retest_failed', projectId: b.project_id, explicit: [b.assigned_dev_id],
        title: `Retest ${a.p_result.replaceAll('_', ' ')} — bug reopened: ${b.bug_no} ${b.title}`, body: a.p_comment ?? null,
        link: bugLink(b), dedupe: `retest_failed:${t.id}`,
      });
    }
    await recomputeProject(ctx, b.project_id);
    return b;
  });
}

export async function cancelBug(ctx: Ctx, a: { p_bug_id: string; p_reason: string }) {
  let b = await lockBug(ctx, a.p_bug_id);
  if (!(await canTriageBug(ctx, b))) throw new AppError('Not allowed', 403);
  if (['closed', 'cancelled'].includes(b.status)) throw new AppError(`Bug is already ${b.status}`);
  if (blank(a.p_reason)) throw new AppError('A reason is required');
  return ctx.asWorkflow(async () => {
    for (const r of await ctx.q<{ id: string }>(`SELECT id FROM retests WHERE bug_id = ? AND status = 'pending'`, [b.id])) {
      await updateRow(ctx, 'retests', r.id, { status: 'cancelled' });
    }
    for (const f of await ctx.q<{ id: string }>(`SELECT id FROM bug_fixes WHERE bug_id = ? AND status IN ('in_progress','ready')`, [b.id])) {
      await updateRow(ctx, 'bug_fixes', f.id, { status: 'failed' });
    }
    b = (await updateRow(ctx, 'bugs', b.id, { status: 'cancelled', cancel_reason: a.p_reason, closed_at: new Date().toISOString() })) as unknown as Bug;
    await recomputeProject(ctx, b.project_id);
    return b;
  });
}
