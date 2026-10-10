import type { DataFilter, DataQuery, DbError, DbResult } from './protocol';

/**
 * Browser data client. Same fluent API the pages used with supabase-js
 * (from().select().eq().order()…, rpc()), but every call goes to our Next.js API,
 * where the server enforces the row-level policies and runs the workflow logic on MySQL.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- untyped rows, like supabase-js without generated types */

async function post<T>(url: string, body: unknown): Promise<DbResult<T>> {
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (res.status === 401 && typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
      window.location.assign(new URL(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`, window.location.origin));
    }
    const json = await res.json().catch(() => ({ error: { message: res.statusText } }));
    if (!res.ok || json.error) return { data: null as T, error: json.error ?? { message: res.statusText, status: res.status }, count: null };
    return { data: json.data as T, error: null, count: json.count ?? null };
  } catch (e) {
    return { data: null as T, error: { message: e instanceof Error ? e.message : String(e) }, count: null };
  }
}

/** "(a,b,c)" → ['a','b','c'] */
const parseList = (v: unknown): unknown[] =>
  Array.isArray(v) ? v : String(v).replace(/^\(|\)$/g, '').split(',').map((s) => s.trim().replace(/^"|"$/g, '')).filter(Boolean);

/** PostgREST style "col.op.value,col.op.value" */
function parseOr(expr: string): DataFilter[] {
  return expr.split(',').map((part) => {
    const [col, op, ...rest] = part.split('.');
    const value = rest.join('.');
    if (op === 'is') return { op: 'is', col, value: value === 'null' ? null : value === 'true' } as DataFilter;
    if (op === 'in') return { op: 'in', col, value: parseList(value) } as DataFilter;
    return { op: op as 'eq', col, value } as DataFilter;
  });
}

export type Exec = (q: DataQuery) => Promise<DbResult<any>>;
const httpExec: Exec = (q) => post<any>('/api/data', q);

export class QueryBuilder<T = any> implements PromiseLike<DbResult<T>> {
  private mode: 'many' | 'single' | 'maybe' = 'many';

  constructor(private q: DataQuery, private exec: Exec = httpExec) {}

  select(columns = '*', opts?: { count?: 'exact'; head?: boolean }) {
    if (this.q.action === 'select') {
      this.q.columns = columns;
      if (opts?.count) this.q.count = true;
      if (opts?.head) this.q.head = true;
    } else {
      this.q.returning = columns;
    }
    return this;
  }

  private f(filter: DataFilter) {
    (this.q.filters ??= []).push(filter);
    return this;
  }

  eq(col: string, value: unknown) { return this.f({ op: 'eq', col, value }); }
  neq(col: string, value: unknown) { return this.f({ op: 'neq', col, value }); }
  gt(col: string, value: unknown) { return this.f({ op: 'gt', col, value }); }
  gte(col: string, value: unknown) { return this.f({ op: 'gte', col, value }); }
  lt(col: string, value: unknown) { return this.f({ op: 'lt', col, value }); }
  lte(col: string, value: unknown) { return this.f({ op: 'lte', col, value }); }
  in(col: string, values: readonly unknown[]) { return this.f({ op: 'in', col, value: [...values] }); }
  is(col: string, value: null | boolean) { return this.f({ op: 'is', col, value }); }
  match(obj: Record<string, unknown>) {
    for (const [col, value] of Object.entries(obj)) this.eq(col, value);
    return this;
  }
  not(col: string, op: 'in' | 'is' | 'eq', value: unknown) {
    if (op === 'in') return this.f({ op: 'not_in', col, value: parseList(value) });
    if (op === 'is') return this.f({ op: 'not_is', col, value: value as null | boolean });
    return this.f({ op: 'neq', col, value });
  }
  or(expr: string) { return this.f({ op: 'or', value: parseOr(expr) }); }
  order(col: string, opts?: { ascending?: boolean; nullsFirst?: boolean }) {
    (this.q.order ??= []).push({ col, ascending: opts?.ascending ?? true, nullsFirst: opts?.nullsFirst });
    return this;
  }
  limit(n: number) {
    this.q.limit = n;
    return this;
  }
  single() {
    this.mode = 'single';
    return this as unknown as QueryBuilder<any>;
  }
  maybeSingle() {
    this.mode = 'maybe';
    return this as unknown as QueryBuilder<any>;
  }

  async execute(): Promise<DbResult<T>> {
    const res = await this.exec(this.q);
    if (res.error || this.mode === 'many') return res;
    const rows = (res.data ?? []) as unknown[];
    if (rows.length > 1 || (this.mode === 'single' && rows.length === 0)) {
      return { data: null as T, error: { message: `Expected a single row, got ${rows.length}` }, count: res.count };
    }
    return { data: (rows[0] ?? null) as T, error: null, count: res.count };
  }

  then<A = DbResult<T>, B = never>(onfulfilled?: ((v: DbResult<T>) => A | PromiseLike<A>) | null, onrejected?: ((e: unknown) => B | PromiseLike<B>) | null): PromiseLike<A | B> {
    return this.execute().then(onfulfilled, onrejected);
  }
}

class TableRef {
  constructor(private table: string, private exec: Exec) {}
  select(columns = '*', opts?: { count?: 'exact'; head?: boolean }) {
    return new QueryBuilder({ table: this.table, action: 'select' }, this.exec).select(columns, opts);
  }
  insert(values: Record<string, unknown> | Record<string, unknown>[]) {
    return new QueryBuilder({ table: this.table, action: 'insert', values }, this.exec);
  }
  upsert(values: Record<string, unknown> | Record<string, unknown>[], opts?: { onConflict?: string }) {
    return new QueryBuilder({ table: this.table, action: 'upsert', values, onConflict: opts?.onConflict }, this.exec);
  }
  update(values: Record<string, unknown>) {
    return new QueryBuilder({ table: this.table, action: 'update', values }, this.exec);
  }
  delete() {
    return new QueryBuilder({ table: this.table, action: 'delete' }, this.exec);
  }
}

/** Query API over any transport (HTTP in the browser; direct calls in scripts) */
export function createDb(exec: Exec, rpc: <T = any>(fn: string, args?: Record<string, unknown>) => Promise<DbResult<T>>) {
  return { from: (table: string) => new TableRef(table, exec), rpc };
}

/** Upload a file as evidence (stored in MinIO; the evidence row is created by the server) */
async function uploadEvidence(meta: Record<string, unknown>, file: File): Promise<DbResult<any>> {
  const form = new FormData();
  form.append('file', file);
  form.append('meta', JSON.stringify(meta));
  try {
    const res = await fetch('/api/evidence/upload', { method: 'POST', body: form });
    const json = await res.json().catch(() => ({ error: { message: res.statusText } }));
    return res.ok ? { data: json.data, error: null } : { data: null, error: json.error ?? { message: res.statusText } };
  } catch (e) {
    return { data: null, error: { message: e instanceof Error ? e.message : String(e) } };
  }
}

export const db = {
  ...createDb(httpExec, <T = any>(fn: string, args: Record<string, unknown> = {}) => post<T>(`/api/rpc/${fn}`, args)),
  uploadEvidence,
  /** permission-checked download / preview URL for an uploaded evidence file */
  evidenceFileUrl: (evidenceId: string) => `/api/evidence/${evidenceId}/file`,
};
export type DbClient = typeof db;
export type { DbError };

/** kept as a function so components can call it like the former supabaseBrowser() */
export function dbClient(): DbClient {
  return db;
}
