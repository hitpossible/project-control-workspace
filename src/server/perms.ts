import type { Ctx } from './db';
import { inList } from './db';

/**
 * Permission helpers — direct port of the Postgres RLS helper functions
 * (my_roles, has_role, is_system_staff, can_view_project, can_view_internal, can_manage_project, …).
 * `ctx.me === null` means a system job (scheduler / seed admin) and has full access.
 */
export const STAFF_ROLES = ['system_reviewer', 'project_leader', 'developer', 'qa', 'supervisor', 'manager', 'admin'];
const INTERNAL_MEMBER_ROLES = ['leader', 'developer', 'qa', 'support', 'supervisor', 'manager'];

export const isSystem = (ctx: Ctx) => ctx.me === null;
export const myRoles = (ctx: Ctx): string[] => (ctx.me?.is_active ? ctx.me.roles : []);
export const hasRole = (ctx: Ctx, role: string) => isSystem(ctx) || myRoles(ctx).includes(role) || myRoles(ctx).includes('admin');
export const isAdmin = (ctx: Ctx) => isSystem(ctx) || myRoles(ctx).includes('admin');
export const isStaff = (ctx: Ctx) => isSystem(ctx) || myRoles(ctx).some((r) => STAFF_ROLES.includes(r));
export const canViewKpiAll = (ctx: Ctx) => isSystem(ctx) || myRoles(ctx).some((r) => ['project_leader', 'supervisor', 'manager', 'admin'].includes(r));

async function cached<T>(ctx: Ctx, key: string, load: () => Promise<T>): Promise<T> {
  if (!ctx.cache.has(key)) ctx.cache.set(key, await load());
  return ctx.cache.get(key) as T;
}

/** project_id → my member roles */
async function memberships(ctx: Ctx): Promise<Map<string, string[]>> {
  return cached(ctx, 'memberships', async () => {
    const rows = await ctx.q<{ project_id: string; member_role: string }>(
      'SELECT project_id, member_role FROM project_members WHERE user_id = ?', [ctx.uid]);
    const m = new Map<string, string[]>();
    for (const r of rows) m.set(r.project_id, [...(m.get(r.project_id) ?? []), r.member_role]);
    return m;
  });
}

/** call after inserting / deleting memberships inside the same request */
export function invalidatePerms(ctx: Ctx) {
  for (const k of ['memberships', 'requestorProjects', 'ledProjects']) ctx.cache.delete(k);
}

async function requestorProjects(ctx: Ctx): Promise<Set<string>> {
  return cached(ctx, 'requestorProjects', async () => new Set((await ctx.q<{ id: string }>(
    `SELECT p.id FROM projects p JOIN project_requests r ON r.id = p.request_id WHERE r.requestor_id = ?`, [ctx.uid])).map((r) => r.id)));
}

async function ledProjects(ctx: Ctx): Promise<Set<string>> {
  return cached(ctx, 'ledProjects', async () => new Set((await ctx.q<{ id: string }>(
    'SELECT id FROM projects WHERE leader_id = ?', [ctx.uid])).map((r) => r.id)));
}

export async function isProjectMember(ctx: Ctx, projectId: string, roles?: string[]) {
  const mine = (await memberships(ctx)).get(projectId) ?? [];
  return roles ? mine.some((r) => roles.includes(r)) : mine.length > 0;
}

export async function canViewProject(ctx: Ctx, projectId: string) {
  if (isStaff(ctx) || hasRole(ctx, 'management_view')) return true;
  return (await isProjectMember(ctx, projectId)) || (await requestorProjects(ctx)).has(projectId);
}

export async function canViewInternal(ctx: Ctx, projectId: string) {
  return isStaff(ctx) || isProjectMember(ctx, projectId, INTERNAL_MEMBER_ROLES);
}

export async function canManageProject(ctx: Ctx, projectId: string) {
  if (isAdmin(ctx)) return true;
  return (await ledProjects(ctx)).has(projectId) || isProjectMember(ctx, projectId, ['leader']);
}

export async function canViewRequest(ctx: Ctx, requestId: string) {
  if (isStaff(ctx)) return true;
  return !!(await ctx.one('SELECT 1 x FROM project_requests WHERE id = ? AND (requestor_id = ? OR requestor_approver_id = ? OR authority_approver_id = ?)',
    [requestId, ctx.uid, ctx.uid, ctx.uid]));
}

export async function canQa(ctx: Ctx, projectId: string) {
  return hasRole(ctx, 'qa') || (await canManageProject(ctx, projectId)) || isProjectMember(ctx, projectId, ['qa', 'leader']);
}

export async function canTriageBug(ctx: Ctx, bug: { project_id: string; reporter_id: string | null }) {
  return (await canManageProject(ctx, bug.project_id)) || bug.reporter_id === ctx.uid
    || hasRole(ctx, 'supervisor') || hasRole(ctx, 'manager')
    || isProjectMember(ctx, bug.project_id, ['qa', 'supervisor', 'manager']);
}

export async function canApproveBaseline(ctx: Ctx, projectId: string) {
  return hasRole(ctx, 'manager') || hasRole(ctx, 'supervisor') || isProjectMember(ctx, projectId, ['manager', 'supervisor']);
}

// ---------------------------------------------------------------------
// Row filters for list queries: null = no restriction
// ---------------------------------------------------------------------
export async function visibleProjectIds(ctx: Ctx): Promise<string[] | null> {
  if (isStaff(ctx) || hasRole(ctx, 'management_view')) return null;
  return [...new Set([...(await memberships(ctx)).keys(), ...(await requestorProjects(ctx))])];
}

export async function internalProjectIds(ctx: Ctx): Promise<string[] | null> {
  if (isStaff(ctx)) return null;
  return [...(await memberships(ctx)).entries()].filter(([, r]) => r.some((x) => INTERNAL_MEMBER_ROLES.includes(x))).map(([id]) => id);
}

/** `col IN (…)` fragment or '1=1' when unrestricted */
export function idFilter(col: string, ids: string[] | null): [string, unknown[]] {
  if (ids === null) return ['1=1', []];
  const [ph, params] = inList(ids);
  return [`${col} IN (${ph})`, params];
}

export function requestFilter(ctx: Ctx, col = 'request_id'): [string, unknown[]] {
  if (isStaff(ctx)) return ['1=1', []];
  return [`${col} IN (SELECT id FROM project_requests WHERE requestor_id = ? OR requestor_approver_id = ? OR authority_approver_id = ?)`,
    [ctx.uid, ctx.uid, ctx.uid]];
}
