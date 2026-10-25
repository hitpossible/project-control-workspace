'use client';

import { type LucideIcon } from 'lucide-react';

export function Stat({ icon: Icon, label, value, hint }: { icon: LucideIcon; label: string; value: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <div className="min-w-0 bg-card px-4 py-3">
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><Icon className="size-3.5" />{label}</div>
      <div className="mt-0.5 truncate text-sm font-semibold">{value}</div>
      {hint && <div className="mt-0.5 truncate text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}

export function InfoBlock({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-muted/50 px-3 py-2.5">
      <div className="mb-0.5 text-xs font-medium text-muted-foreground">{label}</div>
      <div className="text-sm break-words whitespace-pre-wrap">{children || <span className="text-muted-foreground">-</span>}</div>
    </div>
  );
}
