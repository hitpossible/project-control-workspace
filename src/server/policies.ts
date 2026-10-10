import type { Ctx, Row } from './db';
import {
  canManageProject, canQa, canViewInternal, canViewProject, canViewRequest, hasRole, idFilter, internalProjectIds, isAdmin, isProjectMember,
  isStaff, requestFilter, visibleProjectIds,
} from './perms';

/**
 * Row-level access per table — a 1:1 port of the Postgres RLS policies.
 *   read:   SQL condition appended to every SELECT / UPDATE / DELETE (false = no access)
 *   insert: WITH CHECK on the new row (may fill defaults such as the owner)
 *   update: USING on the old row; check: WITH CHECK on the new row
 *   delete: USING on the old row
 * A missing write rule means the operation is only possible through workflow functions (RPC).
 */
export type Where = [string, unknown[]];
export type Policy = {
  read: (ctx: Ctx) => Promise<Where | false> | Where | false;
  insert?: (ctx: Ctx, row: Row) => Promise<boolean> | boolean;
  update?: (ctx: Ctx, old: Row) => Promise<boolean> | boolean;
  check?: (ctx: Ctx, next: Row) => Promise<boolean> | boolean;
  delete?: (ctx: Ctx, old: Row) => Promise<boolean> | boolean;
  /** never returned to the browser */
  hidden?: string[];
  /** never writable through the data API */
  readonly?: string[];
};

const all: Where = ['1=1', []];
const pid = (r: Row) => String(r.project_id);
const admin = (ctx: Ctx) => isAdmin(ctx);
const masterData: Policy = { read: () => all, insert: admin, update: admin, check: admin, delete: admin };
const visibleProject = async (ctx: Ctx, col = 'project_id') => idFilter(col, await visibleProjectIds(ctx));
const internalProject = async (ctx: Ctx, col = 'project_id') => idFilter(col, await internalProjectIds(ctx));
const manage = (ctx: Ctx, r: Row) => canManageProject(ctx, pid(r));

function or(...parts: Where[]): Where {
  return [`(${parts.map((p) => `(${p[0]})`).join(' OR ')})`, parts.flatMap((p) => p[1])];
}

export const POLICIES: Record<string, Policy> = {
  // Profiles: directory readable by signed-in users; self-update basic info; admin all
  profiles: {
    read: () => all,
    update: (ctx, o) => o.id === ctx.uid || isAdmin(ctx),
    check: (ctx, n) => n.id === ctx.uid || isAdmin(ctx),
    hidden: ['password_hash'],
    readonly: ['password_hash', 'last_login_at', 'created_at'],
  },

  // Master data: read for all, write for admin
  app_settings: masterData,
  project_types: masterData,
  project_templates: masterData,
  notification_rules: masterData,
  insight_rules: masterData,

  // Requests
  project_requests: {
    read: (ctx) => (isStaff(ctx) ? all
      : ['(requestor_id = ? OR requestor_approver_id = ? OR authority_approver_id = ?)', [ctx.uid, ctx.uid, ctx.uid]]),
    insert: (ctx, r) => {
      r.requestor_id ??= ctx.uid;
      r.status ??= 'draft';
      return r.requestor_id === ctx.uid && r.status === 'draft';
    },
    update: (ctx, o) => o.requestor_id === ctx.uid && ['draft', 'need_more_information'].includes(String(o.status)),
    check: (ctx, n) => n.requestor_id === ctx.uid,
    delete: (ctx, o) => o.requestor_id === ctx.uid && o.status === 'draft' && o.request_no === null,
  },
  approval_steps: { read: (ctx) => (isStaff(ctx) ? all : or(requestFilter(ctx), ['approver_id = ?', [ctx.uid]])) },
  approval_actions: { read: (ctx) => requestFilter(ctx) },

  // Projects
  projects: {
    read: (ctx) => visibleProject(ctx, 'id'),
    update: (ctx, o) => canManageProject(ctx, String(o.id)),
    check: (ctx, n) => canManageProject(ctx, String(n.id)),
    readonly: ['created_at', 'created_by'],
  },
  project_members: { read: (ctx) => visibleProject(ctx), insert: manage, update: manage, check: manage, delete: manage },
  project_baselines: { read: (ctx) => visibleProject(ctx) },
  project_baseline_items: {
    read: async (ctx) => {
      const [w, p] = await visibleProject(ctx);
      return [`baseline_id IN (SELECT id FROM project_baselines WHERE ${w})`, p];
    },
  },

  // User Control Plan
  activities: {
    read: (ctx) => visibleProject(ctx),
    insert: manage,
    update: async (ctx, o) => (await manage(ctx, o)) || o.pic_user_id === ctx.uid,
    check: async (ctx, n) => (await manage(ctx, n)) || n.pic_user_id === ctx.uid,
    delete: manage,
  },

  // Internal Execution Plan (never visible to Requestor / Management View)
  internal_tasks: {
    read: (ctx) => internalProject(ctx),
    insert: async (ctx, r) => (await manage(ctx, r)) || isProjectMember(ctx, pid(r), ['developer', 'qa', 'support']),
    update: async (ctx, o) => (await manage(ctx, o)) || [o.owner_id, o.reviewer_id, o.created_by].includes(ctx.uid),
    check: (ctx, n) => canViewInternal(ctx, pid(n)),
    delete: async (ctx, o) => (await manage(ctx, o)) || (o.created_by === ctx.uid && o.status === 'todo'),
    readonly: ['task_no', 'created_by', 'created_at'],
  },
  task_dependencies: { read: (ctx) => internalProject(ctx), insert: manage, update: manage, check: manage, delete: manage },

  // Evidence
  evidence: {
    read: async (ctx) => {
      if (isStaff(ctx)) return all;
      const [iw, ip] = await internalProject(ctx);
      const [vw, vp] = await visibleProject(ctx);
      const [rw, rp] = requestFilter(ctx);
      return [`((project_id IS NOT NULL AND ((${iw}) OR (is_internal = 0 AND ${vw})))
               OR (request_id IS NOT NULL AND project_id IS NULL AND ${rw}))`, [...ip, ...vp, ...rp]];
    },
    insert: async (ctx, r) => {
      r.uploaded_by ??= ctx.uid;
      if (r.uploaded_by !== ctx.uid) return false;
      if (r.project_id) return canViewInternal(ctx, pid(r));
      if (!r.request_id) return false;
      return isStaff(ctx) || !!(await ctx.val('SELECT 1 FROM project_requests WHERE id = ? AND requestor_id = ?', [r.request_id, ctx.uid]));
    },
    update: async (ctx, o) => (!!o.project_id && (await manage(ctx, o))) || o.uploaded_by === ctx.uid,
    check: async (ctx, n) => (!!n.project_id && (await manage(ctx, n))) || n.uploaded_by === ctx.uid,
    delete: async (ctx, o) => o.uploaded_by === ctx.uid || (!!o.project_id && (await manage(ctx, o))),
    readonly: ['storage_path', 'file_size', 'mime_type', 'uploaded_at'],
  },

  // Notifications: own only
  notifications: {
    read: (ctx) => ['user_id = ?', [ctx.uid]],
    update: (ctx, o) => o.user_id === ctx.uid,
    check: (ctx, n) => n.user_id === ctx.uid,
  },

  // Audit trail: internal for projects; participants for requests
  audit_logs: {
    read: async (ctx) => {
      if (isAdmin(ctx)) return all;
      const [iw, ip] = await internalProject(ctx);
      const [rw, rp] = requestFilter(ctx);
      return [`((project_id IS NOT NULL AND ${iw}) OR (project_id IS NULL AND request_id IS NOT NULL AND ${rw}))`, [...ip, ...rp]];
    },
  },

  // QA
  test_rounds: {
    read: (ctx) => internalProject(ctx),
    insert: (ctx, r) => canQa(ctx, pid(r)),
    update: async (ctx, o) => (await canQa(ctx, pid(o))) || o.tester_id === ctx.uid,
    check: (ctx, n) => canViewInternal(ctx, pid(n)),
    delete: async (ctx, o) => (await manage(ctx, o)) || (o.created_by === ctx.uid && o.status === 'planned'),
  },
  bugs: {
    read: (ctx) => internalProject(ctx),
    update: async (ctx, o) => (await canViewInternal(ctx, pid(o)))
      && (o.reporter_id === ctx.uid || o.assigned_dev_id === ctx.uid || (await canQa(ctx, pid(o)))),
    check: (ctx, n) => canViewInternal(ctx, pid(n)),
  },
  bug_fixes: {
    read: (ctx) => internalProject(ctx),
    update: async (ctx, o) => o.fix_owner_id === ctx.uid || (await manage(ctx, o)),
    check: (ctx, n) => canViewInternal(ctx, pid(n)),
  },
  retests: { read: (ctx) => internalProject(ctx) },

  // Checklist names are visible with the project; managed by the leader
  evidence_requirements: { read: (ctx) => visibleProject(ctx), insert: manage, update: manage, check: manage, delete: manage },
  baseline_revisions: { read: (ctx) => visibleProject(ctx) },

  // Workforce plan: staff see the team; own or Supervisor / Manager edit
  workforce_plans: {
    read: (ctx) => (isStaff(ctx) ? all : ['user_id = ?', [ctx.uid]]),
    insert: (ctx, r) => r.user_id === ctx.uid || hasRole(ctx, 'supervisor') || hasRole(ctx, 'manager'),
    update: (ctx, o) => o.user_id === ctx.uid || hasRole(ctx, 'supervisor') || hasRole(ctx, 'manager'),
    check: (ctx, n) => n.user_id === ctx.uid || hasRole(ctx, 'supervisor') || hasRole(ctx, 'manager'),
    delete: (ctx, o) => o.user_id === ctx.uid || hasRole(ctx, 'supervisor') || hasRole(ctx, 'manager'),
  },
  project_kpi_snapshots: { read: (ctx) => visibleProject(ctx) },
};

/** Single-row visibility checks used outside list queries (file download etc.) */
export async function canReadEvidence(ctx: Ctx, e: Row) {
  if (e.project_id) return (await canViewInternal(ctx, pid(e))) || (!e.is_internal && (await canViewProject(ctx, pid(e))));
  return !!e.request_id && canViewRequest(ctx, String(e.request_id));
}
