import dayjs from 'dayjs';

export const fmtDate = (d: string | null | undefined) => (d ? dayjs(d).format('DD MMM YYYY') : '-');
export const fmtShort = (d: string | null | undefined) => (d ? dayjs(d).format('DD MMM') : '-');
export const fmtDateTime = (d: string | null | undefined) => (d ? dayjs(d).format('DD MMM YYYY HH:mm') : '-');
export const today = () => dayjs().format('YYYY-MM-DD');

export const isOverdue = (due: string | null | undefined, status: string) =>
  !!due && dayjs(due).isBefore(dayjs(), 'day') && !['completed', 'cancelled'].includes(status);

export const daysBetween = (a: string, b: string) => dayjs(b).diff(dayjs(a), 'day');

/** API errors come back as `{ message }` */
export const errMsg = (e: unknown) =>
  (e && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message) : String(e)) || 'Unexpected error';

/** Convert '' to null for nullable DB columns */
export function nullify<T extends Record<string, unknown>>(o: T): T {
  const out = { ...o } as Record<string, unknown>;
  for (const k of Object.keys(out)) if (out[k] === '') out[k] = null;
  return out as T;
}
