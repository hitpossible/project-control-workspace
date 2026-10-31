import type { DataFilter } from '@/lib/db/protocol';
import { runQuery } from './data';
import { AppError, type Ctx, inList, type Row } from './db';
import { missingEvidence } from './logic/project';
import { markFixReady, startFix } from './rpc/qa';

/**
 * One task / bug in full, and the updates a user's own tools may make to it (GET / POST /api/me/work/<type>/<id>).
 * Everything goes through the same table policies (runQuery) and workflow functions (QA RPCs) as the UI,
 * so a token can do exactly what its user could do in the browser — and every write lands in the audit log.
 */
export type WorkType = 'task' | 'bug';

/** Statuses a tool may set on a task — completing / cancelling stays with people (reviewer, leader) */
export const AGENT_TASK_STATUSES = ['todo', 'in_progress', 'waiting', 'review', 'on_hold'] as const;
/** Comments written through a token are marked, so readers know an assistant posted them */
export const AGENT_COMMENT_PREFIX = '[via AI assistant] ';

export function workType(raw: string): WorkType {
  if (raw === 'task' || raw === 'bug') return raw;
  throw new AppError('Type must be task or bug', 404);
}

const select = async (ctx: Ctx, table: string, filters: DataFilter[], extra: { columns?: string; order?: string; limit?: number } = {}) =>
  (await runQuery(ctx, {
    table, action: 'select', columns: extra.columns ?? '*', filters,
    order: extra.order ? [{ col: extra.order, ascending: true }] : undefined, limit: extra.limit,
  })).data as Row[];

async function names(ctx: Ctx, ids: unknown[]): Promise<Map<number, string>> {
  const list = [...new Set(ids.filter((v) => v !== null && v !== undefined).map(Number))];
  if (!list.length) return new Map();
  const [ph, params] = inList(list);
  const rows = await ctx.q<{ id: number; full_name: string }>(`SELECT id, full_name FROM profiles WHERE id IN (${ph})`, params);
  return new Map(rows.map((r) => [r.id, r.full_name]));
}

async function comments(ctx: Ctx, type: WorkType, id: number) {
  const rows = await select(ctx, 'comments', [{ op: 'eq', col: 'entity_type', value: type }, { op: 'eq', col: 'entity_id', value: id }], { order: 'created_at', limit: 100 });
  const who = await names(ctx, rows.map((c) => c.created_by));
  return rows.map((c) => ({ id: c.id, author: who.get(Number(c.created_by)) ?? null, body: c.body, created_at: c.created_at }));
}

async function one(ctx: Ctx, table: string, id: number, label: string): Promise<Row> {
  const row = (await select(ctx, table, [{ op: 'eq', col: 'id', value: id }], { columns: '*, projects(project_code, project_name)' }))[0];
  if (!row) throw new AppError(`${label} not found`, 404); // also when the policy hides it
  return row;
}

export async function workItemDetail(ctx: Ctx, type: WorkType, id: number, base: string) {
  if (type === 'task') {
    const t = await one(ctx, 'internal_tasks', id, 'Task');
    const [activity] = await select(ctx, 'activities', [{ op: 'eq', col: 'id', value: t.activity_id }], { columns: 'id, name, plan_finish, status' });
    const parent = t.parent_task_id ? (await select(ctx, 'internal_tasks', [{ op: 'eq', col: 'id', value: t.parent_task_id }], { columns: 'id, task_no, name, status' }))[0] ?? null : null;
    const subtasks = await select(ctx, 'internal_tasks', [{ op: 'eq', col: 'parent_task_id', value: id }], { columns: 'id, task_no, name, status, progress, due_date, owner_id', order: 'seq' });
    const bugs = await select(ctx, 'bugs', [{ op: 'eq', col: 'task_id', value: id }], { columns: 'id, bug_no, title, status, severity' });
    const who = await names(ctx, [t.owner_id, t.reviewer_id, t.created_by, ...subtasks.map((s) => s.owner_id)]);
    return {
      type, id: t.id, task_no: t.task_no, name: t.name, task_type: t.task_type, status: t.status, priority: t.priority, progress: t.progress,
      planned_start: t.planned_start, due_date: t.due_date, actual_start: t.actual_start, actual_finish: t.actual_finish,
      description: t.description, technical_note: t.technical_note, internal_comment: t.internal_comment,
      delay_reason: t.delay_reason, recovery_action: t.recovery_action,
      project: t.projects, activity: activity ? { name: activity.name, plan_finish: activity.plan_finish, status: activity.status } : null,
      owner: who.get(Number(t.owner_id)) ?? null, reviewer: t.reviewer_id ? who.get(Number(t.reviewer_id)) ?? null : null,
      created_by: t.created_by ? who.get(Number(t.created_by)) ?? null : null,
      parent_task: parent, subtasks: subtasks.map((s) => ({ ...s, owner: who.get(Number(s.owner_id)) ?? null })), bugs,
      missing_evidence: await missingEvidence(ctx, 'task', id),
      comments: await comments(ctx, type, id),
      url: `${base}/projects/${t.project_id}?tab=internal&task=${id}`,
    };
  }

  const b = await one(ctx, 'bugs', id, 'Bug');
  const fixes = await select(ctx, 'bug_fixes', [{ op: 'eq', col: 'bug_id', value: id }], { order: 'fix_cycle' });
  const retests = await select(ctx, 'retests', [{ op: 'eq', col: 'bug_id', value: id }], { order: 'retest_round' });
  const task = b.task_id ? (await select(ctx, 'internal_tasks', [{ op: 'eq', col: 'id', value: b.task_id }], { columns: 'id, task_no, name, status' }))[0] ?? null : null;
  const who = await names(ctx, [b.reporter_id, b.assigned_dev_id, b.supervisor_id, ...fixes.map((f) => f.fix_owner_id), ...retests.map((r) => r.tester_id)]);
  const name = (v: unknown) => (v ? who.get(Number(v)) ?? null : null);
  return {
    type, id: b.id, bug_no: b.bug_no, title: b.title, status: b.status, severity: b.severity, priority: b.priority, due_date: b.due_date,
    description: b.description, steps_to_reproduce: b.steps_to_reproduce, expected_result: b.expected_result, actual_result: b.actual_result,
    root_cause: b.root_cause, root_cause_category: b.root_cause_category, reopen_count: b.reopen_count,
    project: b.projects, task, reporter: name(b.reporter_id), assigned_dev: name(b.assigned_dev_id), supervisor: name(b.supervisor_id),
    fixes: fixes.map((f) => ({
      id: f.id, fix_cycle: f.fix_cycle, status: f.status, owner: name(f.fix_owner_id), fix_start_date: f.fix_start_date, fix_due_date: f.fix_due_date,
      fix_description: f.fix_description, technical_note: f.technical_note, unit_test_result: f.unit_test_result, commit_link: f.commit_link, fix_ready_at: f.fix_ready_at,
    })),
    retests: retests.map((r) => ({ id: r.id, round: r.retest_round, status: r.status, result: r.result, comment: r.comment, tester: name(r.tester_id), due_date: r.due_date, tested_at: r.tested_at })),
    comments: await comments(ctx, type, id),
    url: `${base}/projects/${b.project_id}?tab=qa&bug=${id}`,
  };
}

// ---------------------------------------------------------------------
// Updates
// ---------------------------------------------------------------------
export type TaskUpdate = { status?: string; progress?: number; comment?: string };
export type BugUpdate = {
  action?: 'start_fix' | 'fix_ready'; comment?: string;
  fix_description?: string; unit_test_result?: string; technical_note?: string; commit_link?: string;
};

const text = (v: unknown, max: number, label: string): string | undefined => {
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim();
  if (s.length > max) throw new AppError(`${label} is too long (max ${max} characters)`);
  return s || undefined;
};

export function parseTaskUpdate(body: Record<string, unknown>): TaskUpdate {
  const out: TaskUpdate = {};
  if (body.status !== undefined) {
    const s = String(body.status);
    if (!(AGENT_TASK_STATUSES as readonly string[]).includes(s)) {
      throw new AppError(`status must be one of ${AGENT_TASK_STATUSES.join(', ')} — completing or cancelling a task is left to people`);
    }
    out.status = s;
  }
  if (body.progress !== undefined) {
    const p = Number(body.progress);
    if (!Number.isFinite(p) || p < 0 || p > 100) throw new AppError('progress must be 0–100');
    out.progress = Math.round(p * 100) / 100;
  }
  out.comment = text(body.comment, 4000, 'comment');
  if (out.status === undefined && out.progress === undefined && !out.comment) throw new AppError('Nothing to update: send status, progress and/or comment');
  return out;
}

export function parseBugUpdate(body: Record<string, unknown>): BugUpdate {
  const action = body.action === undefined || body.action === null ? undefined : String(body.action);
  if (action !== undefined && action !== 'start_fix' && action !== 'fix_ready') throw new AppError('action must be start_fix or fix_ready');
  const out: BugUpdate = {
    action, comment: text(body.comment, 4000, 'comment'),
    fix_description: text(body.fix_description, 4000, 'fix_description'), unit_test_result: text(body.unit_test_result, 4000, 'unit_test_result'),
    technical_note: text(body.technical_note, 4000, 'technical_note'), commit_link: text(body.commit_link, 500, 'commit_link'),
  };
  if (action === 'fix_ready' && !out.fix_description) throw new AppError('fix_ready needs fix_description (what was changed and why)');
  if (!action && !out.comment) throw new AppError('Nothing to update: send action and/or comment');
  return out;
}

async function addComment(ctx: Ctx, type: WorkType, id: number, projectId: number, body: string) {
  await runQuery(ctx, {
    table: 'comments', action: 'insert',
    values: { entity_type: type, entity_id: id, project_id: projectId, body: AGENT_COMMENT_PREFIX + body, mentions: [] },
  });
}

export async function updateWorkItem(ctx: Ctx, type: WorkType, id: number, body: Record<string, unknown>, base: string) {
  if (type === 'task') {
    const u = parseTaskUpdate(body);
    const t = await one(ctx, 'internal_tasks', id, 'Task');
    const patch: Row = {};
    if (u.status !== undefined) patch.status = u.status;
    if (u.progress !== undefined) patch.progress = u.progress;
    if (Object.keys(patch).length) {
      const res = await runQuery(ctx, { table: 'internal_tasks', action: 'update', values: patch, filters: [{ op: 'eq', col: 'id', value: id }], returning: 'id' });
      if (!(res.data as Row[]).length) throw new AppError('You cannot update this task (only its owner, reviewer, creator or the project leader can)', 403);
    }
    if (u.comment) await addComment(ctx, type, id, Number(t.project_id), u.comment);
  } else {
    const u = parseBugUpdate(body);
    const b = await one(ctx, 'bugs', id, 'Bug');
    if (u.action === 'start_fix') await startFix(ctx, { p_bug_id: id });
    if (u.action === 'fix_ready') {
      const fixId = await ctx.val<number>(`SELECT id FROM bug_fixes WHERE bug_id = ? AND status = 'in_progress' ORDER BY fix_cycle DESC LIMIT 1`, [id]);
      if (!fixId) throw new AppError(`No fix in progress on this bug (status ${b.status}) — start_fix first`);
      await markFixReady(ctx, {
        p_fix_id: fixId, p_description: u.fix_description!, p_unit_test_result: u.unit_test_result ?? null,
        p_technical_note: u.technical_note ?? null, p_commit_link: u.commit_link ?? null,
      });
    }
    if (u.comment) await addComment(ctx, type, id, Number(b.project_id), u.comment);
  }
  return workItemDetail(ctx, type, id, base);
}
