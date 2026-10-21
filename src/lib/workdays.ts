/**
 * Working-day calendar: work week (app_settings.work_week) + company holidays (company_holidays).
 * Dates are 'YYYY-MM-DD'; weekdays 0 = Sunday … 6 = Saturday.
 */
export const WORK_WEEK_KEY = 'work_week';
export const DEFAULT_WORK_WEEK = [1, 2, 3, 4, 5];
export const WORK_WEEKS: { value: string; label: string; days: number[] }[] = [
  { value: 'mon-fri', label: 'Monday – Friday', days: [1, 2, 3, 4, 5] },
  { value: 'mon-sat', label: 'Monday – Saturday', days: [1, 2, 3, 4, 5, 6] },
];

const shift = (date: string, n: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const weekday = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();

export interface WorkCalendar {
  isWorkday: (date: string) => boolean;
  /** the date itself when it is a working day, else the next working day */
  nextWorkday: (date: string) => string;
  /** n working days after `date` (n = 0 → nextWorkday(date)) */
  addWorkdays: (date: string, n: number) => string;
  /** working days between two dates, like daysBetween (b - a): counts working days in (a, b], negative when b < a */
  workdaysBetween: (a: string, b: string) => number;
}

export function makeCalendar(workWeek: number[] | null | undefined, holidays: Iterable<string>): WorkCalendar {
  // an empty work week would never reach a working day — treat it as every day
  const week = new Set(workWeek?.length ? workWeek.map(Number) : [0, 1, 2, 3, 4, 5, 6]);
  const off = new Set([...holidays].map((d) => String(d).slice(0, 10)));
  const isWorkday = (d: string) => week.has(weekday(d)) && !off.has(d);
  // more holidays in a row than this means the calendar is broken — stop instead of looping forever
  const guard = 3660;
  const nextWorkday = (date: string) => {
    let d = date;
    for (let i = 0; i < guard && !isWorkday(d); i++) d = shift(d, 1);
    return d;
  };
  const addWorkdays = (date: string, n: number) => {
    let d = nextWorkday(date);
    for (let left = n; left > 0; left--) d = nextWorkday(shift(d, 1));
    return d;
  };
  const workdaysBetween = (a: string, b: string) => {
    if (a === b) return 0;
    const [from, to, sign] = a < b ? [a, b, 1] : [b, a, -1];
    let n = 0;
    for (let d = shift(from, 1); d <= to; d = shift(d, 1)) if (isWorkday(d)) n++;
    return n * sign;
  };
  return { isWorkday, nextWorkday, addWorkdays, workdaysBetween };
}
