import { type CandidateFacts, type HeldSkill, type MemberRecommendations, rankCandidates, type SkillRequirement } from '@/lib/skills';
import { AppError, addDays, type Ctx, inList } from '../db';
import { workCalendar } from '../logic/common';
import { canPlanProject } from '../perms';

/** projects that still take people's time */
const ACTIVE = ['planning', 'in_progress', 'waiting', 'at_risk', 'delayed'];
/** window used when the project has no (future) target date */
const DEFAULT_WINDOW_DAYS = 30;

/** Developers ranked for a project by its skill requirements (scoring rules: src/lib/skills.ts) */
export async function recommendMembers(ctx: Ctx, a: { p_project_id?: unknown }): Promise<MemberRecommendations> {
  const pid = Number(a?.p_project_id);
  if (!pid) throw new AppError('p_project_id is required');
  if (!(await canPlanProject(ctx, pid))) throw new AppError('Not allowed', 403);

  const p = await ctx.one<{ project_type_id: number | null; start_date: string | null; target_date: string | null }>(
    'SELECT project_type_id, start_date, target_date FROM projects WHERE id = ?', [pid]);
  if (!p) throw new AppError('Project not found', 404);

  const from = p.start_date && p.start_date > ctx.today ? p.start_date : ctx.today;
  const to = p.target_date && p.target_date >= from ? p.target_date : addDays(from, DEFAULT_WINDOW_DAYS);
  const cal = await workCalendar(ctx);
  const workdays = cal.workdaysBetween(addDays(from, -1), to);

  const reqs = (await ctx.q<SkillRequirement>(
    `SELECT r.skill_id, r.required_level, r.weight, r.is_mandatory FROM project_skill_requirements r
       JOIN skills s ON s.id = r.skill_id AND s.is_active = 1 WHERE r.project_id = ?`, [pid]));
  const window = { from, to, workdays };
  const hasProjectType = p.project_type_id != null;
  if (!reqs.length) return { window, hasProjectType, requirements: 0, candidates: [] };

  const people = await ctx.q<{ id: number }>(
    `SELECT id FROM profiles WHERE is_active = 1 AND JSON_CONTAINS(roles, '"developer"')`);
  const ids = people.map((x) => x.id);
  if (!ids.length) return { window, hasProjectType, requirements: reqs.length, candidates: [] };
  const [ph, ip] = inList(ids);
  const [aph, ap] = inList(ACTIVE);
  const yearAgo = addDays(ctx.today, -365);

  const count = async (sql: string, params: unknown[]) =>
    new Map((await ctx.q<{ uid: number; n: number }>(sql, params)).map((r) => [r.uid, Number(r.n)]));

  const skills = await ctx.q<HeldSkill & { user_id: number }>(
    `SELECT user_id, skill_id, self_level, verified_level, updated_at, verified_at FROM profile_skills WHERE user_id IN (${ph})`, ip);
  const leaves = await ctx.q<{ uid: number; d: string }>(
    `SELECT DISTINCT user_id uid, work_date d FROM workforce_plans
      WHERE work_type = 'leave' AND work_date BETWEEN ? AND ? AND user_id IN (${ph})`, [from, to, ...ip]);
  const active = await count(
    `SELECT m.user_id uid, COUNT(DISTINCT m.project_id) n FROM project_members m JOIN projects pr ON pr.id = m.project_id
      WHERE pr.status IN (${aph}) AND m.project_id <> ? AND m.member_role IN ('leader','developer') AND m.user_id IN (${ph})
      GROUP BY m.user_id`, [...ap, pid, ...ip]);
  const tasks = await count(
    `SELECT owner_id uid, COUNT(*) n FROM internal_tasks
      WHERE status NOT IN ('completed','cancelled') AND due_date <= ? AND owner_id IN (${ph}) GROUP BY owner_id`, [to, ...ip]);
  const bugs = await count(
    `SELECT assigned_dev_id uid, COUNT(*) n FROM bugs
      WHERE status IN ('assigned','in_progress','reopened') AND assigned_dev_id IN (${ph}) GROUP BY assigned_dev_id`, ip);
  const done = await ctx.q<{ uid: number; n: number; on_time: number }>(
    `SELECT owner_id uid, COUNT(*) n, SUM(actual_finish <= due_date) on_time FROM internal_tasks
      WHERE status = 'completed' AND actual_finish >= ? AND owner_id IN (${ph}) GROUP BY owner_id`, [yearAgo, ...ip]);
  const sameType = hasProjectType ? await count(
    `SELECT m.user_id uid, COUNT(DISTINCT m.project_id) n FROM project_members m JOIN projects pr ON pr.id = m.project_id
      WHERE pr.project_type_id = ? AND pr.status <> 'cancelled' AND m.project_id <> ? AND m.user_id IN (${ph}) GROUP BY m.user_id`,
    [p.project_type_id, pid, ...ip]) : new Map<number, number>();
  const members = new Set((await ctx.q<{ user_id: number }>('SELECT DISTINCT user_id FROM project_members WHERE project_id = ?', [pid])).map((m) => m.user_id));

  const facts: CandidateFacts[] = ids.map((uid) => {
    const d = done.find((r) => r.uid === uid);
    return {
      user_id: uid,
      skills: skills.filter((s) => s.user_id === uid),
      workdays,
      leaveDays: leaves.filter((l) => l.uid === uid && cal.isWorkday(l.d)).length,
      activeProjects: active.get(uid) ?? 0,
      openItems: (tasks.get(uid) ?? 0) + (bugs.get(uid) ?? 0),
      doneTasks: Number(d?.n ?? 0),
      onTimeTasks: Number(d?.on_time ?? 0),
      sameTypeProjects: sameType.get(uid) ?? 0,
    };
  });

  const ranked = rankCandidates(reqs.map((r) => ({ ...r, is_mandatory: !!r.is_mandatory })), facts, { today: ctx.today, hasProjectType });
  return { window, hasProjectType, requirements: reqs.length, candidates: ranked.map((r) => ({ ...r, is_member: members.has(r.user_id) })) };
}
