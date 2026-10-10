'use client';

import dayjs, { type Dayjs } from 'dayjs';
import { ChevronDown, ChevronRight, TriangleAlert } from 'lucide-react';
import { useMemo, useState } from 'react';
import { fmtDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Tip } from './common';
import { ToggleGroup, ToggleGroupItem } from './ui/toggle-group';

export interface GanttRow {
  id: string;
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

const ROW_H = 36;
const LEFT_W = 430;
const TODAY_COLOR = '#0073ea';

export default function GanttChart({ rows, deps = [], onRowClick, onToggle, height }: {
  rows: GanttRow[];
  deps?: { from: string; to: string }[];
  onRowClick?: (row: GanttRow) => void;
  onToggle?: (row: GanttRow) => void;
  height?: number;
}) {
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
      out.push({ label: cur.format(to - from < 10 && scale === 'week' ? 'MMM' : 'MMMM YYYY'), left: from * dayW, width: (to - from) * dayW });
      cur = end.add(1, 'day').startOf('day');
    }
    return out;
  }, [start, days, dayW, scale]);

  const ticks = useMemo(() => {
    const out: { label: string; left: number; weekend: boolean; isWeekStart: boolean }[] = [];
    for (let i = 0; i < days; i++) {
      const d = start.add(i, 'day');
      out.push({ label: scale === 'day' ? d.format('D') : d.format('D MMM'), left: i * dayW, weekend: d.day() === 0 || d.day() === 6, isWeekStart: d.day() === 1 });
    }
    return out;
  }, [start, days, dayW, scale]);

  const rowIndex = new Map(rows.map((r, i) => [r.id, i]));

  return (
    <div>
      <div className="no-print mb-2 flex flex-wrap items-center gap-4">
        <ToggleGroup type="single" variant="outline" size="sm" value={scale} onValueChange={(v) => v && setScale(v as 'day' | 'week')}>
          <ToggleGroupItem value="day" className="data-[state=on]:bg-selected data-[state=on]:text-primary">Day</ToggleGroupItem>
          <ToggleGroupItem value="week" className="data-[state=on]:bg-selected data-[state=on]:text-primary">Week</ToggleGroupItem>
        </ToggleGroup>
        <Legend />
      </div>
      <div className="relative overflow-auto rounded-md border border-grid bg-white" style={{ maxHeight: height ?? 640 }}>
        <div className="relative" style={{ width: LEFT_W + width }}>
          {/* Header */}
          <div className="sticky top-0 z-[4] flex border-b border-grid bg-white">
            <div className="sticky left-0 z-[5] grid shrink-0 grid-cols-[1fr_92px_64px] items-end border-r border-grid bg-white px-2 pb-1 text-xs text-muted-foreground" style={{ width: LEFT_W }}>
              <span>Activity / Task</span><span>PIC</span><span className="text-right">Progress</span>
            </div>
            <div className="relative h-11" style={{ width }}>
              {months.map((m) => (
                <div key={m.left} className="absolute top-0 h-[22px] overflow-hidden border-l border-grid px-1.5 text-[11px] leading-[22px] font-semibold whitespace-nowrap" style={{ left: m.left, width: m.width }}>{m.label}</div>
              ))}
              {ticks.map((t) => (scale === 'day' || t.isWeekStart) && (
                <div key={t.left}
                  className={cn('absolute top-[22px] h-[22px] text-[10px] leading-[22px]', scale === 'day' ? 'text-center' : 'border-l border-grid pl-1', t.weekend ? 'text-[#b0b8c8]' : 'text-muted-foreground')}
                  style={{ left: t.left, width: scale === 'day' ? dayW : dayW * 7 }}>{t.label}</div>
              ))}
            </div>
          </div>

          {/* Body */}
          <div className="relative">
            <div className="pointer-events-none absolute top-0" style={{ left: LEFT_W, width, height: rows.length * ROW_H }}>
              {scale === 'day' && ticks.filter((t) => t.weekend).map((t) => (
                <div key={t.left} className="absolute inset-y-0 bg-[#f6f7fa]" style={{ left: t.left, width: dayW }} />
              ))}
              {scale === 'week' && ticks.filter((t) => t.isWeekStart).map((t) => (
                <div key={t.left} className="absolute inset-y-0 border-l border-[#f0f2f6]" style={{ left: t.left }} />
              ))}
              <div className="absolute inset-y-0 z-[2] w-0.5 opacity-90" style={{ left: x(today) + dayW / 2, background: TODAY_COLOR }} title={`Today ${today.format('DD MMM YYYY')}`} />
            </div>

            {rows.map((r) => {
              const hasPlan = r.planStart && r.planFinish;
              const actualEnd = r.actualFinish ?? (r.actualStart ? today.format('YYYY-MM-DD') : null);
              const forecastBeyond = r.forecastFinish && r.planFinish && dayjs(r.forecastFinish).isAfter(dayjs(r.planFinish));
              return (
                <div key={r.id} className={cn('group flex border-b border-[#f0f2f6]', r.overdue ? 'bg-[#fff1f0] hover:bg-[#ffe5e3]' : 'bg-white hover:bg-[#f5f6f8]')} style={{ height: ROW_H }}>
                  <div
                    onClick={() => onRowClick?.(r)}
                    className={cn('sticky left-0 z-[3] grid shrink-0 grid-cols-[1fr_92px_64px] items-center border-r border-grid bg-inherit px-2', onRowClick && 'cursor-pointer')}
                    style={{ width: LEFT_W, borderLeft: `3px solid ${r.risk || r.overdue ? '#e2445c' : 'transparent'}` }}
                  >
                    <div className="flex min-w-0 items-center" style={{ paddingLeft: r.level * 16 }}>
                      {r.hasChildren ? (
                        <button type="button" className="mr-0.5 rounded p-0.5 hover:bg-muted" onClick={(e) => { e.stopPropagation(); onToggle?.(r); }}>
                          {r.expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                        </button>
                      ) : <span className="w-[22px]" />}
                      <div className="min-w-0">
                        <div className={cn('truncate text-[13px] leading-tight', r.level === 0 ? 'font-semibold' : '')}>
                          {r.code && <span className="mr-1 text-[11px] text-muted-foreground">{r.code}</span>}
                          {r.label}
                        </div>
                        <div className={cn('truncate text-[10.5px] leading-tight', r.overdue ? 'text-destructive' : 'text-muted-foreground')}>
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
                      <Tip title={`Plan: ${fmtDate(r.planStart)} → ${fmtDate(r.planFinish)}`}>
                        <div className="absolute top-1.5 z-[1] h-2.5 rounded-md border border-[#c3c6d4] bg-grid" style={{ left: x(r.planStart!), width: x(r.planFinish!) - x(r.planStart!) + dayW }} />
                      </Tip>
                    )}
                    {r.milestone && r.planFinish && (
                      <Tip title={`Milestone: ${fmtDate(r.planFinish)}`}>
                        <div className="absolute top-[7px] z-[1] size-4 rotate-45" style={{ left: x(r.planFinish) + dayW / 2 - 8, background: r.status === 'completed' ? '#00c875' : '#784bd1' }} />
                      </Tip>
                    )}
                    {r.actualStart && actualEnd && !r.milestone && (
                      <Tip title={`Actual: ${fmtDate(r.actualStart)} → ${r.actualFinish ? fmtDate(r.actualFinish) : 'today'} · ${Math.round(r.progress)}%`}>
                        <div className="absolute top-[19px] z-[1] h-[11px] overflow-hidden rounded-md"
                          style={{ left: x(r.actualStart), width: Math.max(x(actualEnd) - x(r.actualStart) + dayW, dayW), background: `${r.statusColor}55` }}>
                          <div className="h-full" style={{ width: `${r.progress}%`, background: r.statusColor }} />
                        </div>
                      </Tip>
                    )}
                    {forecastBeyond && (
                      <Tip title={`Forecast / Recovery: ${fmtDate(r.forecastFinish)}${r.recovery ? ` — ${r.recovery}` : ''}`}>
                        <div className="absolute top-1.5 z-[1] h-2.5 rounded-r-md border-[1.5px] border-l-0 border-dashed border-[#e2445c] bg-[#e2445c12]"
                          style={{ left: x(r.planFinish!) + dayW, width: x(r.forecastFinish!) - x(r.planFinish!) }} />
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
                  const y1 = a * ROW_H + 11;
                  const x2 = x(rb.planStart);
                  const y2 = b * ROW_H + 11;
                  const mid = x1 + 8;
                  return <path key={`${d.from}-${d.to}`} d={`M${x1},${y1} H${mid} V${y2} H${x2 - 1}`} fill="none" stroke="#784bd1" strokeWidth="1.3" markerEnd="url(#arr)" />;
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
  const item = (el: React.ReactNode, label: string) => (
    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">{el}{label}</span>
  );
  return (
    <div className="flex flex-wrap gap-4">
      {item(<span className="h-2 w-5 rounded border border-[#c3c6d4] bg-grid" />, 'Plan')}
      {item(<span className="h-2 w-5 rounded bg-[#fdab3d]" />, 'Actual (status color, progress)')}
      {item(<span className="h-2 w-5 border-[1.5px] border-dashed border-[#e2445c]" />, 'Forecast / Recovery')}
      {item(<span className="size-2.5 rotate-45 bg-[#784bd1]" />, 'Milestone')}
      {item(<span className="h-3 w-0.5" style={{ background: TODAY_COLOR }} />, 'Today')}
      {item(<span className="h-2.5 w-3 border-l-[3px] border-[#e2445c] bg-[#fff1f0]" />, 'Overdue / Risk')}
    </div>
  );
}
