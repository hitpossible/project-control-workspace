'use client';

import { Users } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Fragment } from 'react';
import { useApp } from '@/providers/AppProvider';
import { stepGroup } from '@/lib/approval';
import { fmtDateTime } from '@/lib/format';
import type { ApprovalStep } from '@/lib/types';
import { cn } from '@/lib/utils';
import { Bubble, STEP_META } from './approvalMeta';

/** The steps of the current approval cycle, grouped by stage */
export function ApprovalRoute({ steps, canAct, audience }: { steps: ApprovalStep[]; canAct: boolean; audience: (s: ApprovalStep) => string }) {
  const t = useTranslations('requestDetail');
  const te = useTranslations('enums');
  const { profileName } = useApp();
  if (steps.length === 0) return <p className="text-sm text-muted-foreground">{t('notSubmittedYet')}</p>;
  return (
    <ol>
      {steps.map((s, i) => {
        const meta = STEP_META[s.status];
        const group = stepGroup(s);
        const newGroup = i === 0 || group !== stepGroup(steps[i - 1]);
        const isWaiting = s.status === 'waiting';
        return (
          <Fragment key={s.id}>
            {newGroup && (
              <li className={cn('relative pb-2 pl-10', i > 0 && 'pt-1')}>
                {i > 0 && <span className={cn('absolute inset-y-0 left-[13px] w-0.5', steps[i - 1].status === 'approved' ? 'bg-[#00c875]' : 'bg-border')} />}
                <span className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{te(`routeGroup.${group}`)}</span>
              </li>
            )}
            <li className="relative flex gap-3 pb-4 last:pb-0">
              {i < steps.length - 1 && (
                <span className={cn('absolute top-7 bottom-0 left-[13px] w-0.5', s.status === 'approved' ? 'bg-[#00c875]' : 'bg-border')} />
              )}
              <Bubble tone={meta ?? { fg: '#676879', bg: '#eef0f4' }}>
                {meta ? <meta.icon className="size-3.5" strokeWidth={2.5} /> : s.step_no}
              </Bubble>
              <div className={cn('min-w-0 flex-1', isWaiting && '-mt-1 rounded-lg border border-[#fdab3d]/60 bg-[#fff8eb] px-3 py-2')}>
                <div className="flex items-start gap-2">
                  <span className={cn('flex-1 pt-1 text-sm font-semibold', !meta && 'text-muted-foreground')}>{s.step_name}</span>
                  <span
                    className={cn('mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium', isWaiting && canAct && 'motion-pulse')}
                    style={meta ? { background: meta.bg, color: meta.fg } : { background: '#eef0f4', color: '#676879' }}
                  >
                    {isWaiting && canAct ? t('yourTurn') : t.has(`stepStatus.${s.status}` as 'stepStatus.waiting') ? t(`stepStatus.${s.status}` as 'stepStatus.waiting') : s.status.replace('_', ' ').replace(/^\w/, (c) => c.toUpperCase())}
                  </span>
                </div>
                <div className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                  <Users className="size-3 shrink-0" />
                  <span className="truncate">{audience(s)}</span>
                </div>
                {s.acted_at && (
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {t.rich('actedBy', { name: profileName(s.acted_by), at: fmtDateTime(s.acted_at), b: (c) => <span className="font-medium text-foreground">{c}</span> })}
                  </div>
                )}
                {s.comment && <div className="mt-1.5 rounded-md border-l-2 bg-muted/60 px-2.5 py-1.5 text-xs italic" style={{ borderColor: meta?.fg }}>“{s.comment}”</div>}
              </div>
            </li>
          </Fragment>
        );
      })}
    </ol>
  );
}
