'use client';

import { Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { useApp } from '@/providers/AppProvider';
import { BoardGroup } from '@/components/shared/labels';
import { DateField, SelectField } from '@/components/shared/form';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { day, errMsg, fmtDate } from '@/lib/format';
import { dbClient } from '@/lib/db/client';
import { cn } from '@/lib/utils';
import { DEFAULT_WORK_WEEK, WORK_WEEKS, WORK_WEEK_KEY, makeCalendar } from '@/lib/workdays';
import { confirmDialog } from '@/components/shared/ConfirmDialog';

type Holiday = { id: number; holiday_date: string; name: string };

export function WorkingDaysAdmin() {
  const t = useTranslations('admin.workingDays');
  const tc = useTranslations('common');
  const db = dbClient();
  const { notify } = useApp();
  const [week, setWeek] = useState<number[] | null>(null);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [year, setYear] = useState(new Date().getFullYear());
  const [n, setN] = useState({ holiday_date: '', name: '' });
  const load = useCallback(async () => {
    const { data } = await db.from('app_settings').select('value').eq('key', WORK_WEEK_KEY).maybeSingle();
    setWeek((data?.value as number[] | undefined) ?? DEFAULT_WORK_WEEK);
    setHolidays(((await db.from('company_holidays').select('*').order('holiday_date')).data ?? []) as Holiday[]);
  }, [db]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data fetch
    load();
  }, [load]);

  const saveWeek = async (days: number[]) => {
    const { error } = await db.from('app_settings').upsert({ key: WORK_WEEK_KEY, value: days, updated_at: new Date().toISOString() });
    if (error) return notify(errMsg(error), 'error');
    setWeek(days);
    notify(t('saved'));
  };
  const addHoliday = async () => {
    const { error } = await db.from('company_holidays').insert({ holiday_date: n.holiday_date, name: n.name.trim() });
    if (error) return notify(errMsg(error), 'error');
    setYear(Number(n.holiday_date.slice(0, 4)));
    setN({ holiday_date: '', name: '' });
    load();
  };
  const removeHoliday = async (h: Holiday) => {
    if (!(await confirmDialog({ title: t('remove.title', { name: h.name }), description: t('remove.text'), confirmText: t('remove.confirm'), destructive: true }))) return;
    const { error } = await db.from('company_holidays').delete().eq('id', h.id);
    if (error) return notify(errMsg(error), 'error');
    load();
  };

  const current = WORK_WEEKS.find((w) => week && w.days.join() === [...week].sort().join());
  const years = [...new Set([new Date().getFullYear(), new Date().getFullYear() + 1, ...holidays.map((h) => Number(h.holiday_date.slice(0, 4)))])].sort();
  const inYear = holidays.filter((h) => h.holiday_date.startsWith(String(year)));
  // working days in the year with the current settings
  const cal = makeCalendar(week, holidays.map((h) => h.holiday_date));
  const workdays = cal.workdaysBetween(`${year - 1}-12-31`, `${year}-12-31`);

  return (
    <div className="grid max-w-5xl gap-5 lg:grid-cols-[22rem_minmax(0,1fr)] lg:items-start">
      <Card>
        <CardHeader>
          <CardTitle>{t('weekTitle')}</CardTitle>
          <CardDescription>{t('weekDescription')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {WORK_WEEKS.map((w) => (
            <button key={w.value} type="button" disabled={!week} onClick={() => current?.value !== w.value && saveWeek(w.days)}
              className={cn('flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors hover:bg-muted/60',
                current?.value === w.value && 'border-primary bg-primary/5')}>
              <span className={cn('flex size-4 items-center justify-center rounded-full border', current?.value === w.value && 'border-primary')}>
                {current?.value === w.value && <span className="size-2 rounded-full bg-primary" />}
              </span>
              <span className="flex-1 font-medium">{t(`week.${w.value}`)}</span>
              <span className="text-xs text-muted-foreground">{t('perWeek', { count: w.days.length })}</span>
            </button>
          ))}
          {week && !current && <p className="text-xs text-muted-foreground">{t('custom')}</p>}
        </CardContent>
      </Card>

      <BoardGroup title={t('holidays')} color="#e2445c" count={inYear.length}
        actions={
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">{t('workdaysIn', { count: workdays, year })}</span>
            <SelectField className="w-28" value={String(year)} onChange={(v) => setYear(Number(v))} options={years.map((y) => ({ value: String(y), label: String(y) }))} />
          </div>
        }>
        <Table className="board-table">
          <TableHeader><TableRow><TableHead className="w-44">{t('col.date')}</TableHead><TableHead className="text-left">{t('col.holiday')}</TableHead><TableHead className="w-16" /></TableRow></TableHeader>
          <TableBody>
            {inYear.map((h) => (
              <TableRow key={h.id}>
                <TableCell className="text-center">{fmtDate(h.holiday_date)} <span className="text-xs text-muted-foreground">{day(h.holiday_date).format('ddd')}</span></TableCell>
                <TableCell>{h.name}</TableCell>
                <TableCell className="text-center">
                  <Button size="icon" variant="ghost" className="size-8 text-destructive" onClick={() => removeHoliday(h)}><Trash2 /></Button>
                </TableCell>
              </TableRow>
            ))}
            {inYear.length === 0 && (
              <TableRow><TableCell colSpan={3} className="text-center text-sm text-muted-foreground">{t('noHolidays', { year })}</TableCell></TableRow>
            )}
            <TableRow>
              <TableCell><DateField value={n.holiday_date} onChange={(v) => setN({ ...n, holiday_date: v })} /></TableCell>
              <TableCell><Input placeholder={t('holidayPlaceholder')} className="h-9" value={n.name} onChange={(e) => setN({ ...n, name: e.target.value })} /></TableCell>
              <TableCell className="text-center"><Button size="sm" disabled={!n.holiday_date || !n.name.trim()} onClick={addHoliday}>{tc('add')}</Button></TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </BoardGroup>
    </div>
  );
}
