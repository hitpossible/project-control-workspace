'use client';

import { Check, Hourglass, Rocket } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { ActionButton } from '@/components/shared/form';
import { confirmDialog } from '@/components/shared/ConfirmDialog';
import { fmtDate } from '@/lib/format';
import type { ApprovalStep } from '@/lib/types';
import { cn } from '@/lib/utils';
import { ACT_META, type Act } from './approvalMeta';

type Props =
  | { mode: 'approval'; waiting: ApprovalStep; steps: ApprovalStep[]; onAct: (a: Act) => void }
  | { mode: 'convert'; conv: { start: string; target: string; sponsor: string }; onShowDates: () => void; onConvert: () => Promise<void> };

/**
 * The decision lives here rather than in a card, so it stays on screen however far the details run.
 * It sits in the page flow, so at the very bottom it settles below the content instead of covering it.
 */
export function DecisionBar(props: Props) {
  const t = useTranslations('requestDetail');
  return (
    <div className={cn(
      'sticky bottom-4 z-30 mt-5 flex items-center gap-3 rounded-xl border bg-white/95 p-2.5 pl-3 shadow-[0_8px_30px_rgba(0,0,0,0.12)] ring-1 backdrop-blur animate-in fade-in slide-in-from-bottom-4',
      props.mode === 'approval' ? 'ring-primary/40' : 'ring-[#00c875]/40',
    )}>
      {props.mode === 'approval' ? (
        <>
          <div className="flex min-w-0 flex-1 items-center gap-2.5">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-white"><Hourglass className="size-3.5" /></span>
            <span className="min-w-0">
              <span className="block text-[11px] font-medium text-primary">{t('bar.actionRequired', { step: props.steps.indexOf(props.waiting) + 1, total: props.steps.length })}</span>
              <span className="block truncate text-sm font-semibold">{props.waiting.step_name}</span>
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {(Object.keys(ACT_META) as Act[]).filter((a) => a !== 'approve').map((a) => {
              const Icon = ACT_META[a].icon;
              return (
                <ActionButton key={a} tone={ACT_META[a].tone} outline title={t(`act.${a}.label`)} aria-label={t(`act.${a}.label`)} className="h-9 gap-1.5 px-2.5 text-xs" onClick={() => props.onAct(a)}>
                  <Icon className="size-4" /><span className="hidden lg:inline">{t(`act.${a}.short`)}</span>
                </ActionButton>
              );
            })}
            <ActionButton tone="success" className="h-9 gap-1.5 px-4 text-sm shadow-sm" onClick={() => props.onAct('approve')}>
              <Check className="size-4" strokeWidth={3} /> {t('act.approve.label')}
            </ActionButton>
          </div>
        </>
      ) : (
        <ConvertBar {...props} />
      )}
    </div>
  );
}

function ConvertBar({ conv, onShowDates, onConvert }: Extract<Props, { mode: 'convert' }>) {
  const t = useTranslations('requestDetail');
  return (
    <>
      <button type="button" title={t('bar.editDates')} className="flex min-w-0 flex-1 items-center gap-2.5 text-left" onClick={onShowDates}>
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[#00c875] text-white"><Rocket className="size-3.5" /></span>
        <span className="min-w-0">
          <span className="block text-[11px] font-medium text-[#00854d]">{t('bar.readyToConvert')}</span>
          <span className="block truncate text-sm font-semibold">{conv.start && conv.target ? `${fmtDate(conv.start)} → ${fmtDate(conv.target)}` : t('bar.setDates')}</span>
        </span>
      </button>
      <div className="flex shrink-0 items-center gap-1.5">
        <ActionButton tone="success" className="h-9 gap-1.5 px-4 text-sm shadow-sm" onClick={async () => {
          // Dates live in the card, so send the user there when they are missing; otherwise confirm what will be created.
          if (!conv.start || !conv.target) return onShowDates();
          if (await confirmDialog({ title: t('convert.confirmTitle'), description: conv.sponsor ? t('convert.confirmWithSponsor', { from: fmtDate(conv.start), to: fmtDate(conv.target), sponsor: conv.sponsor }) : t('convert.confirmText', { from: fmtDate(conv.start), to: fmtDate(conv.target) }), confirmText: t('convert.confirm') })) await onConvert();
        }}>
          <Rocket className="size-4" /> {t('convert.button')}<span className="hidden sm:inline"> {t('convert.buttonSuffix')}</span>
        </ActionButton>
      </div>
    </>
  );
}
