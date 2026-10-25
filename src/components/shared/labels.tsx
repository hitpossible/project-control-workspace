'use client';

import { ChevronDown } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useOptions } from '@/i18n/useOptions';
import { day } from '@/lib/format';
import { cn } from '@/lib/utils';
import { GROUP_COLORS, HEALTH_COLORS, PRIORITIES, optColor, type OptList } from '@/lib/constants';
import { Tip } from './Tip';

/** Readable text on a solid label: dark text on light colors (yellow, grey) */
export function labelText(hex: string) {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.75 ? '#323338' : '#ffffff';
}

export function StatusChip({ list, value, fullWidth, className }: { list: OptList; value: string | null | undefined; fullWidth?: boolean; className?: string }) {
  const { label } = useOptions();
  const color = optColor(list, value);
  return (
    <span
      className={cn('inline-flex h-7 items-center justify-center whitespace-nowrap rounded px-2.5 text-[13px] font-medium select-none', fullWidth ? 'w-full' : 'min-w-28', className)}
      style={{ background: color, color: labelText(color) }}
    >
      {label(list, value)}
    </span>
  );
}

export function PriorityChip({ value, fullWidth }: { value: string; fullWidth?: boolean }) {
  return <StatusChip list={PRIORITIES} value={value} fullWidth={fullWidth} />;
}

export function HealthDot({ value, label = false }: { value: string; label?: boolean }) {
  const t = useTranslations('common.health');
  const name = t.has(value as 'green') ? t(value as 'green') : value;
  return (
    <Tip title={t('tip', { value: name })}>
      <span className="inline-flex items-center gap-1.5">
        <span className="size-3 shrink-0 rounded-full" style={{ background: HEALTH_COLORS[value] ?? '#999' }} />
        {label && <span className="text-sm font-semibold capitalize">{name}</span>}
      </span>
    </Tip>
  );
}

export function ProgressBar({ value, className }: { value: number; className?: string }) {
  const v = Number(value) || 0;
  return (
    <div className={cn('flex min-w-28 items-center gap-2', className)}>
      <div className="h-[18px] flex-1 overflow-hidden rounded-sm bg-grid">
        <div className="motion-grow-x h-full origin-left bg-[#00c875] transition-[width] duration-500" style={{ width: `${Math.min(100, v)}%` }} />
      </div>
      <span className="min-w-8 text-right text-xs text-muted-foreground">{Math.round(v)}%</span>
    </div>
  );
}

function hashColor(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return GROUP_COLORS[h % GROUP_COLORS.length];
}

export function Person({ name, showName = true, size = 28 }: { name: string | null | undefined; showName?: boolean; size?: number }) {
  if (!name || name === '-' || name === '—') return <span className="text-muted-foreground/60">–</span>;
  const initials = name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  return (
    <Tip title={showName ? null : name}>
      <span className="inline-flex max-w-full min-w-0 items-center gap-1.5">
        <span
          className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white"
          style={{ width: size, height: size, fontSize: size * 0.4, background: hashColor(name) }}
        >
          {initials}
        </span>
        {showName && <span className="truncate text-sm">{name}</span>}
      </span>
    </Tip>
  );
}

export function BoardGroup({ title, color, count, children, actions, defaultOpen = true }: {
  title: React.ReactNode; color: string; count?: number; children: React.ReactNode; actions?: React.ReactNode; defaultOpen?: boolean;
}) {
  const t = useTranslations('common');
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="mb-7">
      <div className="mb-1.5 flex items-center gap-2">
        <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="rounded p-0.5 transition-colors hover:bg-muted" style={{ color }}>
          <ChevronDown className={cn('size-4 transition-transform duration-200', !open && '-rotate-90')} />
        </button>
        <h3 className="text-[17px] font-semibold" style={{ color }}>{title}</h3>
        {count !== undefined && <span className="text-sm text-muted-foreground">{t('items', { count })}</span>}
        <div className="flex-1" />
        {actions}
      </div>
      {open && (
        <div className="motion-rise overflow-x-auto rounded border border-grid bg-white" style={{ borderLeft: `6px solid ${color}` }}>
          {children}
        </div>
      )}
    </section>
  );
}

export function TimelinePill({ start, end, color = '#579bfc', late }: { start: string | null; end: string | null; color?: string; late?: boolean }) {
  const [now] = useState(() => Date.now());
  if (!start || !end) return <span className="text-muted-foreground/60">–</span>;
  const s = new Date(start).getTime();
  const e = new Date(end).getTime();
  const pct = Math.max(0, Math.min(100, ((now - s) / Math.max(e - s, 1)) * 100));
  return (
    <div className="relative h-6 min-w-32 overflow-hidden rounded-full bg-[#333]">
      <div className="absolute inset-y-0 left-0" style={{ width: `${pct}%`, background: late ? '#e2445c' : color }} />
      <div className="relative text-center text-xs leading-6 font-medium text-white">{day(start).format('D MMM')} – {day(end).format('D MMM')}</div>
    </div>
  );
}
