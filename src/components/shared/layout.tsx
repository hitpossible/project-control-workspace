'use client';

import { CheckCheck, Search } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { AnimatedValue } from './motion';

export function PageHeader({ title, subtitle, actions }: { title: React.ReactNode; subtitle?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <h1 className="font-heading text-[26px] leading-tight font-semibold">{title}</h1>
        {subtitle && <div className="mt-1 text-sm text-muted-foreground">{subtitle}</div>}
      </div>
      {actions && <div className="no-print flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Section({ title, actions, children, className }: { title?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <Card className={cn('mb-4 gap-0 py-4 shadow-none ring-1 ring-border', className)}>
      <CardContent className="px-4">
        {(title || actions) && (
          <div className="mb-3 flex items-center gap-2">
            <h3 className="flex-1 text-base font-semibold">{title}</h3>
            {actions}
          </div>
        )}
        {children}
      </CardContent>
    </Card>
  );
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-2.5">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="text-sm break-words whitespace-pre-wrap">{children || '-'}</div>
    </div>
  );
}

export function SearchBox({ value, onChange, className, placeholder }: { value: string; onChange: (v: string) => void; className?: string; placeholder?: string }) {
  const t = useTranslations('common');
  return (
    <div className={cn('relative', className)}>
      <Search className="absolute top-2.5 left-2.5 size-4 text-muted-foreground" />
      <Input placeholder={placeholder ?? t('search')} value={value} onChange={(e) => onChange(e.target.value)} className="h-9 bg-white pl-8" />
    </div>
  );
}

/** `done`: an "all clear" state (nothing overdue, no bugs…) gets a small green check */
export function EmptyState({ text, done }: { text: string; done?: boolean }) {
  return (
    <div className="motion-rise flex flex-col items-center gap-2 py-8 text-center text-sm text-muted-foreground">
      {done && (
        <span className="relative grid size-10 place-items-center rounded-full bg-[#00c875]/12 text-[#00a862]">
          <span className="motion-ring absolute inset-0 rounded-full bg-[#00c875]/30" />
          <CheckCheck className="relative size-5" />
        </span>
      )}
      {text}
    </div>
  );
}

export function StatCard({ label, value, color, hint, onClick }: { label: string; value: React.ReactNode; color?: string; hint?: string; onClick?: () => void }) {
  return (
    <div
      onClick={onClick}
      onKeyDown={onClick && ((e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onClick()))}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      className={cn('h-full rounded-lg border bg-white px-4 py-3 transition-[box-shadow,transform,border-color] duration-200',
        onClick && 'cursor-pointer outline-none hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md focus-visible:ring-2 focus-visible:ring-primary/50 active:translate-y-0 active:scale-[0.98]')}
    >
      <div className="flex items-center gap-1.5">
        <span className="size-2 shrink-0 rounded-full" style={{ background: color ?? '#0073ea' }} />
        <span className="truncate text-sm text-muted-foreground">{label}</span>
      </div>
      <div className="mt-1 font-heading text-3xl leading-tight font-medium" style={{ color: color ?? undefined }}><AnimatedValue value={value} /></div>
      {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}
