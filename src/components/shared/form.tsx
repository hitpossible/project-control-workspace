'use client';

import { CalendarIcon, Check, ChevronsUpDown, X } from 'lucide-react';
import dayjs from 'dayjs';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { th as thDays } from 'react-day-picker/locale';
import { fmtDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { Profile, Role } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useApp } from '@/providers/AppProvider';
import { Person } from './labels';

/** Option with a ready-to-show label (lists from constants.ts get theirs from useOptions().options) */
export type Opt = { value: string; label: string; color?: string };

export function FormField({ label, required, helperText, error, children, className }: {
  label?: string; required?: boolean; helperText?: React.ReactNode; /** red message under the field */ error?: string | null; children: React.ReactNode; className?: string;
}) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      {label && <Label className="text-xs font-medium text-muted-foreground">{label}{required && <span className="text-destructive"> *</span>}</Label>}
      {children}
      {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : helperText && <p className="text-xs text-muted-foreground">{helperText}</p>}
    </div>
  );
}

export function TextField({ label, value, onChange, multiline, rows = 3, required, disabled, type = 'text', placeholder, helperText, error, className, mono }: {
  label?: string; value: string | number | null | undefined; onChange?: (v: string) => void; multiline?: boolean; rows?: number;
  required?: boolean; disabled?: boolean; type?: string; placeholder?: string; helperText?: React.ReactNode; error?: string | null; className?: string; mono?: boolean;
}) {
  return (
    <FormField label={label} required={required} helperText={helperText} error={error} className={className}>
      {multiline ? (
        <Textarea rows={rows} value={value ?? ''} onChange={(e) => onChange?.(e.target.value)} disabled={disabled} placeholder={placeholder} aria-invalid={!!error}
          className={cn('min-h-0 bg-white', mono && 'font-mono text-xs')} />
      ) : (
        <Input type={type} value={value ?? ''} onChange={(e) => onChange?.(e.target.value)} disabled={disabled} placeholder={placeholder} aria-invalid={!!error} className="h-9 bg-white" />
      )}
    </FormField>
  );
}

const NONE = '__none__';

export function SelectField({ label, value, onChange, options, disabled, required, allowEmpty, helperText, error, placeholder, className }: {
  label?: string; value: string | null | undefined; onChange: (v: string) => void; options: Opt[];
  disabled?: boolean; required?: boolean; allowEmpty?: boolean; helperText?: string; error?: string | null; placeholder?: string; className?: string;
}) {
  const t = useTranslations('common');
  return (
    <FormField label={label} required={required} helperText={helperText} error={error} className={className}>
      <Select value={value || ''} onValueChange={(v) => onChange(v === NONE ? '' : v)} disabled={disabled}>
        <SelectTrigger className="h-9 w-full bg-white"><SelectValue placeholder={placeholder ?? (allowEmpty ? '—' : t('select'))} /></SelectTrigger>
        <SelectContent>
          {allowEmpty && <SelectItem value={NONE}><span className="text-muted-foreground">{placeholder ?? '—'}</span></SelectItem>}
          {options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
        </SelectContent>
      </Select>
    </FormField>
  );
}

export function DateField({ label, value, onChange, disabled, required, helperText, error, className }: {
  label?: string; value: string | null | undefined; onChange: (v: string) => void; disabled?: boolean; required?: boolean; helperText?: string; error?: string | null; className?: string;
}) {
  return (
    <FormField label={label} required={required} helperText={helperText} error={error} className={className}>
      <DatePicker value={value} onChange={onChange} disabled={disabled} clearable={!required} invalid={!!error} />
    </FormField>
  );
}

/** shadcn date picker (Popover + Calendar); value is a 'YYYY-MM-DD' string, '' when cleared */
export function DatePicker({ value, onChange, disabled, clearable, placeholder, className, invalid }: {
  value: string | null | undefined; onChange: (v: string) => void; disabled?: boolean; clearable?: boolean; placeholder?: string; className?: string; invalid?: boolean;
}) {
  const t = useTranslations('common');
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const selected = value ? dayjs(value).toDate() : undefined;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <div className={cn('relative', className)}>
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" disabled={disabled}
            aria-invalid={invalid} className={cn('h-9 w-full justify-start bg-white px-3 font-normal', !value && 'text-muted-foreground', clearable && value && 'pr-8')}>
            <CalendarIcon className="text-muted-foreground" />
            <span className="truncate">{value ? fmtDate(value) : placeholder ?? t('selectDate')}</span>
          </Button>
        </PopoverTrigger>
        {clearable && value && !disabled && (
          <button type="button" aria-label={t('clearDate')} onClick={() => onChange('')}
            className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:bg-secondary hover:text-foreground">
            <X className="size-3.5" />
          </button>
        )}
      </div>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar locale={locale === 'th' ? thDays : undefined} mode="single" selected={selected} defaultMonth={selected} captionLayout="dropdown" startMonth={new Date(2015, 0)} endMonth={new Date(2040, 11)}
          onSelect={(d) => {
            if (d) onChange(dayjs(d).format('YYYY-MM-DD'));
            setOpen(false);
          }} />
      </PopoverContent>
    </Popover>
  );
}

export function UserSelect({ label, value, onChange, roles, disabled, required, helperText, users, className }: {
  label?: string; value: number | null | undefined; onChange: (id: number | null) => void;
  roles?: Role[]; disabled?: boolean; required?: boolean; helperText?: string; users?: Profile[]; className?: string;
}) {
  const t = useTranslations('common');
  const { profiles } = useApp();
  const [open, setOpen] = useState(false);
  const list = (users ?? profiles).filter((p) => p.is_active && (!roles || roles.some((r) => p.roles.includes(r)) || p.id === value));
  const selected = (users ?? profiles).find((p) => p.id === value);
  return (
    <FormField label={label} required={required} helperText={helperText} className={className}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild disabled={disabled}>
          <Button variant="outline" role="combobox" className="h-9 w-full justify-between bg-white px-2.5 font-normal">
            {selected ? <Person name={selected.full_name} size={22} /> : <span className="text-muted-foreground">{t('selectPerson')}</span>}
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
            <CommandInput placeholder={t('searchName')} />
            <CommandList>
              <CommandEmpty>{t('noPerson')}</CommandEmpty>
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
  const t = useTranslations('common');
  const [open, setOpen] = useState(false);
  const toggle = (v: string) => onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);
  return (
    <FormField label={label} className={className}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild disabled={disabled}>
          <Button variant="outline" className="h-auto min-h-9 w-full justify-between bg-white px-2 py-1 font-normal">
            <span className="flex flex-wrap gap-1">
              {value.length === 0 && <span className="px-0.5 text-muted-foreground">{placeholder ?? t('select')}</span>}
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
            <CommandInput placeholder={t('searchEllipsis')} />
            <CommandList>
              <CommandEmpty>{t('nothingFound')}</CommandEmpty>
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
  const t = useTranslations('common');
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
        <TextField label={required ? t('commentRequired') : t('comment')} multiline rows={3} value={comment} onChange={setComment} />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('close')}</Button>
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
