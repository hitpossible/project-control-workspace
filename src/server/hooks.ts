import { AppError, type Ctx, type Row } from './db';
import { commentHooks } from './logic/comments';
import { notifyEvent, fmtD, nextSequence } from './logic/common';
import {
  activityBeforeWrite, applyTemplateChecklist, assertCanComplete, recomputeProject, rollupFromActivity, rollupFromTask, taskBeforeWrite,
} from './logic/project';
import { normalizeDefinition } from '@/lib/definition';
import { isAdmin, isSkillAssessor } from './perms';
import { removeObject } from './storage';

/** Per-table trigger logic (ported from the Postgres triggers). `ctx.bypass` = workflow code. */
export type Hooks = {
  beforeInsert?: (ctx: Ctx, row: Row) => Promise<void> | void;
  beforeUpdate?: (ctx: Ctx, next: Row, old: Row) => Promise<void> | void;
  beforeDelete?: (ctx: Ctx, old: Row) => Promise<void> | void;
  afterInsert?: (ctx: Ctx, row: Row) => Promise<void> | void;
  afterUpdate?: (ctx: Ctx, row: Row, old: Row) => Promise<void> | void;
  afterDelete?: (ctx: Ctx, old: Row) => Promise<void> | void;
};

const changed = (a: Row, b: Row, ...cols: string[]) => cols.some((c) => JSON.stringify(a[c] ?? null) !== JSON.stringify(b[c] ?? null));

async function onTaskAssigned(ctx: Ctx, t: Row) {
  if (t.owner_id === ctx.uid) return;
  const code = await ctx.val<string>('SELECT project_code FROM projects WHERE id = ?', [t.project_id]);
  await notifyEvent(ctx, {
    event: 'task_assigned', projectId: Number(t.project_id), explicit: [Number(t.owner_id)],
    title: `Task assigned: ${t.task_no} ${t.name}`, body: `Project ${code} — due ${fmtD(t.due_date as string)}`,
    link: `/projects/${t.project_id}?tab=internal&task=${t.id}`,
  });
}

async function evidenceRecompute(ctx: Ctx, r: Row) {
  if (r.project_id && ctx.depth <= 8) await recomputeProject(ctx, Number(r.project_id));
}

/** A checklist item an SRS is signed for is satisfied only by the signed SRS, never by an uploaded file */
async function srsOnlyRequirement(ctx: Ctx, n: Row, o: Row | null) {
  if (ctx.bypass || !n.requirement_id || (o && o.requirement_id === n.requirement_id)) return;
  if (await ctx.val(`SELECT 1 FROM srs_documents WHERE requirement_id = ? AND status <> 'cancelled' LIMIT 1`, [n.requirement_id])) {
    throw new AppError('This checklist item is completed by signing the SRS in the system (SRS tab)', 409);
  }
}

/** Requestor Information always comes from the signed-in user's profile (only the requestor writes a draft) */
const requestorInfo = (ctx: Ctx): Row => ({
  req_employee_id: ctx.me?.employee_id ?? null,
  req_full_name: ctx.me?.full_name ?? null,
  req_department: ctx.me?.department ?? null,
  req_section: ctx.me?.section ?? null,
  req_email: ctx.me?.email ?? null,
  req_telephone: ctx.me?.telephone ?? null,
  req_extension: ctx.me?.extension ?? null,
});

/** MySQL 5.7 ignores CHECK constraints — levels and weights are 1–5 */
function oneToFive(r: Row, cols: string[], nullable = false) {
  for (const c of cols) {
    const v = r[c];
    if (v == null && nullable) continue;
    if (!Number.isInteger(Number(v)) || Number(v) < 1 || Number(v) > 5) throw new AppError(`${c} must be 1–5`, 400);
  }
}

/** Only the person sets their self-assessment; only a Supervisor / Manager sets (and is recorded against) the verified level */
function skillLevelRules(ctx: Ctx, n: Row, o: Row | null) {
  oneToFive(n, ['self_level', 'verified_level'], true);
  if (ctx.bypass) return;
  if (o && changed(n, o, 'user_id', 'skill_id')) throw new AppError('A skill level cannot be moved to another person or skill', 400);
  if (changed(n, o ?? {}, 'self_level') && n.user_id !== ctx.uid) throw new AppError('Only the person can change their own self-assessment', 403);
  if (changed(n, o ?? {}, 'verified_level')) {
    if (!isSkillAssessor(ctx)) throw new AppError('Only a Supervisor or Manager can verify a skill level', 403);
    n.verified_by = n.verified_level == null ? null : ctx.uid;
    n.verified_at = n.verified_level == null ? null : new Date().toISOString();
  }
}

export const HOOKS: Record<string, Hooks> = {
  profiles: {
    beforeUpdate(ctx, n, o) {
      if (!ctx.bypass && !isAdmin(ctx) && changed(n, o, 'roles', 'is_active', 'username', 'password_hash', 'department_id', 'section_id', 'position_id')) {
        throw new AppError('Only administrators can change roles, position, department, login or activation', 403);
      }
    },
  },

  project_requests: {
    async beforeInsert(ctx, r) {
      r.status ??= 'draft';
      if (ctx.bypass) return;
      Object.assign(r, requestorInfo(ctx));
      if (!(await ctx.val('SELECT 1 FROM document_types WHERE id = ? AND is_active = 1', [r.document_type_id ?? null]))) {
        throw new AppError('Choose an active document type for the request');
      }
    },
    beforeUpdate(ctx, n, o) {
      if (ctx.bypass) return;
      Object.assign(n, requestorInfo(ctx));
      if (changed(n, o, 'status', 'request_no', 'date_submitted', 'submitted_at', 'project_id', 'requestor_id', 'reviewed_by', 'estimated_md')) {
        throw new AppError('Protected request fields can only be changed through the approval workflow', 403);
      }
      // The request number belongs to the document type's running number
      if (Number(n.document_type_id) !== Number(o.document_type_id)) throw new AppError('The document type of a request cannot be changed', 403);
      if (!['draft', 'need_more_information'].includes(String(o.status))) {
        throw new AppError(`Request ${o.request_no ?? o.id} is locked (status: ${o.status})`, 409);
      }
    },
    async afterUpdate(ctx, r, o) {
      if (r.status === 'converted' && o.status !== 'converted' && r.project_id) await applyTemplateChecklist(ctx, Number(r.project_id));
    },
  },

  projects: {
    async beforeUpdate(ctx, n, o) {
      if (ctx.bypass) return;
      if (changed(n, o, 'project_code', 'request_id', 'baseline_version')) {
        throw new AppError('Project code, request reference and baseline version are system controlled', 403);
      }
      if (n.status === 'completed' && o.status !== 'completed') {
        // a project from a request is completed only when the requestor accepts the closure (rpc/closure.ts)
        if (n.request_id) throw new AppError('This project is completed when the requestor accepts the delivery — send it for acceptance (Close project)', 409);
        await assertCanComplete(ctx, Number(n.id));
      }
    },
    async afterUpdate(ctx, p, o) {
      // Project Need Attention when health turns red
      if (p.health === 'red' && o.health !== 'red') {
        await notifyEvent(ctx, {
          event: 'project_need_attention', projectId: Number(p.id), explicit: [p.leader_id as number | null],
          title: `Project needs attention: ${p.project_code}`,
          body: `${p.project_name} — health turned RED. Forecast ${fmtD(p.forecast_date as string)}, target ${fmtD(p.target_date as string)}.`,
          link: `/projects/${p.id}`, dedupe: `need_attention:${p.id}:${ctx.today}`,
        });
      }
      // a closure still waiting for acceptance is moot once the project is cancelled
      if (p.status === 'cancelled' && o.status !== 'cancelled') {
        await ctx.exec(`UPDATE project_closures SET status = 'withdrawn' WHERE project_id = ? AND status = 'pending'`, [p.id]);
        await ctx.exec(`UPDATE change_requests SET status = 'withdrawn' WHERE project_id = ? AND status IN ('submitted','assessed','agreed')`, [p.id]);
      }
      // Project closed / cancelled → requestor + team (no dedupe: a reopened project may close again)
      if ((p.status === 'completed' || p.status === 'cancelled') && o.status !== p.status) {
        const requestor = p.request_id
          ? await ctx.val<number>('SELECT requestor_id FROM project_requests WHERE id = ?', [p.request_id])
          : null;
        const done = p.status === 'completed';
        const prev = String(o.remark ?? '');
        const added = String(p.remark ?? '').startsWith(prev) ? String(p.remark ?? '').slice(prev.length).trim() : '';
        await notifyEvent(ctx, {
          event: done ? 'project_completed' : 'project_cancelled',
          projectId: Number(p.id), requestId: (p.request_id as number | null) ?? null, explicit: [requestor],
          title: `${done ? 'Project completed' : 'Project cancelled'}: ${p.project_code}`,
          body: done
            ? `${p.project_name} has been closed as completed on ${fmtD(ctx.today)}.`
            : `${p.project_name} has been cancelled.${added ? `\n${added}` : ''}`,
          link: `/projects/${p.id}`,
        });
      }
    },
  },

  activities: {
    beforeInsert: (ctx, r) => activityBeforeWrite(ctx, r, null),
    beforeUpdate: (ctx, n, o) => activityBeforeWrite(ctx, n, o),
    afterInsert: (ctx, r) => rollupFromActivity(ctx, r, null, 'insert'),
    afterUpdate: (ctx, r, o) => rollupFromActivity(ctx, r, o, 'update'),
    afterDelete: (ctx, o) => rollupFromActivity(ctx, o, null, 'delete'),
  },

  internal_tasks: {
    async beforeInsert(ctx, t) {
      if (!t.task_no) t.task_no = `T-${String(await nextSequence(ctx, `task:${t.project_id}`)).padStart(4, '0')}`;
      if (t.parent_task_id) {
        const act = await ctx.val<string>('SELECT activity_id FROM internal_tasks WHERE id = ?', [t.parent_task_id]);
        if (act) t.activity_id = act;
      }
      await taskBeforeWrite(ctx, t, null);
    },
    beforeUpdate: (ctx, n, o) => taskBeforeWrite(ctx, n, o),
    async afterInsert(ctx, t) {
      await onTaskAssigned(ctx, t);
      await rollupFromTask(ctx, t);
    },
    async afterUpdate(ctx, t, o) {
      if (t.owner_id !== o.owner_id) await onTaskAssigned(ctx, t);
      if (changed(t, o, 'progress', 'status', 'parent_task_id', 'activity_id')) await rollupFromTask(ctx, t);
    },
    afterDelete: (ctx, o) => rollupFromTask(ctx, o),
  },

  evidence: {
    beforeInsert: (ctx, r) => srsOnlyRequirement(ctx, r, null),
    beforeUpdate: (ctx, n, o) => srsOnlyRequirement(ctx, n, o),
    afterInsert: evidenceRecompute,
    async afterUpdate(ctx, r, o) {
      if (changed(r, o, 'verification_status', 'requirement_id')) await evidenceRecompute(ctx, r);
    },
    async afterDelete(ctx, o) {
      if (o.storage_path) ctx.onCommit(() => removeObject(String(o.storage_path)));
      await evidenceRecompute(ctx, o);
    },
  },

  test_rounds: {
    async beforeInsert(ctx, r) {
      if (r.round_no == null) {
        r.round_no = Number(await ctx.val('SELECT COALESCE(MAX(round_no), 0) + 1 FROM test_rounds WHERE project_id = ?', [r.project_id]));
      }
    },
  },

  bugs: {
    beforeUpdate(ctx, n, o) {
      if (ctx.bypass) return;
      if (changed(n, o, 'status', 'bug_no', 'reopen_count', 'closed_at', 'assigned_dev_id', 'project_id')) {
        throw new AppError('Bug status and assignment change only through the bug workflow actions', 403);
      }
    },
  },

  comments: commentHooks,

  profile_skills: {
    beforeInsert: (ctx, r) => skillLevelRules(ctx, r, null),
    beforeUpdate: (ctx, n, o) => skillLevelRules(ctx, n, o),
  },
  project_definitions: {
    beforeInsert(ctx, r) {
      r.content = normalizeDefinition(r.content);
      r.created_by = ctx.uid;
      r.updated_by = ctx.uid;
    },
    beforeUpdate(ctx, n, o) {
      if (changed(n, o, 'project_id')) throw new AppError('A project definition cannot be moved to another project', 400);
      n.content = normalizeDefinition(n.content);
      n.updated_by = ctx.uid;
    },
  },
  project_skill_requirements: {
    beforeInsert: (_ctx, r) => oneToFive({ required_level: 3, weight: 3, ...r }, ['required_level', 'weight']),
    beforeUpdate: (_ctx, n) => oneToFive(n, ['required_level', 'weight']),
  },
};
