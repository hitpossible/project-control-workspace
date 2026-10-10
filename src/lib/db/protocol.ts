/** Wire format between the browser query builder (lib/db/client) and POST /api/data */
export type DataFilter =
  | { op: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte'; col: string; value: unknown }
  | { op: 'in' | 'not_in'; col: string; value: unknown[] }
  | { op: 'is' | 'not_is'; col: string; value: null | boolean }
  | { op: 'or'; col?: undefined; value: DataFilter[] };

export type DataQuery = {
  table: string;
  action: 'select' | 'insert' | 'update' | 'upsert' | 'delete';
  /** select list, e.g. "*, projects(project_code, project_name)" */
  columns?: string;
  filters?: DataFilter[];
  order?: { col: string; ascending?: boolean; nullsFirst?: boolean }[];
  limit?: number;
  count?: boolean;
  head?: boolean;
  values?: Record<string, unknown> | Record<string, unknown>[];
  /** select list to return after a write (…insert().select()) */
  returning?: string;
  onConflict?: string;
};

export type DbError = { message: string; status?: number };
export type DbResult<T> = { data: T; error: DbError | null; count?: number | null };
