'use client';

import { Check, ChevronDown, ChevronRight, ChevronsUpDown, Search, X } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { GROUP_COLORS, HEALTH_COLORS, PRIORITIES, optColor, optLabel } from '@/lib/constants';
import type { Profile, Role } from '@/lib/types';
import { Button } from './ui/button';
import { Card, CardContent } from './ui/card';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from './ui/command';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Textarea } from './ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';
import { useApp } from './AppProvider';

export type Opt = { value: string; label: string; color?: string };

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------
export function Tip({ title, children, side }: { title: React.ReactNode; children: React.ReactNode; side?: 'top' | 'bottom' | 'left' | 'right' }) {
  if (!title) return <>{children}</>;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side}>{title}</TooltipContent>
    </Tooltip>
  );
}

/** Readable text on a solid label: dark text on light colors (yellow, grey) */
export function labelText(hex: string) {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.75 ? '#323338' : '#ffffff';
}

// ---------------------------------------------------------------------------
// monday-style labels / columns
// ---------------------------------------------------------------------------
export function StatusChip({ list, value, fullWidth, className }: { list: Opt[]; value: string | null | undefined; fullWidth?: boolean; className?: string }) {
  const color = optColor(list, value);
  return (
    <span
      className={cn('inline-flex h-7 items-center justify-center whitespace-nowrap rounded px-2.5 text-[13px] font-medium select-none', fullWidth ? 'w-full' : 'min-w-28', className)}
      style={{ background: color, color: labelText(color) }}
    >
      {optLabel(list, value)}
    </span>
  );
}

export function PriorityChip({ value, fullWidth }: { value: string; fullWidth?: boolean }) {
  return <StatusChip list={PRIORITIES} value={value} fullWidth={fullWidth} />;
}

export function HealthDot({ value, label = false }: { value: string; label?: boolean }) {
  return (
    <Tip title={`Health: ${value}`}>
      <span className="inline-flex items-center gap-1.5">
        <span className="size-3 shrink-0 rounded-full" style={{ background: HEALTH_COLORS[value] ?? '#999' }} />
        {label && <span className="text-sm font-semibold capitalize">{value}</span>}
      </span>
    </Tip>
  );
}

export function ProgressBar({ value, className }: { value: number; className?: string }) {
  const v = Number(value) || 0;
  return (
    <div className={cn('flex min-w-28 items-center gap-2', className)}>
      <div className="h-[18px] flex-1 overflow-hidden rounded-sm bg-grid">
        <div className="h-full bg-[#00c875] transition-[width]" style={{ width: `${Math.min(100, v)}%` }} />
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
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="mb-7">
      <div className="mb-1.5 flex items-center gap-2">
        <button type="button" onClick={() => setOpen(!open)} className="rounded p-0.5 hover:bg-muted" style={{ color }}>
          {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
        </button>
        <h3 className="text-[17px] font-semibold" style={{ color }}>{title}</h3>
        {count !== undefined && <span className="text-sm text-muted-foreground">{count} {count === 1 ? 'item' : 'items'}</span>}
        <div className="flex-1" />
        {actions}
      </div>
      {open && (
        <div className="overflow-x-auto rounded border border-grid bg-white" style={{ borderLeft: `6px solid ${color}` }}>
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
  const fmt = (d: string) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  return (
    <div className="relative h-6 min-w-32 overflow-hidden rounded-full bg-[#333]">
      <div className="absolute inset-y-0 left-0" style={{ width: `${pct}%`, background: late ? '#e2445c' : color }} />
      <div className="relative text-center text-xs leading-6 font-medium text-white">{fmt(start)} – {fmt(end)}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------
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

export function SearchBox({ value, onChange, className, placeholder = 'Search' }: { value: string; onChange: (v: string) => void; className?: string; placeholder?: string }) {
  return (
    <div className={cn('relative', className)}>
      <Search className="absolute top-2.5 left-2.5 size-4 text-muted-foreground" />
      <Input placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} className="h-9 bg-white pl-8" />
    </div>
  );
}

export function EmptyState({ text }: { text: string }) {
  return <div className="py-8 text-center text-sm text-muted-foreground">{text}</div>;
}

export function StatCard({ label, value, color, hint, onClick }: { label: string; value: React.ReactNode; color?: string; hint?: string; onClick?: () => void }) {
  return (
    <div
      onClick={onClick}
      className={cn('h-full rounded-lg border bg-white px-4 py-3 transition-shadow', onClick && 'cursor-pointer hover:shadow-md')}
    >
      <div className="flex items-center gap-1.5">
        <span className="size-2 shrink-0 rounded-full" style={{ background: color ?? '#0073ea' }} />
        <span className="truncate text-sm text-muted-foreground">{label}</span>
      </div>
      <div className="mt-1 font-heading text-3xl leading-tight font-medium" style={{ color: color ?? undefined }}>{value}</div>
      {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Form fields
// ---------------------------------------------------------------------------
export function FormField({ label, required, helperText, children, className }: {
  label?: string; required?: boolean; helperText?: React.ReactNode; children: React.ReactNode; className?: string;
}) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      {label && <Label className="text-xs font-medium text-muted-foreground">{label}{required && <span className="text-destructive"> *</span>}</Label>}
      {children}
      {helperText && <p className="text-xs text-muted-foreground">{helperText}</p>}
    </div>
  );
}

export function TextField({ label, value, onChange, multiline, rows = 3, required, disabled, type = 'text', placeholder, helperText, className, mono }: {
  label?: string; value: string | number | null | undefined; onChange?: (v: string) => void; multiline?: boolean; rows?: number;
  required?: boolean; disabled?: boolean; type?: string; placeholder?: string; helperText?: React.ReactNode; className?: string; mono?: boolean;
}) {
  return (
    <FormField label={label} required={required} helperText={helperText} className={className}>
      {multiline ? (
        <Textarea rows={rows} value={value ?? ''} onChange={(e) => onChange?.(e.target.value)} disabled={disabled} placeholder={placeholder}
          className={cn('min-h-0 bg-white', mono && 'font-mono text-xs')} />
      ) : (
        <Input type={type} value={value ?? ''} onChange={(e) => onChange?.(e.target.value)} disabled={disabled} placeholder={placeholder} className="h-9 bg-white" />
      )}
    </FormField>
  );
}

const NONE = '__none__';

export function SelectField({ label, value, onChange, options, disabled, required, allowEmpty, helperText, placeholder, className }: {
  label?: string; value: string | null | undefined; onChange: (v: string) => void; options: Opt[];
  disabled?: boolean; required?: boolean; allowEmpty?: boolean; helperText?: string; placeholder?: string; className?: string;
}) {
  return (
    <FormField label={label} required={required} helperText={helperText} className={className}>
      <Select value={value || ''} onValueChange={(v) => onChange(v === NONE ? '' : v)} disabled={disabled}>
        <SelectTrigger className="h-9 w-full bg-white"><SelectValue placeholder={placeholder ?? (allowEmpty ? '—' : 'Select…')} /></SelectTrigger>
        <SelectContent>
          {allowEmpty && <SelectItem value={NONE}><span className="text-muted-foreground">{placeholder ?? '—'}</span></SelectItem>}
          {options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
        </SelectContent>
      </Select>
    </FormField>
  );
}

export function DateField({ label, value, onChange, disabled, required, helperText, className }: {
  label?: string; value: string | null | undefined; onChange: (v: string) => void; disabled?: boolean; required?: boolean; helperText?: string; className?: string;
}) {
  return (
    <FormField label={label} required={required} helperText={helperText} className={className}>
      <Input type="date" value={value ?? ''} onChange={(e) => onChange(e.target.value)} disabled={disabled} className="h-9 bg-white" />
    </FormField>
  );
}

/** Searchable single person picker */
export function UserSelect({ label, value, onChange, roles, disabled, required, helperText, users, className }: {
  label?: string; value: string | null | undefined; onChange: (id: string | null) => void;
  roles?: Role[]; disabled?: boolean; required?: boolean; helperText?: string; users?: Profile[]; className?: string;
}) {
  const { profiles } = useApp();
  const [open, setOpen] = useState(false);
  const list = (users ?? profiles).filter((p) => p.is_active && (!roles || roles.some((r) => p.roles.includes(r)) || p.id === value));
  const selected = (users ?? profiles).find((p) => p.id === value);
  return (
    <FormField label={label} required={required} helperText={helperText} className={className}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild disabled={disabled}>
          <Button variant="outline" role="combobox" className="h-9 w-full justify-between bg-white px-2.5 font-normal">
            {selected ? <Person name={selected.full_name} size={22} /> : <span className="text-muted-foreground">Select person…</span>}
            <span className="flex items-center gap-1">
              {selected && !disabled && !required && (
                <X className="size-3.5 text-muted-foreground hover:text-foreground" onClick={(e) => { e.stopPropagation(); onChange(null); }} />
              )}
              <ChevronsUpDown className="size-4 text-muted-foreground" />
            </span>
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-(--radix-popover-trigger-width) min-w-64 p-0" align="start">
          <Command>
            <CommandInput placeholder="Search name…" />
            <CommandList>
              <CommandEmpty>No person found.</CommandEmpty>
              <CommandGroup>
                {list.map((p) => (
                  <CommandItem key={p.id} value={`${p.full_name} ${p.department ?? ''} ${p.id}`} onSelect={() => { onChange(p.id); setOpen(false); }}>
                    <Person name={p.full_name} showName={false} size={24} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm">{p.full_name}</div>
                      <div className="truncate text-xs text-muted-foreground">{[p.department, p.section].filter(Boolean).join(' · ')}</div>
                    </div>
                    {p.id === value && <Check className="size-4" />}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </FormField>
  );
}

/** Searchable multi-select with chips */
export function MultiSelect({ label, value, onChange, options, disabled, placeholder, className }: {
  label?: string; value: string[]; onChange: (v: string[]) => void; options: Opt[]; disabled?: boolean; placeholder?: string; className?: string;
}) {
  const [open, setOpen] = useState(false);
  const toggle = (v: string) => onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
  return (
    <FormField label={label} className={className}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild disabled={disabled}>
          <Button variant="outline" className="h-auto min-h-9 w-full justify-between bg-white px-2 py-1 font-normal">
            <span className="flex flex-wrap gap-1">
              {value.length === 0 && <span className="px-0.5 text-muted-foreground">{placeholder ?? 'Select…'}</span>}
              {value.map((v) => (
                <span key={v} className="inline-flex items-center gap-1 rounded bg-secondary px-1.5 py-0.5 text-xs">
                  {options.find((o) => o.value === v)?.label ?? v}
                  {!disabled && <X className="size-3 hover:text-destructive" onClick={(e) => { e.stopPropagation(); toggle(v); }} />}
                </span>
              ))}
            </span>
            <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-(--radix-popover-trigger-width) min-w-64 p-0" align="start">
          <Command>
            <CommandInput placeholder="Search…" />
            <CommandList>
              <CommandEmpty>Nothing found.</CommandEmpty>
              <CommandGroup>
                {options.map((o) => (
                  <CommandItem key={o.value} value={`${o.label} ${o.value}`} onSelect={() => toggle(o.value)}>
                    <Check className={cn('size-4', value.includes(o.value) ? 'opacity-100' : 'opacity-0')} />
                    {o.label}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </FormField>
  );
}

/** Dialog asking for an optional / required comment before an action */
export function CommentDialog({ open, title, description, confirmLabel, required, variant = 'default', onClose, onConfirm, children }: {
  open: boolean; title: string; description?: string; confirmLabel: string; required?: boolean;
  variant?: 'default' | 'destructive' | 'success' | 'warning' | 'secondary';
  onClose: () => void; onConfirm: (comment: string) => Promise<void> | void; children?: React.ReactNode;
}) {
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        {children}
        <TextField label={required ? 'Comment (required)' : 'Comment'} multiline rows={3} value={comment} onChange={setComment} />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
          <ActionButton
            tone={variant}
            disabled={busy || (required && !comment.trim())}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm(comment);
                setComment('');
              } finally {
                setBusy(false);
              }
            }}
          >
            {confirmLabel}
          </ActionButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const TONES: Record<string, string> = {
  default: 'bg-primary text-white hover:bg-[#0060b9]',
  success: 'bg-[#00854d] text-white hover:bg-[#007038]',
  destructive: 'bg-[#d83a52] text-white hover:bg-[#b63546]',
  warning: 'bg-[#d97706] text-white hover:bg-[#b45309]',
  secondary: 'bg-[#784bd1] text-white hover:bg-[#6a3fc0]',
};

/** Solid colored action button (Approve / Reject / …) */
export function ActionButton({ tone = 'default', outline, className, ...props }: React.ComponentProps<typeof Button> & { tone?: keyof typeof TONES | string; outline?: boolean }) {
  const solid = TONES[tone] ?? TONES.default;
  const color = solid.match(/bg-\[(#\w+)\]/)?.[1] ?? '#0073ea';
  return (
    <Button
      {...props}
      className={cn(outline ? 'border bg-white hover:bg-muted' : solid, className)}
      style={outline ? { borderColor: color, color } : undefined}
    />
  );
}

// ---------------------------------------------------------------------------
// Period picker (KPI / reports)
// ---------------------------------------------------------------------------
export type Period = { from: string; to: string; preset: string };

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function periodFor(preset: string): Period {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  switch (preset) {
    case 'last_month': return { preset, from: iso(new Date(y, m - 1, 1)), to: iso(new Date(y, m, 0)) };
    case 'quarter': { const q = Math.floor(m / 3) * 3; return { preset, from: iso(new Date(y, q, 1)), to: iso(new Date(y, q + 3, 0)) }; }
    case 'last_90': return { preset, from: iso(new Date(y, m, now.getDate() - 90)), to: iso(now) };
    case 'year': return { preset, from: iso(new Date(y, 0, 1)), to: iso(new Date(y, 11, 31)) };
    default: return { preset: 'month', from: iso(new Date(y, m, 1)), to: iso(new Date(y, m + 1, 0)) };
  }
}

export function PeriodPicker({ value, onChange }: { value: Period; onChange: (p: Period) => void }) {
  return (
    <div className="flex flex-wrap items-end gap-2">
      <SelectField className="w-40" label="Period" value={value.preset} onChange={(v) => onChange(v === 'custom' ? { ...value, preset: 'custom' } : periodFor(v))}
        options={[
          { value: 'month', label: 'This month' }, { value: 'last_month', label: 'Last month' }, { value: 'quarter', label: 'This quarter' },
          { value: 'last_90', label: 'Last 90 days' }, { value: 'year', label: 'This year' }, { value: 'custom', label: 'Custom…' },
        ]} />
      <DateField className="w-40" label="From" value={value.from} onChange={(v) => onChange({ ...value, from: v, preset: 'custom' })} />
      <DateField className="w-40" label="To" value={value.to} onChange={(v) => onChange({ ...value, to: v, preset: 'custom' })} />
    </div>
  );
}
