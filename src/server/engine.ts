import { AppError, type Ctx, type Row, uuid } from './db';
import { HOOKS } from './hooks';
import { dbValues, qi, tableMeta, toDb } from './schema';

/**
 * Single write path for every table (data API, workflow functions, scheduler, seed).
 * Replaces the Postgres BEFORE/AFTER triggers: defaults → before hook → write → audit → after hook.
 */

/** Columns defaulting to the acting user (was `default auth.uid()`) */
const ME_DEFAULTS: Record<string, string[]> = {
  project_requests: ['requestor_id'],
  approval_actions: ['action_by'],
  projects: ['created_by'],
  project_baselines: ['created_by'],
  internal_tasks: ['created_by'],
  evidence: ['uploaded_by'],
  test_rounds: ['created_by'],
  bugs: ['reporter_id'],
  evidence_requirements: ['created_by'],
  baseline_revisions: ['requested_by'],
  workforce_plans: ['created_by'],
};

/** JSON columns cannot have DB defaults in MySQL 5.7 */
const JSON_DEFAULTS: Record<string, Row> = {
  profiles: { roles: ['requestor'] },
  project_templates: { default_activities: [], evidence_checklist: [] },
  baseline_revisions: { plan_snapshot: [] },
  notification_rules: { recipient_roles: ['explicit'], channels: ['in_app', 'email'], escalate_roles: [] },
};

/** updated_at / updated_by maintained on update (was touch_updated) */
const TOUCH = new Set(['project_requests', 'projects', 'activities', 'internal_tasks', 'test_rounds', 'bugs']);

/** Audit trail: tracked fields per table and which operations are logged (was audit_changes) */
const AUDIT: Record<string, { ops: ('insert' | 'update' | 'delete')[]; fields: string[] }> = {
  project_requests: { ops: ['insert', 'update'], fields: ['status', 'project_name', 'date_required', 'priority', 'requestor_approver_id', 'authority_approver_id', 'proposed_leader_id'] },
  projects: { ops: ['insert', 'update'], fields: ['status', 'leader_id', 'start_date', 'target_date', 'forecast_date', 'progress', 'health', 'next_action', 'priority', 'baseline_version', 'remark'] },
  activities: { ops: ['insert', 'update', 'delete'], fields: ['name', 'status', 'pic_user_id', 'pic_label', 'plan_start', 'plan_finish', 'actual_start', 'actual_finish', 'forecast_finish', 'progress', 'delay_category', 'delay_reason', 'delay_impact', 'recovery_plan', 'recovery_owner_id', 'recovery_due_date', 'recovery_reviewed_by', 'next_action'] },
  internal_tasks: { ops: ['insert', 'update', 'delete'], fields: ['name', 'status', 'owner_id', 'reviewer_id', 'planned_start', 'due_date', 'actual_start', 'actual_finish', 'progress', 'delay_category', 'delay_reason', 'recovery_action'] },
  project_members: { ops: ['insert', 'delete'], fields: [] },
  evidence: { ops: ['insert', 'update', 'delete'], fields: ['verification_status', 'description'] },
  project_baselines: { ops: ['insert'], fields: [] },
  test_rounds: { ops: ['insert', 'update', 'delete'], fields: ['status', 'result', 'tester_id', 'due_date', 'actual_date', 'summary'] },
  bugs: { ops: ['insert', 'update', 'delete'], fields: ['status', 'severity', 'priority', 'assigned_dev_id', 'due_date', 'root_cause', 'reopen_count'] },
  bug_fixes: { ops: ['insert', 'update'], fields: ['status', 'fix_owner_id', 'fix_due_date', 'fix_description', 'build_link', 'commit_link'] },
  retests: { ops: ['insert', 'update'], fields: ['status', 'result', 'tester_id', 'due_date'] },
  evidence_requirements: { ops: ['insert', 'delete'], fields: [] },
  baseline_revisions: { ops: ['insert', 'update'], fields: ['status', 'decided_by', 'decision_comment'] },
  workforce_plans: { ops: ['insert', 'update', 'delete'], fields: ['work_type', 'work_date', 'project_id', 'start_time', 'end_time'] },
};

const str = (v: unknown) => (v === null || v === undefined ? null : typeof v === 'object' ? JSON.stringify(v) : String(v));

function auditLabel(r: Row): string | null {
  if (r.bug_no != null && r.title != null) return `${r.bug_no} ${r.title}`;
  for (const k of ['title', 'name', 'project_name', 'file_name', 'url', 'member_role', 'version_no']) if (r[k] != null) return String(r[k]);
  if (r.fix_cycle != null) return `cycle ${r.fix_cycle}`;
  if (r.retest_round != null) return `round ${r.retest_round}`;
  return str(r.reason);
}

async function audit(ctx: Ctx, table: string, op: 'insert' | 'update' | 'delete', row: Row, old?: Row) {
  const cfg = AUDIT[table];
  if (!cfg || !cfg.ops.includes(op)) return;
  const projectId = table === 'projects' ? row.id : row.project_id ?? null;
  const requestId = table === 'project_requests' ? row.id : row.request_id ?? null;
  const base = [table, str(row.id), projectId, requestId];
  if (op === 'insert') {
    await ctx.exec('INSERT INTO audit_logs(table_name, entity_id, project_id, request_id, action, new_value, user_id) VALUES (?,?,?,?,?,?,?)',
      [...base, 'insert', auditLabel(row), ctx.uid]);
  } else if (op === 'delete') {
    await ctx.exec('INSERT INTO audit_logs(table_name, entity_id, project_id, request_id, action, old_value, user_id) VALUES (?,?,?,?,?,?,?)',
      [...base, 'delete', auditLabel(row), ctx.uid]);
  } else {
    for (const f of cfg.fields) {
      if (str(old?.[f]) !== str(row[f])) {
        await ctx.exec('INSERT INTO audit_logs(table_name, entity_id, project_id, request_id, action, field, old_value, new_value, user_id) VALUES (?,?,?,?,?,?,?,?,?)',
          [...base, 'update', f, str(old?.[f]), str(row[f]), ctx.uid]);
      }
    }
  }
}

/** run cascaded work one level deeper (was pg_trigger_depth) */
export async function nested<T>(ctx: Ctx, fn: () => Promise<T>): Promise<T> {
  ctx.depth++;
  try {
    return await fn();
  } finally {
    ctx.depth--;
  }
}

function friendlyDbError(e: unknown): never {
  const err = e as { code?: string; sqlMessage?: string; message?: string };
  if (err.code === 'ER_DUP_ENTRY') throw new AppError('Duplicate value: this record already exists', 409);
  if (err.code === 'ER_NO_REFERENCED_ROW_2') throw new AppError('Referenced record does not exist');
  if (err.code === 'ER_ROW_IS_REFERENCED_2') throw new AppError('Record is still referenced by other data and cannot be deleted', 409);
  if (err.code === 'WARN_DATA_TRUNCATED' || err.code === 'ER_TRUNCATED_WRONG_VALUE_FOR_FIELD' || err.code === 'ER_WRONG_VALUE_FOR_TYPE')
    throw new AppError(`Invalid value: ${err.sqlMessage ?? err.message}`);
  if (err.code === 'ER_BAD_NULL_ERROR' || err.code === 'ER_NO_DEFAULT_FOR_FIELD') throw new AppError(`Required value missing: ${err.sqlMessage ?? err.message}`);
  throw e;
}

export async function getRow(ctx: Ctx, table: string, pk: unknown, lock = false): Promise<Row | null> {
  const meta = await tableMeta(ctx, table);
  return ctx.one(`SELECT * FROM ${qi(table)} WHERE ${qi(meta.pk)} = ?${lock ? ' FOR UPDATE' : ''}`, [pk]);
}

export async function insertRow(ctx: Ctx, table: string, input: Row): Promise<Row> {
  const meta = await tableMeta(ctx, table);
  const row: Row = { ...JSON_DEFAULTS[table] };
  for (const [k, v] of Object.entries(input)) if (v !== undefined && meta.columns.has(k)) row[k] = v;
  if (!meta.autoPk && meta.pk === 'id' && !row.id) row.id = uuid();
  for (const c of ME_DEFAULTS[table] ?? []) if (row[c] === undefined) row[c] = ctx.uid;

  await HOOKS[table]?.beforeInsert?.(ctx, row);

  const vals = dbValues(meta, row);
  const cols = Object.keys(vals);
  let res;
  try {
    res = await ctx.exec(`INSERT INTO ${qi(table)} (${cols.map(qi).join(',')}) VALUES (${cols.map(() => '?').join(',')})`, Object.values(vals));
  } catch (e) {
    friendlyDbError(e);
  }
  const pk = meta.autoPk ? res.insertId : row[meta.pk];
  const full = (await getRow(ctx, table, pk))!;

  await audit(ctx, table, 'insert', full);
  await nested(ctx, async () => HOOKS[table]?.afterInsert?.(ctx, full));
  return full;
}

export async function updateRow(ctx: Ctx, table: string, pk: unknown, patch: Row): Promise<Row | null> {
  const meta = await tableMeta(ctx, table);
  const old = await getRow(ctx, table, pk, true);
  if (!old) return null;
  const next: Row = { ...old };
  for (const [k, v] of Object.entries(patch)) if (v !== undefined && meta.columns.has(k) && k !== meta.pk) next[k] = v;
  if (TOUCH.has(table)) {
    next.updated_at = new Date().toISOString();
    next.updated_by = ctx.uid ?? next.updated_by;
  }

  await HOOKS[table]?.beforeUpdate?.(ctx, next, old);

  const changed: Row = {};
  for (const [k, kind] of meta.columns) {
    if (k === meta.pk) continue;
    const a = toDb(kind, old[k]);
    const b = toDb(kind, next[k]);
    if (str(a) !== str(b)) changed[k] = b;
  }
  const meaningful = Object.keys(changed).some((k) => k !== 'updated_at' && k !== 'updated_by');
  if (!meaningful) return old;

  try {
    await ctx.exec(`UPDATE ${qi(table)} SET ${Object.keys(changed).map((k) => `${qi(k)} = ?`).join(', ')} WHERE ${qi(meta.pk)} = ?`,
      [...Object.values(changed), pk]);
  } catch (e) {
    friendlyDbError(e);
  }
  const full = (await getRow(ctx, table, pk))!;
  await audit(ctx, table, 'update', full, old);
  await nested(ctx, async () => HOOKS[table]?.afterUpdate?.(ctx, full, old));
  return full;
}

export async function deleteRow(ctx: Ctx, table: string, pk: unknown): Promise<Row | null> {
  const meta = await tableMeta(ctx, table);
  const old = await getRow(ctx, table, pk, true);
  if (!old) return null;
  await HOOKS[table]?.beforeDelete?.(ctx, old);
  try {
    await ctx.exec(`DELETE FROM ${qi(table)} WHERE ${qi(meta.pk)} = ?`, [pk]);
  } catch (e) {
    friendlyDbError(e);
  }
  await audit(ctx, table, 'delete', old);
  await nested(ctx, async () => HOOKS[table]?.afterDelete?.(ctx, old));
  return old;
}
