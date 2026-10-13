'use client';

import { cn } from '@/lib/utils';
import { Tip } from './common';

/** Horizontal bar list (single axis, direct labels) */
export function HBarChart({ rows, max, suffix = '', emptyText = 'No data' }: {
  rows: { label: React.ReactNode; value: number | null; color?: string; hint?: string; key: string }[];
  max?: number; suffix?: string; emptyText?: string;
}) {
  const m = max ?? Math.max(1, ...rows.map((r) => r.value ?? 0));
  if (!rows.length) return <div className="py-6 text-center text-sm text-muted-foreground">{emptyText}</div>;
  return (
    <div className="space-y-1.5">
      {rows.map((r) => (
        <Tip key={r.key} title={r.hint ?? `${r.value ?? '–'}${suffix}`}>
          <div className="grid grid-cols-[minmax(110px,180px)_1fr_56px] items-center gap-2">
            <div className="truncate text-sm">{r.label}</div>
            <div className="h-4 rounded-sm bg-[#f0f2f6]">
              {r.value != null && <div className="h-full rounded-r-[4px]" style={{ width: `${Math.max(0, Math.min(100, (r.value / m) * 100))}%`, background: r.color ?? '#579bfc' }} />}
            </div>
            <div className="text-right text-sm font-semibold tabular-nums">{r.value == null ? '–' : `${r.value}${suffix}`}</div>
          </div>
        </Tip>
      ))}
    </div>
  );
}

/** Diverging bars around zero (e.g. schedule variance: late → right/red, early → left/green) */
export function DivergingBarChart({ rows, suffix = 'd' }: { rows: { key: string; label: React.ReactNode; value: number | null }[]; suffix?: string }) {
  const m = Math.max(1, ...rows.map((r) => Math.abs(r.value ?? 0)));
  return (
    <div className="space-y-1.5">
      <div className="grid grid-cols-[minmax(110px,180px)_1fr_56px] gap-2 text-[11px] text-muted-foreground">
        <span />
        <div className="flex justify-between"><span>← ahead</span><span>0</span><span>late →</span></div>
        <span />
      </div>
      {rows.map((r) => {
        const v = r.value ?? 0;
        const w = (Math.abs(v) / m) * 50;
        return (
          <Tip key={r.key} title={r.value == null ? 'No baseline' : `${v > 0 ? '+' : ''}${v}${suffix}`}>
            <div className="grid grid-cols-[minmax(110px,180px)_1fr_56px] items-center gap-2">
              <div className="truncate text-sm">{r.label}</div>
              <div className="relative h-4 rounded-sm bg-[#f0f2f6]">
                <div className="absolute inset-y-0 left-1/2 w-px bg-[#c3c6d4]" />
                {r.value != null && v !== 0 && (
                  <div className={cn('absolute inset-y-0', v > 0 ? 'left-1/2 rounded-r-[4px] bg-[#e2445c]' : 'rounded-l-[4px] bg-[#00c875]')}
                    style={v > 0 ? { width: `${w}%` } : { width: `${w}%`, right: '50%' }} />
                )}
              </div>
              <div className={cn('text-right text-sm font-semibold tabular-nums', v > 0 ? 'text-destructive' : v < 0 ? 'text-[#00854d]' : '')}>{r.value == null ? '–' : `${v > 0 ? '+' : ''}${v}${suffix}`}</div>
            </div>
          </Tip>
        );
      })}
    </div>
  );
}

/** Stacked distribution bar with legend (status / work type mix) */
export function StackBar({ parts, height = 14 }: { parts: { key: string; label: string; value: number; color: string }[]; height?: number }) {
  const total = parts.reduce((a, p) => a + p.value, 0);
  return (
    <div>
      <div className="flex gap-0.5 overflow-hidden rounded" style={{ height }}>
        {total === 0 ? <div className="flex-1 bg-[#f0f2f6]" /> : parts.filter((p) => p.value > 0).map((p) => (
          <Tip key={p.key} title={`${p.label}: ${p.value}`}><div style={{ width: `${(p.value / total) * 100}%`, background: p.color }} /></Tip>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {parts.filter((p) => p.value > 0).map((p) => (
          <span key={p.key} className="flex items-center gap-1"><span className="size-2.5 rounded-sm" style={{ background: p.color }} />{p.label} <b className="text-foreground">{p.value}</b></span>
        ))}
      </div>
    </div>
  );
}

/** Tiny trend line */
export function Sparkline({ values, width = 90, height = 24, color = '#579bfc' }: { values: number[]; width?: number; height?: number; color?: string }) {
  if (values.length < 2) return <span className="text-xs text-muted-foreground">–</span>;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * (width - 4) + 2},${height - 2 - ((v - min) / Math.max(max - min, 1)) * (height - 4)}`).join(' ');
  return (
    <svg width={width} height={height}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
