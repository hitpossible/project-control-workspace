'use client';

import { useTranslations } from 'next-intl';
import { useApp } from '@/providers/AppProvider';
import { useOptions } from '@/i18n/useOptions';
import { fmtDateTime } from '@/lib/format';
import type { ApprovalAction, ApprovalStep } from '@/lib/types';
import { Bubble, HISTORY_META } from './approvalMeta';

/** Every approval action on the request, newest first */
export function ApprovalHistory({ actions, steps }: { actions: ApprovalAction[]; steps: ApprovalStep[] }) {
  const t = useTranslations('requestDetail');
  const { text: enumText } = useOptions();
  const { profileName } = useApp();
  if (actions.length === 0) return <p className="text-sm text-muted-foreground">{t('noActions')}</p>;
  return (
    <ol>
      {[...actions].reverse().map((a, i, all) => {
        const meta = HISTORY_META[a.action] ?? HISTORY_META.cancel;
        return (
          <li key={a.id} className="relative flex gap-3 pb-4 last:pb-0">
            {i < all.length - 1 && <span className="absolute top-7 bottom-0 left-[13px] w-0.5 bg-border" />}
            <Bubble tone={meta}><meta.icon className="size-3.5" strokeWidth={2.5} /></Bubble>
            <div className="min-w-0 flex-1 pt-0.5">
              <div className="text-sm">
                <span className="font-semibold" style={{ color: meta.fg }}>{enumText('approvalAction', a.action)}</span>
                {a.step_code && <span className="text-xs text-muted-foreground"> · {steps.find((s) => s.id === a.step_id)?.step_name ?? a.step_code.replace('_', ' ')}</span>}
              </div>
              <div className="text-xs text-muted-foreground"><span className="font-medium text-foreground">{profileName(a.action_by)}</span> · {fmtDateTime(a.created_at)}</div>
              {a.comment && <div className="mt-1.5 rounded-md border-l-2 bg-muted/60 px-2.5 py-1.5 text-xs italic" style={{ borderColor: meta.fg }}>“{a.comment}”</div>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
