'use client';

import { useTranslations } from 'next-intl';
import { SKILL_LEVELS } from '@/lib/skills';
import { cn } from '@/lib/utils';

/** sequential scale: level 1 (light) … 5 (dark) */
export const LEVEL_COLORS = ['#e3edfd', '#b9d2fa', '#7eaef2', '#3d82e0', '#1c5bbf'];

/** A level as a small square; outline = self-assessed only, faded = not re-confirmed for a year */
export function LevelBadge({ level, verified = true, stale, className }: { level: number | null | undefined; verified?: boolean; stale?: boolean; className?: string }) {
  if (!level) return <span className={cn('inline-flex size-7 items-center justify-center text-muted-foreground/40', className)}>·</span>;
  const bg = LEVEL_COLORS[level - 1];
  return (
    <span
      className={cn('inline-flex size-7 items-center justify-center rounded text-xs font-semibold', stale && 'opacity-50', className)}
      style={verified ? { background: bg, color: level >= 4 ? '#fff' : '#1e3a66' } : { border: `2px dashed ${LEVEL_COLORS[Math.max(2, level - 1)]}`, color: '#1e3a66' }}
    >
      {level}
    </span>
  );
}

/** 1–5 buttons plus "none"; each shows its meaning on hover */
export function LevelPicker({ value, onChange, disabled }: { value: number | null; onChange: (v: number | null) => void; disabled?: boolean }) {
  const t = useTranslations('skills');
  return (
    <div className="flex flex-wrap gap-1.5">
      <button type="button" disabled={disabled} onClick={() => onChange(null)}
        className={cn('h-9 rounded-md border px-3 text-xs', value === null ? 'border-primary bg-primary/10 font-medium' : 'border-grid hover:bg-muted', disabled && 'opacity-50')}>
        {t('level.none')}
      </button>
      {SKILL_LEVELS.map((l) => (
        <button key={l} type="button" disabled={disabled} title={`${t(`level.${l}.name`)} — ${t(`level.${l}.hint`)}`} onClick={() => onChange(l)}
          className={cn('flex h-9 min-w-9 items-center justify-center rounded-md border text-sm font-semibold transition-shadow',
            value === l ? 'ring-2 ring-primary ring-offset-1' : 'border-transparent hover:ring-1 hover:ring-grid', disabled && 'opacity-50')}
          style={{ background: LEVEL_COLORS[l - 1], color: l >= 4 ? '#fff' : '#1e3a66' }}>
          {l}
        </button>
      ))}
    </div>
  );
}

export function LevelLegend() {
  const t = useTranslations('skills');
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
      {SKILL_LEVELS.map((l) => (
        <span key={l} className="inline-flex items-center gap-1.5" title={t(`level.${l}.hint`)}>
          <LevelBadge level={l} className="size-5 text-[10px]" /> {t(`level.${l}.name`)}
        </span>
      ))}
      <span className="inline-flex items-center gap-1.5"><LevelBadge level={3} verified={false} className="size-5 text-[10px]" /> {t('legend.self')}</span>
      <span className="inline-flex items-center gap-1.5"><LevelBadge level={3} stale className="size-5 text-[10px]" /> {t('legend.stale')}</span>
    </div>
  );
}
