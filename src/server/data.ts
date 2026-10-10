import type { DataFilter, DataQuery } from '@/lib/db/protocol';
import { AppError, type Ctx, type Row } from './db';
import { deleteRow, getRow, insertRow, updateRow } from './engine';
import { POLICIES, type Policy, type Where } from './policies';
import { qi, tableMeta, toDb } from './schema';
import { loadProjectsView } from './views';

/**
 * Generic data endpoint behind db.from(table)… in the browser (replaces PostgREST).
 * Every statement is restricted by the table policy; writes go through the engine (hooks / audit).
 */

/** many-to-one embeds: select('*, projects(project_code)') resolves via these FK columns */
const REL_FK: Record<string, string> = {
  projects: 'project_id', activities: 'activity_id', bugs: 'bug_id', project_requests: 'request_id', test_rounds: 'test_round_id', internal_tasks: 'task_id',
};
const VIRTUAL: Record<string, (ctx: Ctx) => Promise<Row[]>> = { v_projects: loadProjectsView };

type Sel = { cols: string[] | '*'; embeds: { rel: string; cols: string[] | '*' }[] };

function parseSelect(s: string | undefined): Sel {
  const out: Sel = { cols: [], embeds: [] };
  const parts: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of s ?? '*') {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; } else cur += ch;
  }
  parts.push(cur);
  const cols: string[] = [];
  let star = false;
  for (const raw of parts.map((p) => p.trim()).filter(Boolean)) {
    const m = /^(\w+)\s*\((.*)\)$/.exec(raw);
    if (m) {
      const inner = m[2].split(',').map((c) => c.trim()).filter(Boolean);
      out.embeds.push({ rel: m[1], cols: inner.includes('*') || !inner.length ? '*' : inner });
    } else if (raw === '*') star = true;
    else cols.push(raw);
  }
  out.cols = star || (!cols.length && !out.embeds.length) ? '*' : cols;
  if (!star && !cols.length && out.embeds.length) out.cols = '*';
  return out;
}

function policyOf(table: string): Policy {
  const p = POLICIES[table];
  if (!p) throw new AppError(`Table ${table} is not available`, 403);
  return p;
}

/** system jobs / scripts (ctx.me === null) are not restricted, like the former service role */
const system = (ctx: Ctx) => ctx.me === null;

async function readWhere(ctx: Ctx, table: string): Promise<Where> {
  const policy = policyOf(table);
  if (system(ctx)) return ['1=1', []];
  const w = await policy.read(ctx);
  if (w === false) throw new AppError('Not allowed', 403);
  return w;
}

// ---------------------------------------------------------------------
// SQL filters
// ---------------------------------------------------------------------
async function whereSql(ctx: Ctx, table: string, filters: DataFilter[]): Promise<Where> {
  const meta = await tableMeta(ctx, table);
  const col = (c: string) => {
    if (!meta.columns.has(c)) throw new AppError(`Unknown column ${table}.${c}`);
    return qi(c);
  };
  const val = (c: string, v: unknown) => toDb(meta.columns.get(c), v);
  const parts: string[] = [];
  const params: unknown[] = [];
  const cond = (f: DataFilter): string => {
    switch (f.op) {
      case 'eq': case 'neq': case 'gt': case 'gte': case 'lt': case 'lte': {
        const sym = { eq: '=', neq: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=' }[f.op];
        params.push(val(f.col, f.value));
        return `${col(f.col)} ${sym} ?`;
      }
      case 'in': case 'not_in': {
        const vals = (f.value as unknown[]) ?? [];
        if (!vals.length) return f.op === 'in' ? '1=0' : '1=1';
        params.push(...vals.map((v) => val(f.col, v)));
        return `${col(f.col)} ${f.op === 'in' ? 'IN' : 'NOT IN'} (${vals.map(() => '?').join(',')})`;
      }
      case 'is': case 'not_is': {
        const v = f.value === null ? 'NULL' : f.value ? 'TRUE' : 'FALSE';
        return `${col(f.col)} IS ${f.op === 'not_is' ? 'NOT ' : ''}${v}`;
      }
      case 'or':
        return `(${(f.value as DataFilter[]).map(cond).join(' OR ')})`;
      default:
        throw new AppError(`Unsupported filter ${(f as DataFilter).op}`);
    }
  };
  for (const f of filters) parts.push(cond(f));
  return [parts.length ? parts.join(' AND ') : '1=1', params];
}

/** In-memory filter for virtual tables */
function matches(row: Row, f: DataFilter): boolean {
  const v = f.col ? row[f.col] : undefined;
  const cmp = (a: unknown, b: unknown) => (a === null || a === undefined ? NaN : String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0);
  switch (f.op) {
    case 'eq': return String(v) === String(f.value);
    case 'neq': return v !== null && String(v) !== String(f.value);
    case 'gt': return cmp(v, f.value) > 0;
    case 'gte': return cmp(v, f.value) >= 0;
    case 'lt': return cmp(v, f.value) < 0;
    case 'lte': return cmp(v, f.value) <= 0;
    case 'in': return (f.value as unknown[]).map(String).includes(String(v));
    case 'not_in': return v !== null && !(f.value as unknown[]).map(String).includes(String(v));
    case 'is': return f.value === null ? v === null || v === undefined : v === f.value;
    case 'not_is': return f.value === null ? v !== null && v !== undefined : v !== f.value;
    case 'or': return (f.value as DataFilter[]).some((x) => matches(row, x));
  }
}

function project(row: Row, cols: string[] | '*', hidden: string[] = []): Row {
  if (cols === '*') {
    const out = { ...row };
    for (const h of hidden) delete out[h];
    return out;
  }
  const out: Row = {};
  for (const c of cols) if (!hidden.includes(c)) out[c] = row[c];
  return out;
}

// ---------------------------------------------------------------------
// SELECT
// ---------------------------------------------------------------------
async function select(ctx: Ctx, q: DataQuery): Promise<{ data: unknown; count?: number }> {
  const sel = parseSelect(q.columns);
  const virtual = VIRTUAL[q.table];
  let rows: Row[];
  let count: number | undefined;

  if (virtual) {
    rows = (await virtual(ctx)).filter((r) => (q.filters ?? []).every((f) => matches(r, f)));
    for (const o of [...(q.order ?? [])].reverse()) {
      rows.sort((a, b) => {
        const x = a[o.col];
        const y = b[o.col];
        if (x === y) return 0;
        if (x === null || x === undefined) return o.ascending === false ? -1 : 1;
        if (y === null || y === undefined) return o.ascending === false ? 1 : -1;
        return (String(x) < String(y) ? -1 : 1) * (o.ascending === false ? -1 : 1);
      });
    }
    count = rows.length;
    if (q.limit) rows = rows.slice(0, q.limit);
  } else {
    const meta = await tableMeta(ctx, q.table);
    const [pw, pp] = await readWhere(ctx, q.table);
    const [fw, fp] = await whereSql(ctx, q.table, q.filters ?? []);
    const where = `WHERE (${pw}) AND (${fw})`;
    if (q.count) count = Number(await ctx.val(`SELECT COUNT(*) FROM ${qi(q.table)} ${where}`, [...pp, ...fp]));
    if (q.head) return { data: null, count };
    if (sel.cols !== '*') for (const c of sel.cols) if (!meta.columns.has(c)) throw new AppError(`Unknown column ${q.table}.${c}`);
    const order = (q.order ?? []).map((o) => {
      if (!meta.columns.has(o.col)) throw new AppError(`Unknown column ${q.table}.${o.col}`);
      const desc = o.ascending === false;
      const nullsFirst = o.nullsFirst ?? desc; // Postgres default: NULLS LAST asc / NULLS FIRST desc
      return `(${qi(o.col)} IS NULL) ${nullsFirst ? 'DESC' : 'ASC'}, ${qi(o.col)} ${desc ? 'DESC' : 'ASC'}`;
    });
    rows = await ctx.q<Row>(`SELECT * FROM ${qi(q.table)} ${where}${order.length ? ` ORDER BY ${order.join(', ')}` : ''}${q.limit ? ` LIMIT ${Number(q.limit)}` : ''}`,
      [...pp, ...fp]);
  }

  const hidden = POLICIES[q.table]?.hidden ?? [];
  // embedded many-to-one relations (respecting the related table's policy)
  const embedded: Map<string, Map<string, Row>> = new Map();
  for (const e of sel.embeds) {
    const fk = REL_FK[e.rel];
    if (!fk) throw new AppError(`Unknown relation ${e.rel}`);
    const ids = [...new Set(rows.map((r) => r[fk]).filter(Boolean))] as string[];
    const found = ids.length
      ? (await select(ctx, { table: e.rel, action: 'select', columns: e.cols === '*' ? '*' : ['id', ...e.cols].join(','), filters: [{ op: 'in', col: 'id', value: ids }] })).data as Row[]
      : [];
    embedded.set(e.rel, new Map(found.map((r) => [String(r.id), r])));
  }
  const out = rows.map((r) => {
    const base = project(r, sel.cols, hidden);
    for (const e of sel.embeds) {
      const hit = embedded.get(e.rel)!.get(String(r[REL_FK[e.rel]]));
      base[e.rel] = hit ? project(hit, e.cols) : null;
    }
    return base;
  });
  return { data: out, count };
}

// ---------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------
async function cleanInput(ctx: Ctx, table: string, row: Row): Promise<Row> {
  const meta = await tableMeta(ctx, table);
  const ro = POLICIES[table]?.readonly ?? [];
  const out: Row = {};
  for (const [k, v] of Object.entries(row)) {
    if (!meta.columns.has(k)) throw new AppError(`Unknown column ${table}.${k}`);
    if (ro.includes(k)) continue;
    out[k] = v;
  }
  return out;
}

async function targets(ctx: Ctx, q: DataQuery): Promise<Row[]> {
  const meta = await tableMeta(ctx, q.table);
  const [pw, pp] = await readWhere(ctx, q.table);
  const [fw, fp] = await whereSql(ctx, q.table, q.filters ?? []);
  if (!(q.filters ?? []).length) throw new AppError('Update / delete requires a filter');
  return ctx.q<Row>(`SELECT * FROM ${qi(q.table)} WHERE (${pw}) AND (${fw}) ORDER BY ${qi(meta.pk)} FOR UPDATE`, [...pp, ...fp]);
}

async function doInsert(ctx: Ctx, table: string, input: Row): Promise<Row> {
  const policy = policyOf(table);
  const row = await cleanInput(ctx, table, input);
  if (!system(ctx) && (!policy.insert || !(await policy.insert(ctx, row)))) throw new AppError(`New row violates the access policy for ${table}`, 403);
  return insertRow(ctx, table, row);
}

async function doUpdate(ctx: Ctx, table: string, old: Row, patch: Row): Promise<Row | null> {
  const policy = policyOf(table);
  if (!system(ctx)) {
    if (!policy.update || !(await policy.update(ctx, old))) return null; // like RLS: invisible to the update
    if (policy.check && !(await policy.check(ctx, { ...old, ...patch }))) throw new AppError(`Updated row violates the access policy for ${table}`, 403);
  }
  const meta = await tableMeta(ctx, table);
  return updateRow(ctx, table, old[meta.pk], patch);
}

export async function runQuery(ctx: Ctx, q: DataQuery): Promise<{ data: unknown; count?: number }> {
  if (q.action === 'select') return select(ctx, q);
  if (VIRTUAL[q.table]) throw new AppError(`${q.table} is read-only`, 403);
  const meta = await tableMeta(ctx, q.table);
  const policy = policyOf(q.table);
  const hidden = policy.hidden ?? [];
  const values = Array.isArray(q.values) ? q.values : q.values ? [q.values] : [];
  let rows: Row[] = [];

  if (q.action === 'insert') {
    for (const v of values) rows.push(await doInsert(ctx, q.table, v));
  } else if (q.action === 'upsert') {
    const key = q.onConflict ?? meta.pk;
    for (const v of values) {
      const existing = v[key] !== undefined ? await ctx.one<Row>(`SELECT * FROM ${qi(q.table)} WHERE ${qi(key)} = ? FOR UPDATE`, [v[key]]) : null;
      if (existing) {
        const updated = await doUpdate(ctx, q.table, existing, await cleanInput(ctx, q.table, v));
        if (!updated) throw new AppError(`Not allowed to update ${q.table}`, 403);
        rows.push(updated);
      } else rows.push(await doInsert(ctx, q.table, v));
    }
  } else if (q.action === 'update') {
    const patch = await cleanInput(ctx, q.table, (q.values as Row) ?? {});
    for (const old of await targets(ctx, q)) {
      const r = await doUpdate(ctx, q.table, old, patch);
      if (r) rows.push(r);
    }
  } else if (q.action === 'delete') {
    for (const old of await targets(ctx, q)) {
      if (!system(ctx) && (!policy.delete || !(await policy.delete(ctx, old)))) continue;
      const r = await deleteRow(ctx, q.table, old[meta.pk]);
      if (r) rows.push(r);
    }
  } else {
    throw new AppError(`Unsupported action ${q.action}`);
  }

  if (!q.returning) return { data: null };
  const sel = parseSelect(q.returning);
  // re-read so returned rows reflect hooks that ran after the write
  if (q.action !== 'delete') rows = (await Promise.all(rows.map((r) => getRow(ctx, q.table, r[meta.pk])))).filter(Boolean) as Row[];
  return { data: rows.map((r) => project(r, sel.cols, hidden)) };
}
