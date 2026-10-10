import { AppError, type Ctx, type Row } from './db';
import { notifyEvent, fmtD, nextSequence } from './logic/common';
import {
  activityBeforeWrite, applyTemplateChecklist, missingEvidence, openCriticalBugs, recomputeProject, rollupFromActivity, rollupFromTask, taskBeforeWrite,
} from './logic/project';
import { isAdmin } from './perms';
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
    event: 'task_assigned', projectId: String(t.project_id), explicit: [String(t.owner_id)],
    title: `Task assigned: ${t.task_no} ${t.name}`, body: `Project ${code} — due ${fmtD(t.due_date as string)}`,
    link: `/projects/${t.project_id}?tab=internal&task=${t.id}`,
  });
}

async function evidenceRecompute(ctx: Ctx, r: Row) {
  if (r.project_id && ctx.depth <= 8) await recomputeProject(ctx, String(r.project_id));
}

export const HOOKS: Record<string, Hooks> = {
  profiles: {
    beforeUpdate(ctx, n, o) {
      if (!ctx.bypass && !isAdmin(ctx) && changed(n, o, 'roles', 'is_active', 'username', 'password_hash')) {
        throw new AppError('Only administrators can change roles, login or activation', 403);
      }
    },
  },

  project_requests: {
    beforeInsert(ctx, r) {
      r.status ??= 'draft';
    },
    beforeUpdate(ctx, n, o) {
      if (ctx.bypass) return;
      if (changed(n, o, 'status', 'request_no', 'date_submitted', 'submitted_at', 'project_id', 'requestor_id', 'reviewed_by')) {
        throw new AppError('Protected request fields can only be changed through the approval workflow', 403);
      }
      if (!['draft', 'need_more_information'].includes(String(o.status))) {
        throw new AppError(`Request ${o.request_no ?? o.id} is locked (status: ${o.status})`, 409);
      }
    },
    async afterUpdate(ctx, r, o) {
      if (r.status === 'converted' && o.status !== 'converted' && r.project_id) await applyTemplateChecklist(ctx, String(r.project_id));
    },
  },

  projects: {
    async beforeUpdate(ctx, n, o) {
      if (ctx.bypass) return;
      if (changed(n, o, 'project_code', 'request_id', 'baseline_version')) {
        throw new AppError('Project code, request reference and baseline version are system controlled', 403);
      }
      if (n.status === 'completed' && o.status !== 'completed') {
        const open = await ctx.val(`SELECT 1 FROM activities WHERE project_id = ? AND status NOT IN ('completed','cancelled') LIMIT 1`, [n.id]);
        if (open) throw new AppError('All activities must be completed or cancelled before completing the project');
        const missing = await missingEvidence(ctx, 'project', String(n.id));
        if (missing.length) throw new AppError(`Mandatory project evidence missing: ${missing.join(', ')}`);
        const crit = await openCriticalBugs(ctx, String(n.id));
        if (crit > 0) throw new AppError(`${crit} critical bug(s) still open — close them before completing the project`);
      }
    },
    async afterUpdate(ctx, p, o) {
      // Project Need Attention when health turns red
      if (p.health === 'red' && o.health !== 'red') {
        await notifyEvent(ctx, {
          event: 'project_need_attention', projectId: String(p.id), explicit: [p.leader_id as string | null],
          title: `Project needs attention: ${p.project_code}`,
          body: `${p.project_name} — health turned RED. Forecast ${fmtD(p.forecast_date as string)}, target ${fmtD(p.target_date as string)}.`,
          link: `/projects/${p.id}`, dedupe: `need_attention:${p.id}:${ctx.today}`,
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
};
