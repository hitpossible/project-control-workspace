import mysql, { type Pool, type PoolConnection, type ResultSetHeader, type RowDataPacket } from 'mysql2/promise';
import type { Profile } from '@/lib/types';

/**
 * MySQL access. Conventions (mirrors what the UI got from PostgREST before):
 *   DATE      → 'YYYY-MM-DD' string
 *   DATETIME  → ISO string in UTC ('…Z'); the session runs in UTC
 *   TINYINT(1)→ boolean, DECIMAL → number, JSON → parsed value
 */
type G = typeof globalThis & { __pcwPool?: Pool };

function typeCast(field: { type: string; length: number; string: (encoding?: string) => string | null }, next: () => unknown) {
  if (field.type === 'TINY' && field.length === 1) {
    const v = field.string();
    return v === null ? null : v === '1';
  }
  if (field.type === 'DATETIME' || field.type === 'TIMESTAMP') {
    const v = field.string();
    return v === null ? null : `${v.replace(' ', 'T')}${v.includes('.') ? '' : '.000'}Z`;
  }
  if (field.type === 'JSON') {
    const v = field.string('utf8');
    return v === null ? null : JSON.parse(v);
  }
  return next();
}

export function pool(): Pool {
  const g = globalThis as G;
  if (!g.__pcwPool) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is not set');
    g.__pcwPool = mysql.createPool({
      uri: url,
      timezone: 'Z',
      dateStrings: true,
      decimalNumbers: true,
      supportBigNumbers: true,
      charset: 'utf8mb4_unicode_ci',
      connectionLimit: Number(process.env.DB_POOL_SIZE ?? 10),
      typeCast: typeCast as never,
    });
    g.__pcwPool.on('connection', (c) => {
      c.query("SET time_zone = '+00:00', sql_mode = 'STRICT_ALL_TABLES,NO_ZERO_DATE,NO_ZERO_IN_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION'");
    });
  }
  return g.__pcwPool;
}

export class AppError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

export type Row = Record<string, unknown>;

/** Local business date (server time zone) — replaces Postgres current_date */
export function localDate(offsetDays = 0, from = new Date()): string {
  const d = new Date(from);
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Days between two 'YYYY-MM-DD' dates (b - a) */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
}

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** ISO timestamp → local business date */
export function dateOf(ts: string | null | undefined): string | null {
  return ts ? localDate(0, new Date(ts)) : null;
}

/**
 * Request / job context: one DB connection (inside a transaction for writes), the acting user,
 * and the "workflow bypass" flag that used to be pcw.bypass in Postgres.
 */
export class Ctx {
  /** nesting level of cascaded writes (was pg_trigger_depth) */
  depth = 0;
  /** workflow functions may change protected fields */
  bypass = false;
  readonly today = localDate();
  readonly cache = new Map<string, unknown>();
  private afterCommit: (() => Promise<void> | void)[] = [];

  constructor(public conn: PoolConnection, public me: Profile | null) {}

  get uid(): string | null {
    return this.me?.id ?? null;
  }

  async q<T = Row>(sql: string, params: unknown[] = []): Promise<T[]> {
    const [rows] = await this.conn.query<RowDataPacket[]>(sql, params);
    return rows as T[];
  }

  async one<T = Row>(sql: string, params: unknown[] = []): Promise<T | null> {
    const rows = await this.q<T>(sql, params);
    return rows[0] ?? null;
  }

  async val<T = unknown>(sql: string, params: unknown[] = []): Promise<T | null> {
    const row = await this.one<Row>(sql, params);
    return row ? (Object.values(row)[0] as T) : null;
  }

  async exec(sql: string, params: unknown[] = []): Promise<ResultSetHeader> {
    const [res] = await this.conn.query<ResultSetHeader>(sql, params);
    return res;
  }

  onCommit(fn: () => Promise<void> | void) {
    this.afterCommit.push(fn);
  }

  /** run fn as workflow code (protected fields writable), restoring the flag afterwards */
  async asWorkflow<T>(fn: () => Promise<T>): Promise<T> {
    const prev = this.bypass;
    this.bypass = true;
    try {
      return await fn();
    } finally {
      this.bypass = prev;
    }
  }

  async runAfterCommit() {
    for (const fn of this.afterCommit.splice(0)) {
      try {
        await fn();
      } catch (e) {
        console.error('[after-commit]', e);
      }
    }
  }
}

/** Run fn in a transaction as `me`. System jobs pass me = null (full access, like service_role). */
export async function withCtx<T>(me: Profile | null, fn: (ctx: Ctx) => Promise<T>, opts: { system?: boolean } = {}): Promise<T> {
  const conn = await pool().getConnection();
  const ctx = new Ctx(conn, me);
  if (opts.system) ctx.bypass = true;
  try {
    await conn.beginTransaction();
    const out = await fn(ctx);
    await conn.commit();
    await ctx.runAfterCommit();
    return out;
  } catch (e) {
    await conn.rollback().catch(() => undefined);
    throw e;
  } finally {
    conn.release();
  }
}

export const uuid = () => crypto.randomUUID();

/** 'a','b' → '?,?' + params; empty list → a never-true placeholder */
export function inList(values: readonly unknown[]): [string, unknown[]] {
  if (!values.length) return ['NULL', []];
  return [values.map(() => '?').join(','), [...values]];
}
