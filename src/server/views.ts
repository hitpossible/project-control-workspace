import type { ProjectView } from '@/lib/types';
import { type Ctx, type Row, daysBetween } from './db';
import { idFilter, visibleProjectIds } from './perms';

/**
 * v_projects — project + type / leader / request / baseline + QA and attention flags.
 * (A Postgres view with LATERAL joins before; MySQL 5.7 has neither LATERAL nor arrays.)
 */
export async function loadProjectsView(ctx: Ctx): Promise<Row[]> {
  const t = ctx.today;
  const [vis, vp] = idFilter('p.id', await visibleProjectIds(ctx));
  const OVERDUE = `a.plan_finish < ? AND a.status NOT IN ('completed','cancelled')`;
  const rows = await ctx.q<ProjectView & { unreviewed_recovery: number }>(`
    SELECT p.*, pt.code project_type_code, pt.name project_type_name, l.full_name leader_name,
           r.request_no, r.req_department requestor_department,
           (SELECT b.planned_finish FROM project_baselines b WHERE b.project_id = p.id ORDER BY b.version_no DESC LIMIT 1) baseline_finish,
           (SELECT COUNT(*) FROM activities a WHERE a.project_id = p.id AND a.status <> 'cancelled') activity_count,
           (SELECT COUNT(*) FROM activities a WHERE a.project_id = p.id AND ${OVERDUE}) overdue_activities,
           (SELECT COUNT(*) FROM activities a WHERE a.project_id = p.id AND ${OVERDUE} AND TRIM(COALESCE(a.recovery_plan, '')) = '') delayed_without_recovery,
           (SELECT COUNT(*) FROM activities a WHERE a.project_id = p.id AND ${OVERDUE} AND TRIM(COALESCE(a.recovery_plan, '')) <> ''
               AND a.recovery_reviewed_by IS NULL) unreviewed_recovery,
           (SELECT COUNT(*) FROM bugs WHERE project_id = p.id AND status NOT IN ('closed','cancelled')) open_bugs,
           (SELECT COUNT(*) FROM bugs WHERE project_id = p.id AND severity = 'critical' AND status NOT IN ('closed','cancelled')) critical_bugs,
           (SELECT COUNT(*) FROM retests WHERE project_id = p.id AND status = 'pending') retest_pending,
           (SELECT COUNT(*) FROM retests WHERE project_id = p.id AND status = 'pending' AND due_date < ?) retest_overdue,
           (SELECT COUNT(*) FROM bugs WHERE project_id = p.id AND status IN ('assigned','in_progress','reopened') AND due_date < ?) fix_overdue,
           (SELECT COUNT(*) FROM evidence_requirements er
              LEFT JOIN activities ea ON er.entity_type = 'activity' AND ea.id = er.entity_id
              LEFT JOIN internal_tasks et ON er.entity_type = 'task' AND et.id = er.entity_id
             WHERE er.project_id = p.id AND er.is_mandatory = 1
               AND NOT EXISTS (SELECT 1 FROM evidence e WHERE e.requirement_id = er.id AND e.verification_status <> 'rejected')
               AND (er.entity_type = 'project'
                    OR (ea.id IS NOT NULL AND (ea.progress >= 100 OR ea.plan_finish < ?) AND ea.status <> 'cancelled')
                    OR (et.id IS NOT NULL AND (et.progress >= 100 OR et.due_date < ?) AND et.status <> 'cancelled'))) evidence_missing,
           (SELECT COUNT(*) FROM baseline_revisions br WHERE br.project_id = p.id AND br.status = 'pending') pending_revisions
      FROM projects p
      LEFT JOIN project_types pt ON pt.id = p.project_type_id
      LEFT JOIN profiles l ON l.id = p.leader_id
      LEFT JOIN project_requests r ON r.id = p.request_id
     WHERE ${vis}`, [t, t, t, t, t, t, t, ...vp]);

  const ago14 = new Date(Date.now() - 14 * 86400000).toISOString();
  return rows.map((p) => {
    const done = ['completed', 'cancelled'].includes(p.status);
    const variance = p.baseline_finish && p.forecast_date ? daysBetween(p.baseline_finish, p.forecast_date) : null;
    const oa = Number(p.overdue_activities);
    const attention = [
      !p.leader_id && 'No Project Leader',
      !p.target_date && 'No target date',
      !p.next_action?.trim() && 'No next action',
      !done && p.target_date && p.target_date < t && 'Target date passed',
      oa > 0 && `${oa} overdue activit${oa === 1 ? 'y' : 'ies'}`,
      Number(p.delayed_without_recovery) > 0 && 'Delay without Recovery Plan',
      variance !== null && variance > 0 && `Forecast exceeds baseline by ${variance} day(s)`,
      p.baseline_version === 0 && !done && p.created_at < ago14 && 'No baseline after 14 days',
      ['waiting', 'on_hold'].includes(p.status) && p.updated_at < ago14 && 'Waiting/On Hold > 14 days',
      Number(p.critical_bugs) > 0 && `${p.critical_bugs} critical bug(s) open`,
      Number(p.fix_overdue) > 0 && `${p.fix_overdue} bug fix(es) overdue`,
      Number(p.retest_overdue) > 0 && `${p.retest_overdue} retest(s) overdue`,
      Number(p.evidence_missing) > 0 && `${p.evidence_missing} mandatory evidence missing`,
      Number(p.unreviewed_recovery) > 0 && 'Recovery plan not reviewed',
    ].filter(Boolean) as string[];
    const { unreviewed_recovery: _u, ...rest } = p;
    void _u;
    return { ...rest, schedule_variance: variance, attention } as Row;
  });
}
