import type { Profile } from '@/lib/types';
import { addDays, AppError, localDate, withCtx } from './db';
import { myPendingActions } from './pending-actions';

/**
 * "What do I have to do on <date>": my open work items, each tagged with when it is due relative to that date.
 * Read by GET /api/me/agenda — mainly for the user's AI assistant (mcp/pcw-tasks.mjs), so fields are flat and named.
 */
export type When = 'overdue' | 'today' | 'this_week' | 'later' | 'no_due_date';

const WEEK = 7;

export function whenDue(due: string | null, date: string): When {
  if (!due) return 'no_due_date';
  if (due < date) return 'overdue';
  if (due === date) return 'today';
  return due <= addDays(date, WEEK) ? 'this_week' : 'later';
}

const ORDER: Record<When, number> = { overdue: 0, today: 1, this_week: 2, later: 3, no_due_date: 4 };
const PRIORITY: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

/** overdue first, then by due date, then by priority */
export function byUrgency<T extends { when: When; due_date: string | null; priority?: string | null }>(a: T, b: T) {
  return ORDER[a.when] - ORDER[b.when] || (a.due_date ?? '').localeCompare(b.due_date ?? '') || (PRIORITY[a.priority ?? ''] ?? 9) - (PRIORITY[b.priority ?? ''] ?? 9);
}

type TaskRow = { id: number; task_no: string | null; name: string; status: string; priority: string; due_date: string; planned_start: string | null;
  progress: number; project_id: number; project_code: string; project_name: string; activity: string | null; role: 'owner' | 'reviewer' };
type BugRow = { id: number; bug_no: string; title: string; status: string; severity: string; priority: string; due_date: string | null;
  reopen_count: number; project_id: number; project_code: string; project_name: string };
type RetestRow = { id: number; bug_id: number; bug_no: string; title: string; severity: string; retest_round: number; due_date: string | null;
  project_id: number; project_code: string; project_name: string };

/** `origin` (of the request) builds the links when APP_URL is not set */
export async function myAgenda(me: Profile, dateRaw: string | null, origin = '') {
  const date = dateRaw ?? localDate();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) throw new AppError('date must be YYYY-MM-DD', 400);
  const base = (process.env.APP_URL ?? origin).replace(/\/$/, '');

  return withCtx(me, async (ctx) => {
    // tasks I own that are still open, plus tasks waiting for my review
    const tasks = await ctx.q<TaskRow>(
      `SELECT t.id, t.task_no, t.name, t.status, t.priority, t.due_date, t.planned_start, t.progress, t.project_id,
              p.project_code, p.project_name, a.name activity, IF(t.owner_id = ?, 'owner', 'reviewer') role
         FROM internal_tasks t JOIN projects p ON p.id = t.project_id LEFT JOIN activities a ON a.id = t.activity_id
        WHERE (t.owner_id = ? AND t.status NOT IN ('completed','cancelled'))
           OR (t.reviewer_id = ? AND t.owner_id <> ? AND t.status = 'review')
        ORDER BY t.due_date LIMIT 500`,
      [me.id, me.id, me.id, me.id]);
    const bugs = await ctx.q<BugRow>(
      `SELECT b.id, b.bug_no, b.title, b.status, b.severity, b.priority, b.due_date, b.reopen_count, b.project_id, p.project_code, p.project_name
         FROM bugs b JOIN projects p ON p.id = b.project_id
        WHERE b.assigned_dev_id = ? AND b.status NOT IN ('closed','cancelled')
        ORDER BY b.due_date LIMIT 500`,
      [me.id]);
    const retests = await ctx.q<RetestRow>(
      `SELECT r.id, r.bug_id, b.bug_no, b.title, b.severity, r.retest_round, r.due_date, r.project_id, p.project_code, p.project_name
         FROM retests r JOIN bugs b ON b.id = r.bug_id JOIN projects p ON p.id = r.project_id
        WHERE r.tester_id = ? AND r.status = 'pending'
        ORDER BY r.due_date LIMIT 500`,
      [me.id]);

    const out = {
      tasks: tasks.map((t) => ({ ...t, when: whenDue(t.due_date, date), url: `${base}/projects/${t.project_id}?tab=internal&task=${t.id}` })).sort(byUrgency),
      bugs: bugs.map((b) => ({ ...b, when: whenDue(b.due_date, date), url: `${base}/projects/${b.project_id}?tab=qa&bug=${b.id}` })).sort(byUrgency),
      retests: retests.map((r) => ({ ...r, when: whenDue(r.due_date, date), url: `${base}/projects/${r.project_id}?tab=qa&bug=${r.bug_id}` })).sort(byUrgency),
    };
    // workflow steps waiting for me: change requests and deliveries to accept
    const actions = (await myPendingActions(ctx)).map((a) => ({ ...a, url: `${base}${a.link}` }));
    const all = [...out.tasks, ...out.bugs, ...out.retests];
    const count = (w: When) => all.filter((x) => x.when === w).length;
    return {
      date,
      user: { id: me.id, name: me.full_name, roles: me.roles },
      summary: { overdue: count('overdue'), today: count('today'), this_week: count('this_week'), in_progress: out.tasks.filter((t) => t.status === 'in_progress').length, waiting_for_me: actions.length, total: all.length },
      ...out,
      actions,
    };
  });
}
