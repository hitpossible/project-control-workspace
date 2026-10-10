import type { Ctx, Row } from './db';

/** Column metadata from information_schema — used to whitelist identifiers and coerce values on write. */
export type ColKind = 'uuid' | 'text' | 'int' | 'number' | 'bool' | 'date' | 'datetime' | 'time' | 'json';
export type TableMeta = { columns: Map<string, ColKind>; pk: string; autoPk: boolean };

type G = typeof globalThis & { __pcwSchema?: Promise<Map<string, TableMeta>> };

function kindOf(dataType: string, columnType: string, name: string): ColKind {
  if (columnType === 'tinyint(1)') return 'bool';
  if (dataType === 'char' && columnType === 'char(36)') return 'uuid';
  if (['int', 'bigint', 'smallint', 'mediumint', 'tinyint'].includes(dataType)) return 'int';
  if (['decimal', 'double', 'float'].includes(dataType)) return 'number';
  if (dataType === 'date') return 'date';
  if (dataType === 'datetime' || dataType === 'timestamp') return 'datetime';
  if (dataType === 'time') return 'time';
  if (dataType === 'json') return 'json';
  return name === 'id' ? 'uuid' : 'text';
}

export async function loadSchema(ctx: Ctx): Promise<Map<string, TableMeta>> {
  const g = globalThis as G;
  if (!g.__pcwSchema) {
    g.__pcwSchema = (async () => {
      const cols = await ctx.q<{ t: string; c: string; dt: string; ct: string; k: string; x: string }>(
        `SELECT TABLE_NAME t, COLUMN_NAME c, DATA_TYPE dt, COLUMN_TYPE ct, COLUMN_KEY k, EXTRA x
           FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME, ORDINAL_POSITION`,
      );
      const map = new Map<string, TableMeta>();
      for (const r of cols) {
        let m = map.get(r.t);
        if (!m) map.set(r.t, (m = { columns: new Map(), pk: 'id', autoPk: false }));
        if (r.x.includes('GENERATED')) continue; // generated columns are never written or returned
        m.columns.set(r.c, kindOf(r.dt, r.ct, r.c));
        if (r.k === 'PRI') {
          m.pk = r.c;
          m.autoPk = r.x.includes('auto_increment');
        }
      }
      return map;
    })().catch((e) => {
      (globalThis as G).__pcwSchema = undefined;
      throw e;
    });
  }
  return g.__pcwSchema;
}

export async function tableMeta(ctx: Ctx, table: string): Promise<TableMeta> {
  const m = (await loadSchema(ctx)).get(table);
  if (!m) throw new Error(`Unknown table ${table}`);
  return m;
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');
/** JS Date → MySQL DATETIME(3) literal in UTC */
export function toSqlDateTime(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}.${pad(d.getUTCMilliseconds(), 3)}`;
}

/** Convert an app value to a MySQL parameter for the given column kind */
export function toDb(kind: ColKind | undefined, v: unknown): unknown {
  if (v === undefined || v === null) return null;
  switch (kind) {
    case 'json':
      return JSON.stringify(v);
    case 'bool':
      return v === true || v === 1 || v === '1' || v === 'true' ? 1 : 0;
    case 'datetime': {
      const d = v instanceof Date ? v : new Date(String(v));
      if (Number.isNaN(d.getTime())) throw new Error(`Invalid timestamp: ${String(v)}`);
      return toSqlDateTime(d);
    }
    case 'date':
      return String(v).slice(0, 10);
    case 'int':
    case 'number':
      return v === '' ? null : Number(v);
    default:
      return v;
  }
}

/** Only known columns, coerced for MySQL */
export function dbValues(meta: TableMeta, row: Row): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(row)) {
    const kind = meta.columns.get(k);
    if (!kind) continue;
    out[k] = toDb(kind, v);
  }
  return out;
}

export const qi = (id: string) => {
  if (!/^[a-z_][a-z0-9_]*$/i.test(id)) throw new Error(`Invalid identifier ${id}`);
  return `\`${id}\``;
};
