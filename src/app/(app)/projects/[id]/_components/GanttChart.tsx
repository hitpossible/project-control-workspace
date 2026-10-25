'use client';

import dayjs, { type Dayjs } from 'dayjs';
import { ChevronDown, Crosshair, TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useRef, useState } from 'react';
import { day, fmtDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Tip } from '@/components/shared/Tip';
import { Button } from '@/components/ui/button';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';

export interface GanttRow {
  /** unique across the chart: entityKey('activity' | 'task', id) */
  id: string;
  /** id of the activity / task the row shows */
  entityId: number;
  level: number;               // 0 = activity, 1 = task, 2 = sub-task
  label: string;
  code?: string | null;
  pic?: string;
  planStart: string | null;
  planFinish: string | null;
  actualStart?: string | null;
  actualFinish?: string | null;
  forecastFinish?: string | null;   // revised forecast / recovery
  progress: number;
  status: string;
  statusColor: string;
  statusLabel: string;
  milestone?: boolean;
  overdue?: boolean;
  risk?: boolean;
  hasChildren?: boolean;
  expanded?: boolean;
  recovery?: string | null;
}

const ROW_H = 46;
// bar geometry inside a row: thin plan bar above, thicker actual bar below, gap between
const PLAN_Y = 12;
const PLAN_H = 8;
const ACT_Y = 24;
const ACT_H = 12;
const LEFT_W = 430;
const TODAY_COLOR = '#0073ea';

export default function GanttChart({ rows, deps = [], onRowClick, onToggle, height }: {
  rows: GanttRow[];
  deps?: { from: string; to: string }[];
  onRowClick?: (row: GanttRow) => void;
  onToggle?: (row: GanttRow) => void;
  height?: number;
}) {
  const t = useTranslations('gantt');
  const [scale, setScale] = useState<'day' | 'week'>('day');
  const dayW = scale === 'day' ? 26 : 9;
  const today = dayjs().startOf('day');

  const { start, days } = useMemo(() => {
    const ds: Dayjs[] = [today];
    rows.forEach((r) => [r.planStart, r.planFinish, r.actualStart, r.actualFinish, r.forecastFinish].forEach((d) => d && ds.push(dayjs(d))));
    const min = ds.reduce((a, b) => (b.isBefore(a) ? b : a)).subtract(3, 'day').startOf('week');
    const max = ds.reduce((a, b) => (b.isAfter(a) ? b : a)).add(10, 'day').endOf('week');
    return { start: min, days: max.diff(min, 'day') + 1 };
  }, [rows, today]);

  const x = (d: string | Dayjs) => dayjs(d).startOf('day').diff(start, 'day') * dayW;
  const width = days * dayW;

  const months = useMemo(() => {
    const out: { label: string; left: number; width: number }[] = [];
    let cur = start;
    while (cur.diff(start, 'day') < days) {
      const end = cur.endOf('month');
      const from = cur.diff(start, 'day');
      const to = Math.min(end.diff(start, 'day') + 1, days);
      out.push({ label: day(cur).format(to - from < 10 && scale === 'week' ? 'MMM' : 'MMMM YYYY'), left: from * dayW, width: (to - from) * dayW });
      cur = end.add(1, 'day').startOf('day');
    }
    return out;
  }, [start, days, dayW, scale]);

  const ticks = useMemo(() => {
    const out: { label: string; left: number; weekend: boolean; isWeekStart: boolean }[] = [];
    for (let i = 0; i < days; i++) {
      const d = start.add(i, 'day');
      out.push({ label: scale === 'day' ? d.format('D') : day(d).format('D MMM'), left: i * dayW, weekend: d.day() === 0 || d.day() === 6, isWeekStart: d.day() === 1 });
    }
    return out;
  }, [start, days, dayW, scale]);

  const rowIndex = new Map(rows.map((r, i) => [r.id, i]));
  const todayLeft = x(today) + dayW / 2;

  // bring today into view (a third from the left) when the chart opens or the scale changes
  const scroller = useRef<HTMLDivElement>(null);
  const scrollToToday = (behavior: ScrollBehavior = 'smooth') => {
    const el = scroller.current;
    if (el) el.scrollTo({ left: Math.max(0, todayLeft - (el.clientWidth - LEFT_W) / 3), behavior });
  };
  const hasRows = rows.length > 0;
  useEffect(() => {
    if (hasRows) scrollToToday('instant');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on open / scale change
  }, [hasRows, scale]);

  return (
    <div>
      <div className="no-print mb-2 flex flex-wrap items-center gap-4">
        <ToggleGroup type="single" variant="outline" size="sm" value={scale} onValueChange={(v) => v && setScale(v as 'day' | 'week')}>
          <ToggleGroupItem value="day" className="data-[state=on]:bg-selected data-[state=on]:text-primary">{t('day')}</ToggleGroupItem>
          <ToggleGroupItem value="week" className="data-[state=on]:bg-selected data-[state=on]:text-primary">{t('week')}</ToggleGroupItem>
        </ToggleGroup>
        <Button variant="outline" size="sm" onClick={() => scrollToToday()}><Crosshair /> {t('today')}</Button>
        <Legend />
      </div>
      <div ref={scroller} className="relative overflow-auto rounded-md border border-grid bg-white" style={{ maxHeight: height ?? 640 }}>
        <div className="relative" style={{ width: LEFT_W + width }}>
          {/* Header */}
          <div className="sticky top-0 z-[4] flex border-b border-grid bg-white">
            <div className="sticky left-0 z-[5] grid shrink-0 grid-cols-[1fr_92px_64px] items-end border-r border-grid bg-white px-2 pb-1 text-xs text-muted-foreground" style={{ width: LEFT_W }}>
              <span>{t('col.item')}</span><span>{t('col.pic')}</span><span className="text-right">{t('col.progress')}</span>
            </div>
            <div className="relative h-11" style={{ width }}>
              {months.map((m) => (
                <div key={m.left} className="absolute top-0 h-[22px] overflow-hidden border-l border-grid px-1.5 text-[11px] leading-[22px] font-semibold whitespace-nowrap" style={{ left: m.left, width: m.width }}>{m.label}</div>
              ))}
              {ticks.map((tk) => (scale === 'day' || tk.isWeekStart) && (
                <div key={tk.left}
                  className={cn('absolute top-[22px] h-[22px] text-[10px] leading-[22px]', scale === 'day' ? 'text-center' : 'border-l border-grid pl-1', tk.weekend ? 'text-[#b0b8c8]' : 'text-muted-foreground')}
                  style={{ left: tk.left, width: scale === 'day' ? dayW : dayW * 7 }}>{tk.label}</div>
              ))}
              <span className="motion-rise absolute bottom-0 z-[1] -translate-x-1/2 rounded-t px-1.5 text-[10px] leading-4 font-semibold text-white"
                style={{ left: todayLeft, background: TODAY_COLOR }}>{t('today')}</span>
            </div>
          </div>

          {/* Body */}
          <div className="relative">
            <div className="pointer-events-none absolute top-0" style={{ left: LEFT_W, width, height: rows.length * ROW_H }}>
              {scale === 'day' && ticks.filter((tk) => tk.weekend).map((tk) => (
                <div key={tk.left} className="absolute inset-y-0 bg-[#f6f7fa]" style={{ left: tk.left, width: dayW }} />
              ))}
              {scale === 'week' && ticks.filter((tk) => tk.isWeekStart).map((tk) => (
                <div key={tk.left} className="absolute inset-y-0 border-l border-[#f0f2f6]" style={{ left: tk.left }} />
              ))}
              <div className="motion-grow-y absolute inset-y-0 z-[2] w-0.5 origin-top opacity-90" style={{ left: todayLeft, background: TODAY_COLOR }} title={t('todayTip', { date: fmtDate(today.format('YYYY-MM-DD')) })} />
            </div>

            {rows.map((r, i) => {
              const hasPlan = r.planStart && r.planFinish;
              const actualEnd = r.actualFinish ?? (r.actualStart ? today.format('YYYY-MM-DD') : null);
              const forecastBeyond = r.forecastFinish && r.planFinish && dayjs(r.forecastFinish).isAfter(dayjs(r.planFinish));
              // bars grow in from their start, a little after the row above
              const grow = { animationDelay: `${Math.min(i, 20) * 25}ms` };
              return (
                <div key={r.id}
                  className={cn('group flex border-b border-[#f0f2f6]',
                    r.overdue ? 'bg-[#fff8f7] hover:bg-[#fff0ee]' : r.level === 0 ? 'bg-[#fafbfc] hover:bg-[#f3f5f8]' : 'bg-white hover:bg-[#f7f8fa]',
                    // a firmer line above each activity separates the groups
                    r.level === 0 && i > 0 && 'shadow-[inset_0_1px_0_#dfe3ea]')}
                  style={{ height: ROW_H }}>
                  <div
                    onClick={() => onRowClick?.(r)}
                    className={cn('sticky left-0 z-[3] grid shrink-0 grid-cols-[1fr_92px_64px] items-center border-r border-grid bg-inherit px-2', onRowClick && 'cursor-pointer')}
                    style={{ width: LEFT_W, borderLeft: `3px solid ${r.risk || r.overdue ? '#e2445c' : 'transparent'}` }}
                  >
                    <div className="flex min-w-0 items-center" style={{ paddingLeft: r.level * 18 }}>
                      {r.hasChildren ? (
                        <button type="button" className="mr-0.5 rounded p-0.5 hover:bg-muted" onClick={(e) => { e.stopPropagation(); onToggle?.(r); }}>
                          <ChevronDown className={cn('size-4 transition-transform duration-200', !r.expanded && '-rotate-90')} />
                        </button>
                      ) : <span className="w-[22px]" />}
                      <div className="min-w-0">
                        <div className={cn('truncate text-[13px] leading-snug', r.level === 0 ? 'font-semibold' : '')}>
                          {r.code && <span className="mr-1 text-[11px] text-muted-foreground">{r.code}</span>}
                          {r.label}
                        </div>
                        <div className={cn('mt-0.5 truncate text-[11px] leading-tight', r.overdue ? 'text-destructive' : 'text-muted-foreground')}>
                          {r.overdue && <TriangleAlert className="mr-0.5 inline size-3 align-[-2px]" />}
                          {fmtDate(r.planStart)} → {fmtDate(r.planFinish)} · <span className="font-semibold" style={{ color: r.statusColor }}>{r.statusLabel}</span>
                        </div>
                      </div>
                    </div>
                    <div className="truncate text-xs">{r.pic ?? '-'}</div>
                    <div className="text-right text-xs font-semibold">{Math.round(r.progress)}%</div>
                  </div>
                  <div className="relative shrink-0" style={{ width }} onClick={() => onRowClick?.(r)}>
                    {hasPlan && !r.milestone && (
                      <Tip title={t('tip.plan', { from: fmtDate(r.planStart), to: fmtDate(r.planFinish) })}>
                        <div className="motion-grow-x absolute z-[1] origin-left rounded-full border border-[#cdd1dc] bg-[#e9ebf1] transition-colors group-hover:border-[#b3b8c6] group-hover:bg-[#dfe2ea]" style={{ ...grow, top: PLAN_Y, height: PLAN_H, left: x(r.planStart!) + 1, width: x(r.planFinish!) - x(r.planStart!) + dayW - 2 }} />
                      </Tip>
                    )}
                    {r.milestone && r.planFinish && (
                      <Tip title={t('tip.milestone', { date: fmtDate(r.planFinish) })}>
                        <div className="motion-rise absolute z-[1] size-4 rotate-45 rounded-[3px] transition-transform group-hover:scale-125" style={{ top: (ROW_H - 16) / 2, left: x(r.planFinish) + dayW / 2 - 8, background: r.status === 'completed' ? '#00c875' : '#784bd1' }} />
                      </Tip>
                    )}
                    {r.actualStart && actualEnd && !r.milestone && (
                      <Tip title={t('tip.actual', { from: fmtDate(r.actualStart), to: r.actualFinish ? fmtDate(r.actualFinish) : t('tip.todayLower'), progress: Math.round(r.progress) })}>
                        <div className="motion-grow-x absolute z-[1] origin-left overflow-hidden rounded-full transition-shadow group-hover:shadow-[0_2px_6px_rgba(16,24,40,.18)]"
                          style={{ ...grow, top: ACT_Y, height: ACT_H, left: x(r.actualStart) + 1, width: Math.max(x(actualEnd) - x(r.actualStart) + dayW - 2, dayW - 2), background: `${r.statusColor}40` }}>
                          <div className="h-full transition-[width] duration-500" style={{ width: `${r.progress}%`, background: r.statusColor }} />
                        </div>
                      </Tip>
                    )}
                    {forecastBeyond && (
                      <Tip title={t('tip.forecast', { date: fmtDate(r.forecastFinish) }) + (r.recovery ? ` — ${r.recovery}` : '')}>
                        <div className="motion-grow-x absolute z-[1] origin-left rounded-r-full border-[1.5px] border-l-0 border-dashed border-[#e2445c] bg-[#e2445c12]"
                          style={{ animationDelay: `${Math.min(i, 20) * 25 + 300}ms`, top: PLAN_Y, height: PLAN_H, left: x(r.planFinish!) + dayW - 1, width: x(r.forecastFinish!) - x(r.planFinish!) }} />
                      </Tip>
                    )}
                  </div>
                </div>
              );
            })}

            {deps.length > 0 && (
              <svg className="pointer-events-none absolute top-0 z-[2]" style={{ left: LEFT_W, width, height: rows.length * ROW_H }}>
                <defs>
                  <marker id="arr" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0,0 L7,3.5 L0,7 z" fill="#784bd1" /></marker>
                </defs>
                {deps.map((d) => {
                  const a = rowIndex.get(d.from);
                  const b = rowIndex.get(d.to);
                  if (a === undefined || b === undefined) return null;
                  const ra = rows[a];
                  const rb = rows[b];
                  if (!ra.planFinish || !rb.planStart) return null;
                  const x1 = x(ra.planFinish) + dayW;
                  const y1 = a * ROW_H + PLAN_Y + PLAN_H / 2;
                  const x2 = x(rb.planStart);
                  const y2 = b * ROW_H + PLAN_Y + PLAN_H / 2;
                  const mid = x1 + 8;
                  return <path key={`${d.from}-${d.to}`} d={`M${x1},${y1} H${mid} V${y2} H${x2 - 1}`} fill="none" stroke="#784bd1" strokeWidth="1.3" strokeOpacity="0.8" markerEnd="url(#arr)" />;
                })}
              </svg>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Legend() {
  const t = useTranslations('gantt.legend');
  const item = (el: React.ReactNode, label: string) => (
    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">{el}{label}</span>
  );
  return (
    <div className="flex flex-wrap gap-4">
      {item(<span className="h-2 w-5 rounded border border-[#c3c6d4] bg-grid" />, t('plan'))}
      {item(<span className="h-2 w-5 rounded bg-[#fdab3d]" />, t('actual'))}
      {item(<span className="h-2 w-5 border-[1.5px] border-dashed border-[#e2445c]" />, t('forecast'))}
      {item(<span className="size-2.5 rotate-45 bg-[#784bd1]" />, t('milestone'))}
      {item(<span className="h-3 w-0.5" style={{ background: TODAY_COLOR }} />, t('today'))}
      {item(<span className="h-2.5 w-3 border-l-[3px] border-[#e2445c] bg-[#fff1f0]" />, t('overdue'))}
    </div>
  );
}
