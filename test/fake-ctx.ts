import type { PoolConnection } from 'mysql2/promise';
import { Ctx } from '@/server/db';
import type { Profile, Role } from '@/lib/types';

/**
 * A Ctx without MySQL: the permission helpers only run a handful of lookups, answered here from plain fixtures.
 * Any other query fails the test, so a new lookup in perms.ts shows up instead of silently returning nothing.
 */
export type World = {
  /** project_members rows */
  members?: { project_id: number; user_id: number; member_role: string }[];
  /** projects: id → leader + the requestor of its request */
  projects?: { id: number; leader_id?: number | null; requestor_id?: number | null }[];
  /** request ids each user may see (answers the myRequestIds sub-query) */
  requestsVisibleTo?: Record<number, number[]>;
  /** project_requests rows for the evidence insert check */
  requests?: { id: number; requestor_id: number }[];
};

export function profile(id: number, roles: Role[], extra: Partial<Profile> = {}): Profile {
  return {
    id, roles, is_active: true, username: `user${id}`, employee_id: null, full_name: `User ${id}`, email: null,
    department_id: null, section_id: null, position_id: null, telephone: null, extension: null, ...extra,
  };
}

export function fakeCtx(me: Profile | null, world: World = {}): Ctx {
  const uid = me?.id ?? null;
  const answer = (sql: string, params: unknown[]): unknown[] => {
    const s = sql.replace(/\s+/g, ' ').trim();
    if (s.startsWith('SELECT project_id, member_role FROM project_members WHERE user_id = ?')) {
      return (world.members ?? []).filter((m) => m.user_id === params[0]);
    }
    if (s.includes('FROM projects p JOIN project_requests r ON r.id = p.request_id WHERE r.requestor_id = ?')) {
      return (world.projects ?? []).filter((p) => p.requestor_id === params[0]).map((p) => ({ id: p.id }));
    }
    if (s.startsWith('SELECT id FROM projects WHERE leader_id = ?')) {
      return (world.projects ?? []).filter((p) => p.leader_id === params[0]).map((p) => ({ id: p.id }));
    }
    if (s.startsWith('SELECT 1 x FROM DUAL WHERE ? IN (')) {
      return (world.requestsVisibleTo?.[uid ?? -1] ?? []).includes(Number(params[0])) ? [{ x: 1 }] : [];
    }
    if (s.startsWith('SELECT 1 FROM project_requests WHERE id = ? AND requestor_id = ?')) {
      return (world.requests ?? []).some((r) => r.id === Number(params[0]) && r.requestor_id === params[1]) ? [{ 1: 1 }] : [];
    }
    throw new Error(`fakeCtx: unexpected query: ${s}`);
  };
  const conn = { query: async (sql: string, params: unknown[] = []) => [answer(sql, params)] } as unknown as PoolConnection;
  return new Ctx(conn, me);
}
