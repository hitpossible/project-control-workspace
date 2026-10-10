import type { KpiIndividual, KpiProject, KpiTeam } from '@/lib/types';
import { AppError, type Ctx, dateOf, daysBetween, inList, uuid } from '../db';
import { settingValue } from '../logic/common';
import { canViewKpiAll, canViewInternal, hasRole, isStaff, visibleProjectIds } from '../perms';

const round1 = (v: number) => Math.round(v * 10) / 10;
const pct = (n: number, d: number) => (d > 0 ? round1((100 * n) / d) : null);
const avg = (xs: number[]) => (xs.length ? round1(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
const between = (d: string | null | undefined, from: string, to: string) => !!d && d >= from && d <= to;
const hours = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 86400000;

function group<T, K>(rows: T[], key: (r: T) => K): Map<K, T[]> {
  const m = new Map<K, T[]>();
  for (const r of rows) m.set(key(r), [...(m.get(key(r)) ?? []), r]);
  return m;
}

/** Days spent in 'waiting' (activities) from the audit trail, per project */
export async function projectWaitingDays(ctx: Ctx, projectIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>(projectIds.map((id) => [id, 0]));
  if (!projectIds.length) return out;
  const [ph, params] = inList(projectIds);
  const logs = await ctx.q<{ project_id: string; entity_id: string; created_at: string; new_value: string | null }>(
    `SELECT project_id, entity_id, created_at, new_value FROM audit_logs
      WHERE project_id IN (${ph}) AND table_name = 'activities' AND field = 'status' ORDER BY entity_id, created_at, id`, params);
  const now = new Date().toISOString();
  for (const [, ev] of group(logs, (l) => l.entity_id)) {
    ev.forEach((e, i) => {
      if (e.new_value !== 'waiting') return;
      const end = ev[i + 1]?.created_at ?? now;
      out.set(e.project_id, (out.get(e.project_id) ?? 0) + hours(e.created_at, end));
    });
  }
  for (const [k, v] of out) out.set(k, round1(v));
  return out;
}

// ---------------------------------------------------------------------
// Project KPI (§23.1)
// ---------------------------------------------------------------------
export async function kpiProjects(ctx: Ctx): Promise<KpiProject[]> {
  const vis = await visibleProjectIds(ctx);
  const [ph, params] = vis === null ? ['', []] : inList(vis);
  const projects = await ctx.q<KpiProject & { id: string; baseline_version: number }>(
    `SELECT p.id, p.project_code, p.project_name, l.full_name leader_name, p.status, p.health, p.progress, p.start_date, p.target_date,
            p.forecast_date, p.baseline_version,
            (SELECT b.planned_finish FROM project_baselines b WHERE b.project_id = p.id ORDER BY b.version_no DESC LIMIT 1) baseline_finish,
            (SELECT b.target_date FROM project_baselines b WHERE b.project_id = p.id ORDER BY b.version_no LIMIT 1) first_target,
            (SELECT MAX(a.actual_finish) FROM activities a WHERE a.project_id = p.id AND a.status <> 'cancelled') last_finish
       FROM projects p LEFT JOIN profiles l ON l.id = p.leader_id
      ${vis === null ? '' : `WHERE p.id IN (${ph})`}
      ORDER BY p.project_code`, params);
  const ids = projects.map((p) => p.id);
  if (!ids.length) return [];
  const [iph, ip] = inList(ids);
  const today = ctx.today;

  const tasks = group(await ctx.q<{ project_id: string; status: string; due_date: string; actual_finish: string | null }>(
    `SELECT project_id, status, due_date, actual_finish FROM internal_tasks WHERE project_id IN (${iph}) AND status <> 'cancelled'`, ip), (t) => t.project_id);
  const reqs = group(await ctx.q<{ project_id: string; done: number }>(
    `SELECT r.project_id, EXISTS (SELECT 1 FROM evidence e WHERE e.requirement_id = r.id AND e.verification_status <> 'rejected') done
       FROM evidence_requirements r WHERE r.project_id IN (${iph}) AND r.is_mandatory = 1`, ip), (r) => r.project_id);
  const bugs = group(await ctx.q<{ project_id: string; status: string }>(`SELECT project_id, status FROM bugs WHERE project_id IN (${iph})`, ip), (b) => b.project_id);
  const rts = group(await ctx.q<{ project_id: string; status: string; result: string | null }>(
    `SELECT project_id, status, result FROM retests WHERE project_id IN (${iph})`, ip), (r) => r.project_id);
  const waiting = await projectWaitingDays(ctx, ids);

  const out: KpiProject[] = [];
  for (const p of projects) {
    const internal = await canViewInternal(ctx, p.id);
    const tk = tasks.get(p.id) ?? [];
    const done = tk.filter((t) => t.status === 'completed');
    const onTime = done.filter((t) => t.actual_finish && t.actual_finish <= t.due_date).length;
    const ev = reqs.get(p.id) ?? [];
    const evDone = ev.filter((r) => Number(r.done) === 1).length;
    const bg = bugs.get(p.id) ?? [];
    const bTotal = bg.filter((b) => b.status !== 'cancelled').length;
    const bClosed = bg.filter((b) => b.status === 'closed').length;
    const rt = rts.get(p.id) ?? [];
    const rDone = rt.filter((r) => r.status === 'done').length;
    const row = p as unknown as { first_target: string | null; last_finish: string | null };
    const completed = p.status === 'completed';
    out.push({
      project_id: p.id, project_code: p.project_code, project_name: p.project_name, leader_name: p.leader_name, status: p.status, health: p.health,
      progress: p.progress, start_date: p.start_date, target_date: p.target_date, forecast_date: p.forecast_date, baseline_finish: p.baseline_finish,
      schedule_variance: p.baseline_finish && p.forecast_date ? daysBetween(p.baseline_finish, p.forecast_date) : null,
      completed_on: completed ? row.last_finish : null,
      on_time: completed && row.last_finish && (row.first_target ?? p.target_date) ? row.last_finish <= (row.first_target ?? p.target_date)! : null,
      reschedules: Math.max(p.baseline_version - 1, 0),
      waiting_days: waiting.get(p.id) ?? 0,
      tasks_total: internal ? tk.length : null,
      tasks_completed: internal ? done.length : null,
      tasks_on_time_rate: internal && done.length > 0 ? pct(onTime, done.length) : null,
      overdue_tasks: internal ? tk.filter((t) => t.status !== 'completed' && t.due_date < today).length : null,
      evidence_total: ev.length, evidence_done: evDone, evidence_completion: pct(evDone, ev.length),
      bugs_total: bTotal, bugs_closed: bClosed, bug_closure_rate: pct(bClosed, bTotal),
      open_bugs: bg.filter((b) => !['closed', 'cancelled'].includes(b.status)).length,
      retests_done: rDone, retest_pass_rate: pct(rt.filter((r) => r.result === 'passed').length, rDone),
    });
  }
  return out;
}

// ---------------------------------------------------------------------
// Team KPI (§23.2) for a period
// ---------------------------------------------------------------------
export async function kpiTeam(ctx: Ctx, a: { p_from: string; p_to: string }): Promise<KpiTeam> {
  if (!(isStaff(ctx) || hasRole(ctx, 'management_view'))) throw new AppError('Team KPI is available to System Service and Management only', 403);
  const { p_from: from, p_to: to } = a;
  const internal = isStaff(ctx);
  const kp = await kpiProjects(ctx);
  const active = kp.filter((p) => (p.start_date ?? ctx.today) <= to && (!['completed', 'cancelled'].includes(p.status) || between(p.completed_on, from, to)));
  const done = kp.filter((p) => p.status === 'completed' && between(p.completed_on, from, to));
  const tasks = internal ? await ctx.q<{ due_date: string; actual_finish: string }>(
    `SELECT due_date, actual_finish FROM internal_tasks WHERE status = 'completed' AND actual_finish BETWEEN ? AND ?`, [from, to]) : [];
  const bugs = await ctx.q<{ status: string; created_at: string; closed_at: string | null }>('SELECT status, created_at, closed_at FROM bugs');
  const bugsClosed = bugs.filter((b) => b.status === 'closed' && between(dateOf(b.closed_at), from, to));
  const rts = (await ctx.q<{ result: string | null; tested_at: string | null }>(`SELECT result, tested_at FROM retests WHERE status = 'done'`))
    .filter((r) => between(dateOf(r.tested_at), from, to));
  const evTotal = active.reduce((s, p) => s + p.evidence_total, 0);
  const evDone = active.reduce((s, p) => s + p.evidence_done, 0);

  return {
    total_projects: active.length,
    completed_projects: done.length,
    on_time_rate: pct(done.filter((p) => p.on_time).length, done.length),
    delayed_projects: active.filter((p) => p.status === 'delayed').length,
    at_risk_projects: active.filter((p) => p.status === 'at_risk').length,
    avg_schedule_variance: avg(active.filter((p) => p.schedule_variance !== null).map((p) => p.schedule_variance!)),
    avg_waiting_days: avg(active.map((p) => p.waiting_days)),
    overdue_tasks: internal ? Number(await ctx.val(
      `SELECT COUNT(*) FROM internal_tasks t JOIN projects p ON p.id = t.project_id
        WHERE t.status NOT IN ('completed','cancelled') AND t.due_date < ? AND p.status NOT IN ('completed','cancelled')`, [ctx.today])) : null,
    evidence_completion_rate: pct(evDone, evTotal),
    tasks_completed: internal ? tasks.length : null,
    task_on_time_rate: internal ? pct(tasks.filter((t) => t.actual_finish <= t.due_date).length, tasks.length) : null,
    bugs_reported: bugs.filter((b) => between(dateOf(b.created_at), from, to)).length,
    bugs_closed: bugsClosed.length,
    avg_bug_resolution_days: avg(bugsClosed.map((b) => hours(b.created_at, b.closed_at!))),
    retest_pass_rate: pct(rts.filter((r) => r.result === 'passed').length, rts.length),
  };
}

// ---------------------------------------------------------------------
// Individual KPI (§23.3) — own row only unless Leader / Supervisor / Manager / Admin.
// Late tasks with excluded delay categories (Waiting User, Vendor…) are excused.
// ---------------------------------------------------------------------
export async function kpiIndividual(ctx: Ctx, a: { p_from: string; p_to: string }): Promise<KpiIndividual[]> {
  const { p_from: from, p_to: to } = a;
  const excluded = await settingValue<string[]>(ctx, 'kpi_excluded_delay_categories', []);
  const all = canViewKpiAll(ctx);
  const people = (await ctx.q<{ id: string; full_name: string; roles: string[] }>('SELECT id, full_name, roles FROM profiles WHERE is_active = 1 ORDER BY full_name'))
    .filter((p) => p.roles.some((r) => ['developer', 'qa', 'project_leader', 'support'].includes(r)) && (all || p.id === ctx.uid));
  if (!people.length) return [];

  type T = { owner_id: string; status: string; due_date: string; actual_finish: string | null; delay_category: string | null };
  const tasks = group(await ctx.q<T>(
    `SELECT t.owner_id, t.status, t.due_date, t.actual_finish, t.delay_category FROM internal_tasks t JOIN projects p ON p.id = t.project_id
      WHERE p.status <> 'cancelled' AND t.status <> 'cancelled'`), (t) => t.owner_id);
  const bugs = group(await ctx.q<{ assigned_dev_id: string; created_at: string }>('SELECT assigned_dev_id, created_at FROM bugs WHERE assigned_dev_id IS NOT NULL'), (b) => b.assigned_dev_id);
  const fixes = group(await ctx.q<{ fix_owner_id: string; bug_id: string; fix_cycle: number; status: string; fix_ready_at: string | null; created_at: string }>(
    'SELECT fix_owner_id, bug_id, fix_cycle, status, fix_ready_at, created_at FROM bug_fixes'), (f) => f.fix_owner_id);
  const evid = group(await ctx.q<{ owner_id: string; done: number }>(
    `SELECT it.owner_id, EXISTS (SELECT 1 FROM evidence e WHERE e.requirement_id = r.id AND e.verification_status <> 'rejected') done
       FROM evidence_requirements r JOIN internal_tasks it ON r.entity_type = 'task' AND it.id = r.entity_id WHERE r.is_mandatory = 1`), (r) => r.owner_id);
  const rts = group(await ctx.q<{ tester_id: string; tested_at: string | null; created_at: string }>(
    `SELECT tester_id, tested_at, created_at FROM retests WHERE status = 'done' AND tester_id IS NOT NULL`), (r) => r.tester_id);

  return people.map((pe) => {
    const t = tasks.get(pe.id) ?? [];
    const excused = (x: T) => !!x.delay_category && excluded.includes(x.delay_category);
    const comp = t.filter((x) => x.status === 'completed' && between(x.actual_finish, from, to));
    const late = comp.filter((x) => x.actual_finish! > x.due_date);
    const counted = comp.filter((x) => !(x.actual_finish! > x.due_date && excused(x)));
    const fx = (fixes.get(pe.id) ?? []).filter((f) => between(dateOf(f.fix_ready_at), from, to));
    const decided = fx.filter((f) => ['verified', 'failed'].includes(f.status));
    const ev = evid.get(pe.id) ?? [];
    const rt = (rts.get(pe.id) ?? []).filter((r) => between(dateOf(r.tested_at), from, to));
    return {
      user_id: pe.id, full_name: pe.full_name, roles: pe.roles,
      assigned_tasks: t.filter((x) => between(x.due_date, from, to)).length,
      completed_tasks: comp.length,
      on_time_tasks: comp.filter((x) => x.actual_finish! <= x.due_date).length,
      late_tasks: late.filter((x) => !excused(x)).length,
      excused_late: late.filter(excused).length,
      on_time_rate: pct(comp.filter((x) => x.actual_finish! <= x.due_date).length, counted.length),
      avg_delay_days: avg(late.filter((x) => !excused(x)).map((x) => daysBetween(x.due_date, x.actual_finish!))),
      overdue_tasks: t.filter((x) => x.status !== 'completed' && x.due_date < ctx.today && !excused(x)).length,
      open_tasks: t.filter((x) => x.status !== 'completed').length,
      bugs_assigned: (bugs.get(pe.id) ?? []).filter((b) => between(dateOf(b.created_at), from, to)).length,
      fixes_ready: fx.length,
      avg_fix_days: avg(fx.map((f) => hours(f.created_at, f.fix_ready_at!))),
      fix_first_time_pass_rate: decided.length > 0
        ? pct(decided.filter((f) => f.status === 'verified' && f.fix_cycle === 1).length, new Set(decided.map((f) => f.bug_id)).size) : null,
      evidence_completion: pct(ev.filter((r) => Number(r.done) === 1).length, ev.length),
      retests_done: rt.length,
      avg_retest_turnaround_days: avg(rt.map((r) => hours(r.created_at, r.tested_at!))),
    };
  });
}

// ---------------------------------------------------------------------
// KPI snapshots (trend) — weekly scheduler job
// ---------------------------------------------------------------------
export async function takeKpiSnapshot(ctx: Ctx): Promise<number> {
  const projects = await ctx.q<{ id: string; progress: number; health: string; status: string; forecast_date: string | null }>(
    `SELECT id, progress, health, status, forecast_date FROM projects WHERE status NOT IN ('cancelled','draft')`);
  const waiting = await projectWaitingDays(ctx, projects.map((p) => p.id));
  for (const p of projects) {
    const base = await ctx.val<string>('SELECT planned_finish FROM project_baselines WHERE project_id = ? ORDER BY version_no DESC LIMIT 1', [p.id]);
    const overdue = Number(await ctx.val(`SELECT COUNT(*) FROM internal_tasks WHERE project_id = ? AND status NOT IN ('completed','cancelled') AND due_date < ?`, [p.id, ctx.today]));
    const openBugs = Number(await ctx.val(`SELECT COUNT(*) FROM bugs WHERE project_id = ? AND status NOT IN ('closed','cancelled')`, [p.id]));
    const ev = await ctx.one<{ total: number; done: number }>(
      `SELECT COUNT(*) total, COALESCE(SUM(EXISTS (SELECT 1 FROM evidence e WHERE e.requirement_id = r.id AND e.verification_status <> 'rejected')), 0) done
         FROM evidence_requirements r WHERE r.project_id = ? AND r.is_mandatory = 1`, [p.id]);
    await ctx.exec(
      `INSERT INTO project_kpi_snapshots(id, project_id, snapshot_date, progress, health, status, schedule_variance, overdue_tasks, open_bugs, evidence_completion, waiting_days)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE progress = VALUES(progress), health = VALUES(health), status = VALUES(status), schedule_variance = VALUES(schedule_variance),
         overdue_tasks = VALUES(overdue_tasks), open_bugs = VALUES(open_bugs), evidence_completion = VALUES(evidence_completion), waiting_days = VALUES(waiting_days)`,
      [uuid(), p.id, ctx.today, p.progress, p.health, p.status, base && p.forecast_date ? daysBetween(base, p.forecast_date) : null,
        overdue, openBugs, pct(Number(ev?.done ?? 0), Number(ev?.total ?? 0)), waiting.get(p.id) ?? 0]);
  }
  return projects.length;
}

export async function triggerKpiSnapshot(ctx: Ctx) {
  if (!canViewKpiAll(ctx)) throw new AppError('Not allowed', 403);
  return takeKpiSnapshot(ctx);
}
