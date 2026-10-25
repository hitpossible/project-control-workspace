import type { Ctx, Row } from './db';
import {
  canManageProject, canPlanProject, canQa, canViewAllSkills, canViewInternal, canViewProject, canViewRequest, hasRole, idFilter, internalProjectIds, isAdmin, isProjectMember,
  isSkillAssessor, isStaff, requestFilter, visibleProjectIds,
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
const pid = (r: Row) => Number(r.project_id);
const admin = (ctx: Ctx) => isAdmin(ctx);
const masterData: Policy = { read: () => all, insert: admin, update: admin, check: admin, delete: admin };
const visibleProject = async (ctx: Ctx, col = 'project_id') => idFilter(col, await visibleProjectIds(ctx));
const internalProject = async (ctx: Ctx, col = 'project_id') => idFilter(col, await internalProjectIds(ctx));
const manage = (ctx: Ctx, r: Row) => canManageProject(ctx, pid(r));
const plan = (ctx: Ctx, r: Row) => canPlanProject(ctx, pid(r));

async function srsVisible(ctx: Ctx, col: string): Promise<Where> {
  const [w, p] = await visibleProject(ctx, 'project_id');
  return [`${col} IN (SELECT id FROM srs_documents WHERE ${w} UNION SELECT srs_id FROM srs_signers WHERE signer_id = ?)`, [...p, ctx.uid]];
}

function or(...parts: Where[]): Where {
  return [`(${parts.map((p) => `(${p[0]})`).join(' OR ')})`, parts.flatMap((p) => p[1])];
}

export const POLICIES: Record<string, Policy> = {
  // Profiles: directory readable by signed-in users; self-update basic info; admin all
  profiles: {
    read: () => all,
    update: (ctx, o) => o.id === ctx.uid || isAdmin(ctx),
    check: (ctx, n) => n.id === ctx.uid || isAdmin(ctx),
    hidden: ['password_hash', 'signature_path', 'session_version'],
    readonly: ['password_hash', 'session_version', 'last_login_at', 'created_at', 'signature_path', 'signature_updated_at'],
  },

  // Master data: read for all, write for admin
  app_settings: masterData,
  project_types: masterData,
  document_types: masterData,
  company_holidays: masterData,
  departments: masterData,
  sections: masterData,
  positions: masterData,
  project_templates: masterData,
  notification_rules: masterData,
  insight_rules: masterData,

  // Requests
  project_requests: {
    read: (ctx) => (isStaff(ctx) ? all : requestFilter(ctx, 'id')),
    insert: (ctx, r) => {
      r.requestor_id ??= ctx.uid;
      r.status ??= 'draft';
      return r.requestor_id === ctx.uid && r.status === 'draft';
    },
    update: (ctx, o) => o.requestor_id === ctx.uid && ['draft', 'need_more_information'].includes(String(o.status)),
    check: (ctx, n) => n.requestor_id === ctx.uid,
    delete: (ctx, o) => o.requestor_id === ctx.uid && o.status === 'draft' && o.request_no === null,
  },
  approval_steps: { read: (ctx) => (isStaff(ctx) ? all : or(requestFilter(ctx), ['approver_id = ? OR JSON_CONTAINS(approver_ids, CAST(? AS JSON))', [ctx.uid, String(ctx.uid)]])) },
  approval_actions: { read: (ctx) => requestFilter(ctx) },

  // Projects
  projects: {
    read: (ctx) => visibleProject(ctx, 'id'),
    update: (ctx, o) => canManageProject(ctx, Number(o.id)),
    check: (ctx, n) => canManageProject(ctx, Number(n.id)),
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

  // Design diagrams (flowchart / ER): the internal team draws them; saving and deleting go through
  // /api/diagrams/[id], which checks the version (no silent overwrites) and tells the other open editors
  project_diagrams: {
    read: (ctx) => internalProject(ctx),
    insert: async (ctx, r) => {
      r.created_by ??= ctx.uid;
      return r.created_by === ctx.uid && canViewInternal(ctx, pid(r));
    },
    readonly: ['created_by', 'created_at', 'updated_at'],
  },

  // SRS sign-off: with the project, plus the signers (who may be outside it); all writes go through src/server/srs.ts
  srs_documents: { read: (ctx) => srsVisible(ctx, 'id'), hidden: ['original_path', 'stamped_path'] },
  srs_signers: { read: (ctx) => srsVisible(ctx, 'srs_id'), hidden: ['signature_path', 'name_image_path'] },
  srs_fields: { read: (ctx) => srsVisible(ctx, 'srs_id') },

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
  // Skill matrix: levels are personal — own row, or assessors / Project Leaders. Self vs verified level rules: hooks.ts
  skills: { read: () => all, insert: isSkillAssessor, update: isSkillAssessor, check: isSkillAssessor, delete: isSkillAssessor },
  profile_skills: {
    read: (ctx) => (canViewAllSkills(ctx) ? all : ['user_id = ?', [ctx.uid]]),
    insert: (ctx, r) => r.user_id === ctx.uid || isSkillAssessor(ctx),
    update: (ctx, o) => o.user_id === ctx.uid || isSkillAssessor(ctx),
    check: (ctx, n) => n.user_id === ctx.uid || isSkillAssessor(ctx),
    delete: (ctx, o) => isSkillAssessor(ctx) || (o.user_id === ctx.uid && o.verified_level === null),
    readonly: ['verified_by', 'verified_at', 'updated_at'],
  },
  // the leader, or a Supervisor / Manager staffing the project
  project_skill_requirements: { read: (ctx) => internalProject(ctx), insert: plan, update: plan, check: plan, delete: plan },
  // working requirement summary (internal); content is normalised and the editor stamped in hooks.ts
  project_requirement_summaries: {
    read: (ctx) => internalProject(ctx), insert: plan, update: plan, check: plan, delete: plan,
    readonly: ['created_by', 'created_at', 'updated_by', 'updated_at'],
  },

  project_kpi_snapshots: { read: (ctx) => visibleProject(ctx) },

  // Comments on internal Tasks / Bugs: internal team reads and writes; authors edit their own
  comments: {
    read: (ctx) => internalProject(ctx),
    insert: async (ctx, r) => {
      r.created_by ??= ctx.uid;
      return r.created_by === ctx.uid && !!r.project_id && canViewInternal(ctx, pid(r));
    },
    update: (ctx, o) => o.created_by === ctx.uid,
    check: (ctx, n) => n.created_by === ctx.uid,
    delete: async (ctx, o) => o.created_by === ctx.uid || isAdmin(ctx) || (await manage(ctx, o)),
    readonly: ['created_by', 'created_at', 'edited_at'],
  },
};

/** Single-row visibility checks used outside list queries (file download etc.) */
export async function canReadEvidence(ctx: Ctx, e: Row) {
  if (e.project_id) return (await canViewInternal(ctx, pid(e))) || (!e.is_internal && (await canViewProject(ctx, pid(e))));
  return !!e.request_id && canViewRequest(ctx, Number(e.request_id));
}
