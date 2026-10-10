import type { Activity, Project } from '@/lib/types';
import { AppError, type Ctx, type Row, daysBetween } from '../db';
import { insertRow, updateRow } from '../engine';
import { notifyEvent } from './common';

// ---------------------------------------------------------------------
// Activity helpers (was activity_forecast / activity_is_overdue)
// ---------------------------------------------------------------------
type ActLike = Pick<Activity, 'status' | 'plan_finish' | 'actual_finish' | 'forecast_finish'>;

export function activityForecast(a: ActLike, today: string): string | null {
  if (a.status === 'cancelled') return null;
  if (a.status === 'completed') return a.actual_finish ?? a.plan_finish;
  if (a.forecast_finish) return a.forecast_finish;
  if (a.plan_finish && a.plan_finish < today) return today;
  return a.plan_finish;
}

export const activityIsOverdue = (a: Pick<Activity, 'status' | 'plan_finish'>, today: string) =>
  !!a.plan_finish && a.plan_finish < today && !['completed', 'cancelled'].includes(a.status);

export const blank = (s: unknown) => !s || String(s).trim() === '';

// ---------------------------------------------------------------------
// Evidence checklist / QA stats
// ---------------------------------------------------------------------
const HAS_EVIDENCE = `EXISTS (SELECT 1 FROM evidence e WHERE e.requirement_id = r.id AND e.verification_status <> 'rejected')`;

export async function missingEvidence(ctx: Ctx, entityType: string, entityId: string): Promise<string[]> {
  return (await ctx.q<{ name: string }>(
    `SELECT r.name FROM evidence_requirements r
      WHERE r.entity_type = ? AND r.entity_id = ? AND r.is_mandatory = 1 AND NOT ${HAS_EVIDENCE}
      ORDER BY r.created_at`, [entityType, entityId])).map((r) => r.name);
}

export async function openCriticalBugs(ctx: Ctx, projectId: string): Promise<number> {
  return Number(await ctx.val(`SELECT COUNT(*) FROM bugs WHERE project_id = ? AND severity = 'critical' AND status NOT IN ('closed','cancelled')`, [projectId]));
}

export type QaStats = { open_bugs: number; critical_bugs: number; high_bugs: number; retest_pending: number; retest_overdue: number; fix_overdue: number; evidence_missing: number };

/** Due / finished checklist items without evidence */
export const EVIDENCE_MISSING_SQL = `
  SELECT COUNT(*) FROM evidence_requirements r
    LEFT JOIN activities a ON r.entity_type = 'activity' AND a.id = r.entity_id
    LEFT JOIN internal_tasks t ON r.entity_type = 'task' AND t.id = r.entity_id
   WHERE r.project_id = ? AND r.is_mandatory = 1 AND NOT ${HAS_EVIDENCE}
     AND (r.entity_type = 'project'
          OR (a.id IS NOT NULL AND (a.progress >= 100 OR a.plan_finish < ?) AND a.status <> 'cancelled')
          OR (t.id IS NOT NULL AND (t.progress >= 100 OR t.due_date < ?) AND t.status <> 'cancelled'))`;

export async function projectQaStats(ctx: Ctx, projectId: string): Promise<QaStats> {
  const t = ctx.today;
  const row = await ctx.one<Row>(`
    SELECT
      (SELECT COUNT(*) FROM bugs WHERE project_id = ? AND status NOT IN ('closed','cancelled')) open_bugs,
      (SELECT COUNT(*) FROM bugs WHERE project_id = ? AND severity = 'critical' AND status NOT IN ('closed','cancelled')) critical_bugs,
      (SELECT COUNT(*) FROM bugs WHERE project_id = ? AND severity = 'high' AND status NOT IN ('closed','cancelled')) high_bugs,
      (SELECT COUNT(*) FROM retests WHERE project_id = ? AND status = 'pending') retest_pending,
      (SELECT COUNT(*) FROM retests WHERE project_id = ? AND status = 'pending' AND due_date < ?) retest_overdue,
      (SELECT COUNT(*) FROM bugs WHERE project_id = ? AND status IN ('assigned','in_progress','reopened') AND due_date < ?) fix_overdue,
      (${EVIDENCE_MISSING_SQL}) evidence_missing`,
  [projectId, projectId, projectId, projectId, projectId, t, projectId, t, projectId, t, t]);
  return Object.fromEntries(Object.entries(row ?? {}).map(([k, v]) => [k, Number(v ?? 0)])) as QaStats;
}

// ---------------------------------------------------------------------
// Recompute project progress / forecast / health / auto status (was recompute_project)
// ---------------------------------------------------------------------
export async function recomputeProject(ctx: Ctx, projectId: string) {
  const p = await ctx.one<Project>('SELECT * FROM projects WHERE id = ?', [projectId]);
  if (!p) return;
  const today = ctx.today;
  const acts = await ctx.q<Activity>(`SELECT * FROM activities WHERE project_id = ? AND status <> 'cancelled'`, [projectId]);

  let wsum = 0;
  let psum = 0;
  let forecast: string | null = null;
  let overdueA = 0;
  let noRecov = 0;
  for (const a of acts) {
    const w = Math.max(a.plan_start && a.plan_finish ? daysBetween(a.plan_start, a.plan_finish) + 1 : 1, 1);
    wsum += w;
    psum += Number(a.progress) * w;
    const f = activityForecast(a, today);
    if (f && (!forecast || f > forecast)) forecast = f;
    if (activityIsOverdue(a, today)) {
      overdueA++;
      if (blank(a.recovery_plan)) noRecov++;
    }
  }
  const progress = Math.round(Math.min(Math.max(wsum ? psum / wsum : 0, 0), 100) * 100) / 100;
  const overdueT = Number(await ctx.val(`SELECT COUNT(*) FROM internal_tasks WHERE project_id = ? AND due_date < ? AND status NOT IN ('completed','cancelled')`, [projectId, today]));
  const q = await projectQaStats(ctx, projectId);
  const baseFin = await ctx.val<string>('SELECT planned_finish FROM project_baselines WHERE project_id = ? ORDER BY version_no DESC LIMIT 1', [projectId]);
  const ref = baseFin ?? p.target_date;
  const variance = forecast && ref ? daysBetween(ref, forecast) : 0;

  let health: Project['health'];
  if (['completed', 'cancelled'].includes(p.status)) {
    health = p.status === 'completed' && variance > 0 ? 'yellow' : 'green';
  } else if (noRecov > 0 || variance > 7 || q.critical_bugs > 0 || (p.target_date && p.target_date < today)) {
    health = 'red';
  } else if (overdueA > 0 || overdueT > 0 || variance > 0 || q.high_bugs > 0 || q.retest_overdue > 0 || q.fix_overdue > 0
    || q.evidence_missing > 0 || ['waiting', 'on_hold', 'at_risk'].includes(p.status) || blank(p.next_action)) {
    health = 'yellow';
  } else {
    health = 'green';
  }

  let status = p.status;
  if (['in_progress', 'at_risk', 'delayed'].includes(p.status)) {
    status = overdueA > 0 || variance > 0 ? 'delayed'
      : health === 'yellow' && (overdueT > 0 || q.fix_overdue > 0) ? 'at_risk'
        : q.critical_bugs > 0 ? 'at_risk' : 'in_progress';
  }

  await ctx.asWorkflow(() => updateRow(ctx, 'projects', projectId, { progress, forecast_date: forecast, health, status }));
}

// ---------------------------------------------------------------------
// Evidence checklist from the template (was apply_template_checklist)
//   item: "name" (project level) or {"name","activity","mandatory"}
// ---------------------------------------------------------------------
export async function applyTemplateChecklist(ctx: Ctx, projectId: string): Promise<number> {
  const tpl = await ctx.one<{ evidence_checklist: unknown[] }>(
    'SELECT t.evidence_checklist FROM projects p JOIN project_templates t ON t.id = p.template_id WHERE p.id = ?', [projectId]);
  let n = 0;
  for (const item of tpl?.evidence_checklist ?? []) {
    const obj = typeof item === 'object' && item !== null ? (item as { name: string; activity?: string; mandatory?: boolean }) : null;
    const name = obj ? obj.name : String(item);
    let act: string | null = null;
    if (obj?.activity) {
      act = await ctx.val<string>('SELECT id FROM activities WHERE project_id = ? AND LOWER(name) = LOWER(?) LIMIT 1', [projectId, obj.activity]);
    }
    await insertRow(ctx, 'evidence_requirements', {
      project_id: projectId, entity_type: act ? 'activity' : 'project', entity_id: act ?? projectId,
      name, is_mandatory: obj?.mandatory ?? true, source: 'template',
    });
    n++;
  }
  return n;
}

// ---------------------------------------------------------------------
// Status side-effects (was activity_before_write / task_before_write)
// Direct user attempts to complete without mandatory evidence raise an error;
// cascaded roll-ups (ctx.depth > 0) simply do not complete the item.
// ---------------------------------------------------------------------
export async function activityBeforeWrite(ctx: Ctx, n: Row, old: Row | null) {
  if (old && n.status === 'completed' && old.status !== 'completed') {
    const missing = await missingEvidence(ctx, 'activity', String(n.id));
    const crit = n.is_milestone ? await openCriticalBugs(ctx, String(n.project_id)) : 0;
    if (missing.length || crit > 0) {
      if (ctx.depth > 0) n.status = ['not_started', 'completed'].includes(String(old.status)) ? 'in_progress' : old.status;
      else if (missing.length) throw new AppError(`Cannot complete "${n.name}": mandatory evidence missing — ${missing.join(', ')}`);
      else throw new AppError(`Cannot complete milestone "${n.name}": ${crit} critical bug(s) still open`);
    }
  }
  if (n.status === 'completed') {
    n.progress = 100;
    n.actual_finish ??= ctx.today;
    n.actual_start ??= n.actual_finish;
  } else if (Number(n.progress) > 0 || n.status === 'in_progress') {
    n.actual_start ??= ctx.today;
    if (n.status === 'not_started') n.status = 'in_progress';
  }
  if (n.status !== 'completed') n.actual_finish = null;
  // reviewing a recovery plan is reset when the plan text changes
  if (old && (n.recovery_plan ?? null) !== (old.recovery_plan ?? null) && (n.recovery_reviewed_by ?? null) === (old.recovery_reviewed_by ?? null)) {
    n.recovery_reviewed_by = null;
    n.recovery_reviewed_at = null;
  }
}

export async function taskBeforeWrite(ctx: Ctx, n: Row, old: Row | null) {
  if (old && n.status === 'completed' && old.status !== 'completed') {
    const missing = await missingEvidence(ctx, 'task', String(n.id));
    if (missing.length) {
      if (ctx.depth > 0) n.status = 'review';
      else throw new AppError(`Cannot complete "${n.name}": mandatory evidence missing — ${missing.join(', ')}`);
    }
  }
  if (n.status === 'completed') {
    n.progress = 100;
    n.actual_finish ??= ctx.today;
    n.actual_start ??= n.actual_finish;
  } else if (['in_progress', 'review'].includes(String(n.status)) || Number(n.progress) > 0) {
    n.actual_start ??= ctx.today;
    if (n.status === 'todo') n.status = 'in_progress';
  }
  if (n.status !== 'completed') n.actual_finish = null;
  if (Number(n.progress) === 100 && !['completed', 'cancelled'].includes(String(n.status))) n.status = 'review';
}

// ---------------------------------------------------------------------
// Roll task progress up: sub-task → parent task → activity → project (was rollup_from_task)
// ---------------------------------------------------------------------
type Agg = { avg: number | null; cnt: number; done: number; astart: string | null; afinish: string | null };
const AGG = `SELECT AVG(progress) avg, COUNT(*) cnt, SUM(status = 'completed') done, MIN(actual_start) astart, MAX(actual_finish) afinish`;
const r2 = (v: number) => Math.round(v * 100) / 100;

export async function rollupFromTask(ctx: Ctx, r: Row) {
  if (ctx.depth > 8) return;
  if (r.parent_task_id) {
    const g = (await ctx.one<Agg>(`${AGG} FROM internal_tasks WHERE parent_task_id = ? AND status <> 'cancelled'`, [r.parent_task_id]))!;
    if (Number(g.cnt) > 0) {
      const parent = await ctx.one<Row>('SELECT status, actual_start FROM internal_tasks WHERE id = ?', [r.parent_task_id]);
      if (parent) {
        const all = Number(g.done) === Number(g.cnt);
        await updateRow(ctx, 'internal_tasks', r.parent_task_id, {
          progress: r2(Number(g.avg)),
          status: all ? 'completed' : parent.status === 'completed' ? 'in_progress' : parent.status,
          actual_start: g.astart ?? parent.actual_start,
          actual_finish: all ? g.afinish : null,
        });
      }
    }
  }
  // activity progress = average of top-level tasks; actual dates from tasks
  const g = (await ctx.one<Agg>(`${AGG} FROM internal_tasks WHERE activity_id = ? AND parent_task_id IS NULL AND status <> 'cancelled'`, [r.activity_id]))!;
  if (Number(g.cnt) > 0) {
    const act = await ctx.one<Row>('SELECT status, actual_start FROM activities WHERE id = ?', [r.activity_id]);
    if (act) {
      const all = Number(g.done) === Number(g.cnt);
      await updateRow(ctx, 'activities', r.activity_id, {
        progress: r2(Number(g.avg)),
        status: all ? 'completed' : act.status === 'completed' ? 'in_progress' : act.status,
        actual_start: g.astart ?? act.actual_start,
        actual_finish: all ? g.afinish : null,
      });
    }
  }
  await recomputeProject(ctx, String(r.project_id));
}

/** Activity changes: recompute project; Activity Delayed → Leader / PIC / Supervisor (was rollup_from_activity) */
export async function rollupFromActivity(ctx: Ctx, r: Row, old: Row | null, op: 'insert' | 'update' | 'delete') {
  if (ctx.depth > 8) return;
  await recomputeProject(ctx, String(r.project_id));
  if (op === 'update' && r.status === 'delayed' && old?.status !== 'delayed') {
    await notifyEvent(ctx, {
      event: 'activity_delayed', projectId: String(r.project_id), explicit: [r.pic_user_id as string | null],
      title: `Activity delayed: ${r.name}`, body: `Reason: ${r.delay_reason ?? '(not provided)'}`,
      link: `/projects/${r.project_id}?tab=plan`, dedupe: `activity_delayed:${r.id}:${ctx.today}`,
    });
  }
}
