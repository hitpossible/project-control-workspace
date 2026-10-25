'use client';

import { useTranslations } from 'next-intl';
import { DateField, SelectField } from './form';

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

const PERIOD_PRESETS = ['month', 'last_month', 'quarter', 'last_90', 'year', 'custom'] as const;

export function PeriodPicker({ value, onChange }: { value: Period; onChange: (p: Period) => void }) {
  const t = useTranslations('common.period');
  return (
    <div className="flex flex-wrap items-end gap-2">
      <SelectField className="w-40" label={t('label')} value={value.preset} onChange={(v) => onChange(v === 'custom' ? { ...value, preset: 'custom' } : periodFor(v))}
        options={PERIOD_PRESETS.map((p) => ({ value: p, label: t(p) }))} />
      <DateField className="w-40" label={t('from')} value={value.from} onChange={(v) => onChange({ ...value, from: v, preset: 'custom' })} />
      <DateField className="w-40" label={t('to')} value={value.to} onChange={(v) => onChange({ ...value, to: v, preset: 'custom' })} />
    </div>
  );
}
