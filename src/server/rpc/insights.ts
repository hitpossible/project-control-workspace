import type { Activity, Insight, InsightRule, Project } from '@/lib/types';
import { type Ctx, addDays, dateOf, daysBetween, inList } from '../db';
import { fmtD } from '../logic/common';
import { activityIsOverdue, blank } from '../logic/project';
import { isStaff, visibleProjectIds } from '../perms';

type Found = Omit<Insight, 'severity' | 'link'> & { lnk: string };
const SEV_ORDER = { critical: 0, warning: 1, info: 2 } as const;
const words = (s: string) => s.replaceAll('_', ' ');

/** Smart Insight (§22) — rule based, thresholds from insight_rules */
export async function smartInsights(ctx: Ctx, a: { p_project_id?: string | null }): Promise<Insight[]> {
  const projectId = a.p_project_id ?? null;
  const staff = isStaff(ctx);
  const today = ctx.today;
  const rules = new Map((await ctx.q<InsightRule>('SELECT * FROM insight_rules')).map((r) => [r.code, r]));
  const th = (code: string, d: number) => rules.get(code)?.threshold ?? d;

  const vis = await visibleProjectIds(ctx);
  const where: string[] = [`status NOT IN ('completed','cancelled')`];
  const params: unknown[] = [];
  if (projectId) { where.push('id = ?'); params.push(projectId); }
  if (vis !== null) { const [ph, p] = inList(vis); where.push(`id IN (${ph})`); params.push(...p); }
  const pj = await ctx.q<Project>(`SELECT * FROM projects WHERE ${where.join(' AND ')}`, params);
  const found: Found[] = [];
  const add = (p: Pick<Project, 'id' | 'project_code'>, rule_code: string, title: string, detail: string, entity_type: string, entity_id: string, lnk = '') =>
    found.push({ project_id: p.id, project_code: p.project_code, rule_code, title, detail, entity_type, entity_id, lnk });

  if (pj.length) {
    const [ph, ids] = inList(pj.map((p) => p.id));
    const byId = new Map(pj.map((p) => [p.id, p]));
    const acts = await ctx.q<Activity>(`SELECT * FROM activities WHERE project_id IN (${ph}) AND status <> 'cancelled' ORDER BY seq`, ids);
    const bl = new Map((await ctx.q<{ project_id: string; planned_finish: string | null }>(
      `SELECT b.project_id, b.planned_finish FROM project_baselines b
        WHERE b.project_id IN (${ph}) AND b.version_no = (SELECT MAX(x.version_no) FROM project_baselines x WHERE x.project_id = b.project_id)`, ids))
      .map((b) => [b.project_id, b.planned_finish]));

    // project level
    for (const p of pj) {
      if (!p.target_date) add(p, 'no_target_date', 'No target date', 'Project has no target date — set one to track due date and forecast.', 'project', p.id);
      if (!p.leader_id) add(p, 'no_leader', 'No Project Leader', 'Assign a Project Leader to take ownership.', 'project', p.id);
      if (blank(p.next_action)) add(p, 'no_next_action', 'No next action', 'Project has no Next Action — management cannot see what happens next.', 'project', p.id);
      const idle = daysBetween(dateOf(p.updated_at)!, today);
      if (['waiting', 'on_hold'].includes(p.status) && idle > th('waiting_too_long', 7)) {
        add(p, 'waiting_too_long', 'Project waiting too long', `Project ${words(p.status)} for ${idle} day(s).`, 'project', p.id);
      }
      const age = daysBetween(dateOf(p.created_at)!, today);
      if (p.baseline_version === 0 && age > th('no_baseline', 14)) {
        add(p, 'no_baseline', 'No baseline', `Project created ${age} day(s) ago and Baseline V1 is not set.`, 'project', p.id, '?tab=baseline');
      }
      if (p.baseline_version - 1 > th('too_many_reschedules', 2)) {
        add(p, 'too_many_reschedules', 'Rescheduled many times', `Baseline revised ${p.baseline_version - 1} time(s) (V${p.baseline_version}).`, 'project', p.id, '?tab=baseline');
      }
      const base = bl.get(p.id);
      if (base && p.forecast_date) {
        const over = daysBetween(base, p.forecast_date);
        if (over > th('forecast_vs_baseline', 0)) {
          const noRecovery = acts.some((x) => x.project_id === p.id && activityIsOverdue(x, today) && blank(x.recovery_plan));
          add(p, 'forecast_vs_baseline',
            noRecovery ? 'Forecast exceeds baseline — no Recovery Plan' : 'Forecast exceeds baseline',
            noRecovery
              ? `Forecast finish exceeds baseline by ${over} day(s) and no Recovery Plan has been provided.`
              : `Forecast finish ${fmtD(p.forecast_date, false)} exceeds baseline ${fmtD(base, false)} by ${over} day(s).`,
            'project', p.id, '?tab=baseline');
        }
      }
    }

    // activity level
    const waitingSince = new Map<string, string>();
    const waitingActs = acts.filter((x) => x.status === 'waiting');
    if (waitingActs.length) {
      const [wph, wids] = inList(waitingActs.map((x) => x.id));
      for (const l of await ctx.q<{ entity_id: string; at: string }>(
        `SELECT entity_id, MAX(created_at) at FROM audit_logs WHERE entity_id IN (${wph}) AND field = 'status' AND new_value = 'waiting' GROUP BY entity_id`, wids)) {
        waitingSince.set(l.entity_id, dateOf(l.at)!);
      }
    }
    for (const x of acts) {
      const p = byId.get(x.project_id)!;
      const overdue = activityIsOverdue(x, today);
      const idle = daysBetween(dateOf(x.updated_at)!, today);
      if (overdue) {
        add(p, 'activity_overdue', `Activity overdue: ${x.name}`,
          `Plan finish ${fmtD(x.plan_finish, false)} — ${daysBetween(x.plan_finish!, today)} day(s) overdue, progress ${Math.round(Number(x.progress))}%.`, 'activity', x.id, '?tab=plan');
      }
      if ((x.status === 'delayed' || overdue) && blank(x.recovery_plan)) {
        add(p, 'delay_no_recovery', `No recovery plan: ${x.name}`, `Activity is ${overdue ? 'overdue' : 'delayed'} without a Recovery Plan (Rule 15).`, 'activity', x.id, '?tab=plan');
      }
      if (!blank(x.recovery_plan) && !x.recovery_reviewed_by && x.status !== 'completed' && idle >= th('recovery_not_reviewed', 3)) {
        add(p, 'recovery_not_reviewed', `Recovery plan awaiting review: ${x.name}`, 'Supervisor / Manager has not reviewed the recovery plan yet.', 'activity', x.id, '?tab=plan');
      }
      if (x.status === 'waiting') {
        const days = daysBetween(waitingSince.get(x.id) ?? dateOf(x.updated_at)!, today);
        if (days > th('waiting_too_long', 7)) {
          add(p, 'waiting_too_long', `Waiting too long: ${x.name}`, `Activity waiting for ${days} day(s)${x.status_note ? ` — ${x.status_note}` : ''}.`, 'activity', x.id, '?tab=plan');
        }
      }
      if (['in_progress', 'at_risk'].includes(x.status) && idle > th('progress_stale', 7)) {
        add(p, 'progress_stale', `Progress not updated: ${x.name}`, `No update for ${idle} day(s) (progress ${Math.round(Number(x.progress))}%).`, 'activity', x.id, '?tab=plan');
      }
      if (['in_progress', 'delayed', 'at_risk'].includes(x.status) && blank(x.next_action)) {
        add(p, 'no_next_action', `No next action: ${x.name}`, 'In-progress activity without Next Action.', 'activity', x.id, '?tab=plan');
      }
    }

    // mandatory evidence missing on finished / overdue items (grouped per project)
    const miss = await ctx.q<{ project_id: string; name: string }>(
      `SELECT x.project_id, x.name FROM evidence_requirements x
         LEFT JOIN activities ea ON x.entity_type = 'activity' AND ea.id = x.entity_id
         LEFT JOIN internal_tasks et ON x.entity_type = 'task' AND et.id = x.entity_id
        WHERE x.project_id IN (${ph}) AND x.is_mandatory = 1
          AND NOT EXISTS (SELECT 1 FROM evidence e WHERE e.requirement_id = x.id AND e.verification_status <> 'rejected')
          AND ((ea.id IS NOT NULL AND ea.status <> 'cancelled' AND (ea.progress >= 100 OR ea.plan_finish < ?))
            OR (et.id IS NOT NULL AND et.status <> 'cancelled' AND (et.progress >= 100 OR et.due_date < ?)))`, [...ids, today, today]);
    const missBy = new Map<string, string[]>();
    for (const m of miss) missBy.set(m.project_id, [...(missBy.get(m.project_id) ?? []), m.name]);
    for (const [pid, names] of missBy) {
      add(byId.get(pid)!, 'evidence_missing', `Mandatory evidence missing (${names.length})`, `Missing: ${names.sort().join(', ')}`, 'project', pid, '?tab=evidence');
    }

    // internal (QA / people)
    if (staff) {
      const name = new Map((await ctx.q<{ id: string; full_name: string }>('SELECT id, full_name FROM profiles')).map((u) => [u.id, u.full_name]));
      for (const b of await ctx.q<{ id: string; project_id: string; bug_no: string; title: string; status: string; severity: string; assigned_dev_id: string | null; due_date: string | null }>(
        `SELECT id, project_id, bug_no, title, status, severity, assigned_dev_id, due_date FROM bugs WHERE project_id IN (${ph}) AND status NOT IN ('closed','cancelled') ORDER BY bug_no`, ids)) {
        const p = byId.get(b.project_id)!;
        if (b.severity === 'critical') {
          add(p, 'critical_bug_open', `Critical bug open: ${b.bug_no}`,
            `${b.title} — ${words(b.status)}, developer ${b.assigned_dev_id ? name.get(b.assigned_dev_id) ?? 'not assigned' : 'not assigned'}.`, 'bug', b.id, `?tab=qa&bug=${b.id}`);
        }
        if (['assigned', 'in_progress', 'reopened'].includes(b.status) && b.due_date && b.due_date < today) {
          add(p, 'fix_overdue', `Bug fix overdue: ${b.bug_no}`, `${b.title} — due ${fmtD(b.due_date, false)} (${daysBetween(b.due_date, today)} day(s) late).`, 'bug', b.id, `?tab=qa&bug=${b.id}`);
        }
      }
      for (const r of await ctx.q<{ project_id: string; tester_id: string | null; due_date: string; bug_id: string; bug_no: string }>(
        `SELECT r.project_id, r.tester_id, r.due_date, b.id bug_id, b.bug_no FROM retests r JOIN bugs b ON b.id = r.bug_id
          WHERE r.project_id IN (${ph}) AND r.status = 'pending' AND r.due_date < ?`, [...ids, today])) {
        add(byId.get(r.project_id)!, 'retest_overdue', `Retest overdue: ${r.bug_no}`,
          `Waiting for ${(r.tester_id && name.get(r.tester_id)) || 'QA'} since ${fmtD(r.due_date, false)}.`, 'bug', r.bug_id, `?tab=qa&bug=${r.bug_id}`);
      }
      for (const t of await ctx.q<{ id: string; project_id: string; task_no: string; name: string; due_date: string; owner_name: string }>(
        `SELECT t.id, t.project_id, t.task_no, t.name, t.due_date, pr.full_name owner_name FROM internal_tasks t JOIN profiles pr ON pr.id = t.owner_id
          WHERE t.project_id IN (${ph}) AND t.status NOT IN ('completed','cancelled') AND t.due_date BETWEEN ? AND ?
            AND EXISTS (SELECT 1 FROM workforce_plans w WHERE w.user_id = t.owner_id AND w.work_date = t.due_date AND w.work_type = 'leave')`,
        [...ids, today, addDays(today, th('owner_on_leave', 14))])) {
        add(byId.get(t.project_id)!, 'owner_on_leave', `Owner on leave on due date: ${t.task_no} ${t.name}`,
          `${t.owner_name} has planned leave on ${fmtD(t.due_date, false)}.`, 'task', t.id, `?tab=internal&task=${t.id}`);
      }
    }
  }

  const out: Insight[] = [];
  for (const f of found) {
    const r = rules.get(f.rule_code);
    if (!r || !r.is_active || (r.internal && !staff)) continue;
    const { lnk, ...rest } = f;
    out.push({ ...rest, severity: r.severity as Insight['severity'], link: `/projects/${f.project_id}${lnk}` });
  }

  // team level: overloaded members (no project)
  const ov = rules.get('member_overloaded');
  if (!projectId && staff && ov?.is_active) {
    for (const u of await ctx.q<{ id: string; full_name: string; tasks: number; bugs: number }>(
      `SELECT pr.id, pr.full_name,
              (SELECT COUNT(*) FROM internal_tasks t JOIN projects p ON p.id = t.project_id
                WHERE t.owner_id = pr.id AND t.status NOT IN ('completed','cancelled') AND p.status NOT IN ('completed','cancelled')) tasks,
              (SELECT COUNT(*) FROM bugs b WHERE b.assigned_dev_id = pr.id AND b.status NOT IN ('closed','cancelled')) bugs
         FROM profiles pr WHERE pr.is_active = 1`)) {
      if (Number(u.tasks) + Number(u.bugs) > (ov.threshold ?? 8)) {
        out.push({ project_id: null, project_code: null, rule_code: 'member_overloaded', severity: ov.severity as Insight['severity'],
          title: `Overloaded: ${u.full_name}`, detail: `${u.tasks} open task(s) + ${u.bugs} open bug(s).`, entity_type: 'person', entity_id: u.id, link: '/my-tasks?scope=all' });
      }
    }
  }

  return out.sort((x, y) => SEV_ORDER[x.severity] - SEV_ORDER[y.severity]
    || (x.project_code === null ? 1 : y.project_code === null ? -1 : x.project_code.localeCompare(y.project_code)));
}
