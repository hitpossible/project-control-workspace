import { AppError, type Ctx, addDays, daysBetween } from '../db';
import { updateRow } from '../engine';
import { fmtD, notifyEvent } from '../logic/common';
import { recomputeProject } from '../logic/project';
import { isStaff } from '../perms';

type RuleCfg = { escalation_days: number | null; escalate_after_days: number | null };

/** Scheduled scan: due / overdue reminders with escalation, auto Delayed, health (was run_notification_scan) */
export async function runNotificationScan(ctx: Ctx) {
  const today = ctx.today;
  const tomorrow = addDays(today, 1);
  let due = 0, over = 0, delayed = 0, fix = 0, ret = 0, evd = 0;
  const rule = async (code: string) => {
    const r = await ctx.one<RuleCfg>('SELECT escalation_days, escalate_after_days FROM notification_rules WHERE event_code = ?', [code]);
    return { every: Math.max(r?.escalation_days ?? 1, 1), after: r?.escalate_after_days ?? Infinity };
  };

  // Task due tomorrow → Owner (+ roles per rule)
  for (const t of await ctx.q<{ id: string; project_id: string; owner_id: string; task_no: string; name: string; due_date: string; project_code: string }>(
    `SELECT it.id, it.project_id, it.owner_id, it.task_no, it.name, it.due_date, p.project_code FROM internal_tasks it JOIN projects p ON p.id = it.project_id
      WHERE it.due_date = ? AND it.status NOT IN ('completed','cancelled') AND p.status NOT IN ('completed','cancelled','on_hold')`, [tomorrow])) {
    due += await notifyEvent(ctx, {
      event: 'task_due_tomorrow', projectId: t.project_id, explicit: [t.owner_id], title: `Due tomorrow: ${t.task_no} ${t.name}`,
      body: `Project ${t.project_code}`, link: `/projects/${t.project_id}?tab=internal&task=${t.id}`, dedupe: `task_due_tomorrow:${t.id}:${t.due_date}`,
    });
  }

  // Task overdue → repeat every escalation_days; escalate after N days
  const tr = await rule('task_overdue');
  for (const t of await ctx.q<{ id: string; project_id: string; owner_id: string; task_no: string; name: string; due_date: string; project_code: string }>(
    `SELECT it.id, it.project_id, it.owner_id, it.task_no, it.name, it.due_date, p.project_code FROM internal_tasks it JOIN projects p ON p.id = it.project_id
      WHERE it.due_date < ? AND it.status NOT IN ('completed','cancelled') AND p.status NOT IN ('completed','cancelled','on_hold')`, [today])) {
    const days = daysBetween(t.due_date, today);
    over += await notifyEvent(ctx, {
      event: 'task_overdue', projectId: t.project_id, explicit: [t.owner_id], title: `Overdue ${days} day(s): ${t.task_no} ${t.name}`,
      body: `Project ${t.project_code} — due ${fmtD(t.due_date)}`, link: `/projects/${t.project_id}?tab=internal&task=${t.id}`,
      dedupe: `task_overdue:${t.id}:${Math.floor((days - 1) / tr.every)}`, escalate: days >= tr.after,
    });
  }

  // Fix due tomorrow → Developer (+ Supervisor)
  type B = { id: string; project_id: string; assigned_dev_id: string | null; supervisor_id: string | null; bug_no: string; title: string; severity: string; due_date: string; project_code: string };
  for (const b of await ctx.q<B>(
    `SELECT b.id, b.project_id, b.assigned_dev_id, b.supervisor_id, b.bug_no, b.title, b.severity, b.due_date, p.project_code
       FROM bugs b JOIN projects p ON p.id = b.project_id WHERE b.due_date = ? AND b.status IN ('assigned','in_progress','reopened')`, [tomorrow])) {
    fix += await notifyEvent(ctx, {
      event: 'fix_due_tomorrow', projectId: b.project_id, explicit: [b.assigned_dev_id, b.supervisor_id],
      title: `Fix due tomorrow: ${b.bug_no} ${b.title} [${b.severity.toUpperCase()}]`, body: `Project ${b.project_code}`,
      link: `/projects/${b.project_id}?tab=qa&bug=${b.id}`, dedupe: `fix_due_tomorrow:${b.id}:${b.due_date}`,
    });
  }

  // Fix overdue → repeat by escalation rule; escalate to Manager after N days
  const fr = await rule('fix_overdue');
  for (const b of await ctx.q<B>(
    `SELECT b.id, b.project_id, b.assigned_dev_id, b.supervisor_id, b.bug_no, b.title, b.severity, b.due_date, p.project_code
       FROM bugs b JOIN projects p ON p.id = b.project_id WHERE b.due_date < ? AND b.status IN ('assigned','in_progress','reopened')`, [today])) {
    const days = daysBetween(b.due_date, today);
    fix += await notifyEvent(ctx, {
      event: 'fix_overdue', projectId: b.project_id, explicit: [b.assigned_dev_id, b.supervisor_id],
      title: `Fix overdue ${days} day(s): ${b.bug_no} ${b.title} [${b.severity.toUpperCase()}]`,
      body: `Project ${b.project_code} — fix was due ${fmtD(b.due_date)}`, link: `/projects/${b.project_id}?tab=qa&bug=${b.id}`,
      dedupe: `fix_overdue:${b.id}:${Math.floor((days - 1) / fr.every)}`, escalate: days >= fr.after,
    });
  }

  // Retest due (tomorrow / overdue) → Tester
  for (const r of await ctx.q<{ id: string; project_id: string; bug_id: string; tester_id: string | null; due_date: string; bug_no: string; title: string; project_code: string }>(
    `SELECT r.id, r.project_id, r.bug_id, r.tester_id, r.due_date, b.bug_no, b.title, p.project_code FROM retests r
       JOIN bugs b ON b.id = r.bug_id JOIN projects p ON p.id = r.project_id WHERE r.status = 'pending' AND r.due_date <= ?`, [tomorrow])) {
    ret += await notifyEvent(ctx, {
      event: 'retest_due', projectId: r.project_id, explicit: [r.tester_id],
      title: `Retest ${r.due_date < today ? 'overdue' : 'due'}: ${r.bug_no} ${r.title}`, body: `Project ${r.project_code} — due ${fmtD(r.due_date)}`,
      link: `/projects/${r.project_id}?tab=qa&bug=${r.bug_id}`, dedupe: `retest_due:${r.id}:${today}`,
    });
  }

  // Evidence missing → Owner / PIC (activity / task due within 2 days or done-but-blocked); repeats every 3 days
  const soon = addDays(today, 2);
  for (const e of await ctx.q<{ id: string; project_id: string; name: string; owner: string | null; item: string; project_code: string }>(
    `SELECT r.id, r.project_id, r.name, COALESCE(ea.pic_user_id, et.owner_id, ep.leader_id) owner,
            COALESCE(ea.name, et.name, ep.project_name) item, ep.project_code
       FROM evidence_requirements r
       JOIN projects ep ON ep.id = r.project_id
       LEFT JOIN activities ea ON r.entity_type = 'activity' AND ea.id = r.entity_id
       LEFT JOIN internal_tasks et ON r.entity_type = 'task' AND et.id = r.entity_id
      WHERE r.is_mandatory = 1 AND ep.status NOT IN ('completed','cancelled','planning','draft')
        AND NOT EXISTS (SELECT 1 FROM evidence x WHERE x.requirement_id = r.id AND x.verification_status <> 'rejected')
        AND ((ea.id IS NOT NULL AND ea.status <> 'cancelled' AND (ea.plan_finish <= ? OR ea.progress >= 100))
          OR (et.id IS NOT NULL AND et.status <> 'cancelled' AND (et.due_date <= ? OR et.progress >= 100)))`, [soon, soon])) {
    evd += await notifyEvent(ctx, {
      event: 'evidence_missing', projectId: e.project_id, explicit: [e.owner], title: `Evidence missing: ${e.name} — ${e.item}`,
      body: `Project ${e.project_code}`, link: `/projects/${e.project_id}?tab=evidence`,
      dedupe: `evidence_missing:${e.id}:${Math.floor(daysBetween('2026-01-01', today) / 3)}`,
    });
  }

  // Overdue activities become Delayed (triggers activity_delayed notification)
  await ctx.asWorkflow(async () => {
    for (const a of await ctx.q<{ id: string }>(
      `SELECT ac.id FROM activities ac JOIN projects p ON p.id = ac.project_id
        WHERE ac.plan_finish < ? AND ac.status IN ('not_started','in_progress','at_risk')
          AND p.status NOT IN ('completed','cancelled','on_hold','planning','draft')`, [today])) {
      await updateRow(ctx, 'activities', a.id, { status: 'delayed' });
      delayed++;
    }
    for (const p of await ctx.q<{ id: string }>(`SELECT id FROM projects WHERE status NOT IN ('completed','cancelled')`)) {
      await recomputeProject(ctx, p.id);
    }
  });

  return { due_tomorrow: due, overdue: over, activities_delayed: delayed, fix, retest: ret, evidence_missing: evd, ran_at: new Date().toISOString() };
}

/** Scan can be triggered by system staff from the UI */
export async function triggerNotificationScan(ctx: Ctx) {
  if (!isStaff(ctx)) throw new AppError('Not allowed', 403);
  return runNotificationScan(ctx);
}
