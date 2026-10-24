'use client';

import { Check } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Number that counts from its previous value to the new one (0 on first show). */
export function CountUp({ value, duration = 700, decimals }: { value: number; duration?: number; decimals?: number }) {
  const [shown, setShown] = useState(0);
  const from = useRef(0);
  const places = decimals ?? (Number.isInteger(value) ? 0 : 1);

  useEffect(() => {
    if (reducedMotion()) {
      from.current = value;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- jump straight to the value
      setShown(value);
      return;
    }
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - (1 - t) ** 3;
      const v = a + (value - a) * eased;
      from.current = v;
      setShown(v);
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    // frames are paused in background tabs — never leave a stale number behind
    const settle = setTimeout(() => {
      cancelAnimationFrame(raf);
      from.current = value;
      setShown(value);
    }, duration + 100);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(settle);
    };
  }, [value, duration]);

  return <span className="tabular-nums">{shown.toFixed(places)}</span>;
}

/** Count up a number, or a string like "85%", "+3d", "12.5d"; anything else is shown as is. */
export function AnimatedValue({ value }: { value: React.ReactNode }) {
  if (typeof value === 'number') return <CountUp value={value} />;
  if (typeof value === 'string') {
    const m = /^([+-]?)(\d+(?:\.(\d+))?)(\D*)$/.exec(value);
    if (m) return <>{m[1]}<CountUp value={Number(m[2])} decimals={m[3]?.length ?? 0} />{m[4]}</>;
  }
  return <>{value}</>;
}

/**
 * Ids that appeared after the list first became ready — so a freshly added row
 * can animate in without the whole list animating on page load.
 */
export function useNewIds(ids: (string | number)[], ready = true) {
  const seen = useRef<Set<string | number> | null>(null);
  const [fresh, setFresh] = useState<Set<string | number>>(new Set());
  const key = ids.join(',');

  useEffect(() => {
    if (!ready) return;
    if (!seen.current) {
      seen.current = new Set(ids);
      return;
    }
    const added = ids.filter((id) => !seen.current!.has(id));
    ids.forEach((id) => seen.current!.add(id));
    if (added.length) setFresh(new Set(added));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` stands in for `ids`
  }, [key, ready]);

  return (id: string | number) => fresh.has(id);
}

// ---------------------------------------------------------------------------
// Skeletons — shaped like the content they stand in for
// ---------------------------------------------------------------------------

export function Skeleton({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return <div aria-hidden className={cn('skeleton h-4', className)} style={style} />;
}

export function StatCardsSkeleton({ count = 6, className }: { count?: number; className?: string }) {
  return (
    <div className={cn('grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6', className)}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="rounded-lg border bg-white px-4 py-3">
          <Skeleton className="h-3.5 w-24" />
          <Skeleton className="mt-2.5 h-8 w-14" />
        </div>
      ))}
    </div>
  );
}

/** a board group (coloured left edge) with table-like rows */
export function BoardSkeleton({ rows = 5, cols = 5, groups = 1 }: { rows?: number; cols?: number; groups?: number }) {
  const t = useTranslations('common');
  return (
    <div role="status" aria-label={t('loading')}>
      {Array.from({ length: groups }, (_, g) => (
        <section key={g} className="mb-7">
          <Skeleton className="mb-2.5 h-5 w-48" />
          <div className="overflow-hidden rounded border border-grid border-l-[6px] border-l-[#e3e6ec] bg-white">
            {Array.from({ length: rows }, (_, r) => (
              <div key={r} className="flex items-center gap-4 border-b border-grid px-3 py-3 last:border-b-0">
                <Skeleton className="size-3 shrink-0 rounded-full" />
                <div className="min-w-0 flex-[3]">
                  <Skeleton className="h-3.5" style={{ width: `${55 + ((r * 17) % 35)}%` }} />
                  <Skeleton className="mt-1.5 h-2.5 w-1/3" />
                </div>
                {Array.from({ length: cols - 1 }, (_, c) => <Skeleton key={c} className="h-6 flex-1" />)}
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

/** single-line rows (notifications, small lists) */
export function ListSkeleton({ rows = 6 }: { rows?: number }) {
  const t = useTranslations('common');
  return (
    <div role="status" aria-label={t('loading')} className="divide-y divide-grid">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-start gap-3 px-4 py-3.5">
          <Skeleton className="size-9 shrink-0 rounded-full" />
          <div className="flex-1">
            <Skeleton className="h-3.5" style={{ width: `${45 + ((i * 23) % 40)}%` }} />
            <Skeleton className="mt-2 h-2.5 w-28" />
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Success burst — a short check-mark moment for milestones (request submitted,
// approval given). Call celebrate() from anywhere; <SuccessBurst /> lives in AppShell.
// ---------------------------------------------------------------------------

const BURST_EVENT = 'pcw:celebrate';

export function celebrate(title: string, detail?: string) {
  window.dispatchEvent(new CustomEvent(BURST_EVENT, { detail: { title, detail } }));
}

export function SuccessBurst() {
  const [burst, setBurst] = useState<{ key: number; title: string; detail?: string } | null>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const on = (e: Event) => {
      const { title, detail } = (e as CustomEvent<{ title: string; detail?: string }>).detail;
      clearTimeout(timer);
      setBurst({ key: Date.now(), title, detail });
      timer = setTimeout(() => setBurst(null), 1700);
    };
    window.addEventListener(BURST_EVENT, on);
    return () => {
      window.removeEventListener(BURST_EVENT, on);
      clearTimeout(timer);
    };
  }, []);

  if (!burst) return null;
  return (
    <div role="status" aria-live="polite" className="pointer-events-none fixed inset-0 z-[60] grid place-items-center">
      <div key={burst.key} className="motion-burst flex flex-col items-center rounded-2xl bg-white/95 px-8 py-6 shadow-[0_12px_40px_rgba(16,24,40,.18)] backdrop-blur">
        <span className="relative grid size-14 place-items-center rounded-full bg-[#00c875] text-white">
          <span className="motion-ring absolute inset-0 rounded-full bg-[#00c875]" />
          <Check className="relative size-8" strokeWidth={3} />
        </span>
        <div className="mt-3 text-base font-semibold">{burst.title}</div>
        {burst.detail && <div className="mt-0.5 max-w-64 text-center text-sm text-muted-foreground">{burst.detail}</div>}
      </div>
    </div>
  );
}
