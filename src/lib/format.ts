import dayjs from 'dayjs';
import 'dayjs/locale/th';
import { defaultLocale, type Locale } from '@/i18n/config';

/**
 * UI language for the formatters below, kept in sync by <LocaleSync> (src/i18n/LocaleSync.tsx).
 * Applied per call instead of dayjs's global locale so Excel / PDF exports keep their English dates.
 */
let uiLocale: Locale = defaultLocale;
export const setFormatLocale = (l: Locale) => { uiLocale = l; };

/** dayjs in the UI language — use for any date text shown on screen */
export const day = (d?: dayjs.ConfigType) => dayjs(d).locale(uiLocale);

export const fmtDate = (d: string | null | undefined) => (d ? day(d).format('DD MMM YYYY') : '-');
export const fmtShort = (d: string | null | undefined) => (d ? day(d).format('DD MMM') : '-');
export const fmtDateTime = (d: string | null | undefined) => (d ? day(d).format('DD MMM YYYY HH:mm') : '-');
export const today = () => dayjs().format('YYYY-MM-DD');

export const isOverdue = (due: string | null | undefined, status: string) =>
  !!due && dayjs(due).isBefore(dayjs(), 'day') && !['completed', 'cancelled'].includes(status);

export const daysBetween = (a: string, b: string) => dayjs(b).diff(dayjs(a), 'day');

/** API errors come back as `{ message }` */
export const errMsg = (e: unknown) =>
  (e && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message) : String(e)) || 'Unexpected error';

/** Convert '' to null for nullable DB columns */
export const fmtNum = (n: number | string | null | undefined) => (n == null || n === '' ? '-' : Number(n).toLocaleString(uiLocale === 'th' ? 'th-TH' : 'en-US', { maximumFractionDigits: 2 }));

export function nullify<T extends Record<string, unknown>>(o: T): T {
  const out = { ...o } as Record<string, unknown>;
  for (const k of Object.keys(out)) if (out[k] === '') out[k] = null;
  return out as T;
}
