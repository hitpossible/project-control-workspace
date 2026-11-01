import type { InternalTask, ProjectRequirement } from '@/lib/types';
import { AppError, type Ctx } from '../db';
import { insertRow, updateRow } from '../engine';
import { nextSequence } from '../logic/common';
import { canManageProject } from '../perms';

/**
 * Project requirements: the functions the system must have. Drafted (by hand now, by AI later), approved by the leader,
 * then converted into tasks of the internal plan. A task keeps `requirement_id`, so coverage can be traced.
 */
export const REQ_PRIORITIES = ['must', 'should', 'could', 'wont'] as const;
export const REQ_STATUSES = ['draft', 'approved', 'dropped'] as const;
/** MoSCoW → task priority ("won't" is never planned) */
const TASK_PRIORITY = { must: 'high', should: 'medium', could: 'low' } as const;

const MAX = 4000;
const blank = (s: unknown) => s === null || s === undefined || String(s).trim() === '';

function text(v: unknown, label: string, { required = false, max = MAX } = {}): string | null {
  if (blank(v)) {
    if (required) throw new AppError(`${label} is required`);
    return null;
  }
  const s = String(v).trim();
  if (s.length > max) throw new AppError(`${label} is too long (max ${max} characters)`);
  return s;
}

function oneOf<T extends string>(v: unknown, list: readonly T[], label: string, fallback: T): T {
  if (blank(v)) return fallback;
  if (!(list as readonly string[]).includes(String(v))) throw new AppError(`${label} must be one of ${list.join(', ')}`);
  return String(v) as T;
}

/** Validate the editable fields of a requirement */
export function parseRequirement(a: {
  p_title?: unknown; p_description?: unknown; p_category?: unknown; p_priority?: unknown;
  p_acceptance_criteria?: unknown; p_estimated_md?: unknown; p_status?: unknown;
}) {
  let md: number | null = null;
  if (!blank(a.p_estimated_md)) {
    md = Number(a.p_estimated_md);
    if (!Number.isFinite(md) || md < 0 || md > 9999) throw new AppError('Estimate must be a number of man-days');
    md = Math.round(md * 10) / 10;
  }
  return {
    title: text(a.p_title, 'Title', { required: true, max: 300 })!,
    description: text(a.p_description, 'Description'),
    category: text(a.p_category, 'Category', { max: 100 }),
    priority: oneOf(a.p_priority, REQ_PRIORITIES, 'Priority', 'should'),
    acceptance_criteria: text(a.p_acceptance_criteria, 'Acceptance criteria'),
    estimated_md: md,
    status: oneOf(a.p_status, REQ_STATUSES, 'Status', 'draft'),
  };
}

/** The task a requirement becomes: named after it, carrying its description and acceptance criteria */
export function taskFromRequirement(r: Pick<ProjectRequirement, 'id' | 'req_no' | 'title' | 'description' | 'acceptance_criteria' | 'priority' | 'project_id'>,
  to: { activity_id: number; owner_id: number; due_date: string }) {
  if (r.priority === 'wont') throw new AppError(`${r.req_no} is marked "won't have" — it is not planned`);
  const parts = [r.description?.trim(), r.acceptance_criteria?.trim() && `Acceptance criteria:\n${r.acceptance_criteria.trim()}`].filter(Boolean);
  return {
    project_id: r.project_id,
    requirement_id: r.id,
    activity_id: to.activity_id,
    owner_id: to.owner_id,
    due_date: to.due_date,
    name: `${r.req_no} ${r.title}`.slice(0, 300),
    task_type: 'dev',
    priority: TASK_PRIORITY[r.priority],
    description: parts.length ? parts.join('\n\n') : null,
  };
}

async function manageable(ctx: Ctx, projectId: number) {
  const p = await ctx.one<{ status: string }>('SELECT status FROM projects WHERE id = ?', [projectId]);
  if (!p) throw new AppError('Project not found', 404);
  if (!(await canManageProject(ctx, projectId))) throw new AppError('Only the Project Leader can manage requirements', 403);
  if (['completed', 'cancelled'].includes(p.status)) throw new AppError(`The project is ${p.status}`);
}

async function lockReq(ctx: Ctx, id: number): Promise<ProjectRequirement> {
  const r = await ctx.one<ProjectRequirement>('SELECT * FROM project_requirements WHERE id = ? FOR UPDATE', [id]);
  if (!r) throw new AppError('Requirement not found', 404);
  return r;
}

/** Create (no p_id) or update a requirement */
export async function saveRequirement(ctx: Ctx, a: { p_project_id?: number; p_id?: number } & Parameters<typeof parseRequirement>[0]) {
  const row = parseRequirement(a);
  if (a.p_id) {
    const cur = await lockReq(ctx, Number(a.p_id));
    await manageable(ctx, cur.project_id);
    return ctx.asWorkflow(() => updateRow(ctx, 'project_requirements', cur.id, row));
  }
  const pid = Number(a.p_project_id);
  if (!pid) throw new AppError('p_project_id is required');
  await manageable(ctx, pid);
  return ctx.asWorkflow(async () => {
    const n = await nextSequence(ctx, `fr:${pid}`);
    return insertRow(ctx, 'project_requirements', { ...row, project_id: pid, req_no: `FR-${String(n).padStart(3, '0')}`, seq: n });
  });
}

/** A requirement that already has tasks is dropped instead of deleted, so the trace is kept */
export async function deleteRequirement(ctx: Ctx, a: { p_id: number }) {
  const r = await lockReq(ctx, Number(a.p_id));
  await manageable(ctx, r.project_id);
  const used = await ctx.val<number>('SELECT COUNT(*) FROM internal_tasks WHERE requirement_id = ?', [r.id]);
  if (Number(used) > 0) throw new AppError(`${r.req_no} already has tasks — drop it instead of deleting it`);
  await ctx.exec('DELETE FROM project_requirements WHERE id = ?', [r.id]);
  return { id: r.id };
}

/**
 * Create one task per approved requirement that has none yet. The caller (the dialog) has already shown what will be
 * created; tasks are created as plain `todo` tasks the leader can refine in the internal plan.
 */
export async function convertRequirementsToTasks(ctx: Ctx, a: {
  p_project_id: number; p_requirement_ids: number[]; p_activity_id: number; p_owner_id: number; p_due_date: string;
}) {
  const pid = Number(a.p_project_id);
  await manageable(ctx, pid);
  const ids = [...new Set((a.p_requirement_ids ?? []).map(Number).filter(Boolean))];
  if (!ids.length) throw new AppError('Select at least one requirement');
  if (ids.length > 100) throw new AppError('Convert at most 100 requirements at a time');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(a.p_due_date)) || Number.isNaN(Date.parse(a.p_due_date))) throw new AppError('Due date must be YYYY-MM-DD');
  if (a.p_due_date < ctx.today) throw new AppError('Due date cannot be in the past');
  if (!(await ctx.val('SELECT 1 FROM activities WHERE id = ? AND project_id = ?', [a.p_activity_id, pid]))) throw new AppError('Choose an activity of this project');
  if (!(await ctx.val('SELECT 1 FROM profiles WHERE id = ? AND is_active = 1', [a.p_owner_id]))) throw new AppError('Choose an active owner');

  return ctx.asWorkflow(async () => {
    const created: InternalTask[] = [];
    for (const id of ids) {
      const r = await lockReq(ctx, id);
      if (r.project_id !== pid) throw new AppError('Requirement belongs to another project', 403);
      if (r.status !== 'approved') throw new AppError(`${r.req_no} must be approved before it becomes a task`);
      if (await ctx.val('SELECT 1 FROM internal_tasks WHERE requirement_id = ?', [r.id])) continue; // already planned
      const row = taskFromRequirement(r, { activity_id: Number(a.p_activity_id), owner_id: Number(a.p_owner_id), due_date: a.p_due_date });
      created.push((await insertRow(ctx, 'internal_tasks', { ...row, created_by: ctx.uid })) as unknown as InternalTask);
    }
    return { created: created.length, skipped: ids.length - created.length, task_ids: created.map((t) => t.id) };
  });
}

