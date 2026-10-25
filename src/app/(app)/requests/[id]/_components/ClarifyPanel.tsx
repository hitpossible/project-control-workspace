'use client';

import { ChevronRight, CircleHelp, Mic } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { CoverageIcon } from '../../_components/AiClarifyDialog';
import { Section } from '@/components/shared/common';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { coverageCount } from '@/lib/clarify';
import { fmtDateTime } from '@/lib/format';
import type { ProjectRequest } from '@/lib/types';
import { cn } from '@/lib/utils';

/** What the AI clarification covered, its Q&A and the full conversation */
export function ClarifyPanel({ r }: { r: ProjectRequest }) {
  const t = useTranslations('requestDetail');
  const coverage = r.ai_coverage ? coverageCount(r.ai_coverage) : null;
  return (
    <Section
      title={t('clarify.title')}
      actions={r.ai_coverage && <span className="text-xs text-muted-foreground">{t('clarify.checked', { at: fmtDateTime(r.ai_coverage.checked_at) })}</span>}
    >
      <p className="mb-3 text-xs text-muted-foreground">{t('clarify.note')}</p>
      {coverage && coverage.missing.length > 0 && (
        <Alert className="mb-3 border-[#fdab3d] bg-[#fff6e5]"><CircleHelp /><AlertDescription>
          {t.rich('clarify.missing', { items: coverage.missing.map((m) => m.label).join(', '), b: (c) => <b>{c}</b> })}
        </AlertDescription></Alert>
      )}
      {r.ai_coverage && (() => {
        const applicable = r.ai_coverage.criteria.filter((c) => c.status !== 'not_applicable');
        const na = r.ai_coverage.criteria.filter((c) => c.status === 'not_applicable');
        return (
          <>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {applicable.map((c) => (
                <div key={c.key} className={cn('rounded-lg border p-3', c.status === 'missing' && 'border-[#fdab3d]/60 bg-[#fff8eb]')}>
                  <div className="mb-1 flex items-center gap-1.5 text-sm font-semibold">
                    <CoverageIcon c={c} />
                    <span className="flex-1">{c.label}</span>
                    {c.required && <span className="rounded bg-muted px-1.5 text-[10px] font-medium text-muted-foreground uppercase">{t('clarify.required')}</span>}
                  </div>
                  <div className="text-sm break-words whitespace-pre-wrap text-muted-foreground" title={c.note ?? undefined}>
                    {c.summary || (c.status === 'missing' ? <i>{t('clarify.notCovered')}</i> : c.note)}
                  </div>
                </div>
              ))}
            </div>
            {na.length > 0 && (
              <p className="mt-3 text-xs text-muted-foreground">{t('clarify.notApplicable', { items: na.map((c) => c.label).join(', ') })}</p>
            )}
          </>
        );
      })()}
      {!!r.ai_clarifications?.length && (
        <ol className="mt-4 space-y-3 border-t pt-4">
          {r.ai_clarifications.map((c, i) => (
            <li key={i} className="text-sm">
              <div className="font-medium">{i + 1}. {c.question}</div>
              {c.answer
                ? <div className="mt-0.5 whitespace-pre-wrap break-words text-muted-foreground">{c.answer}</div>
                : <div className="mt-0.5 text-xs text-muted-foreground italic">{t('clarify.skipped')}</div>}
            </li>
          ))}
        </ol>
      )}
      {!!r.ai_chat?.length && (
        <details className="group mt-4 rounded-lg border">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm font-medium select-none">
            <ChevronRight className="size-4 transition-transform group-open:rotate-90" /> {t('clarify.conversation')}
            <span className="text-xs font-normal text-muted-foreground">· {t('clarify.messages', { count: r.ai_chat.length })}</span>
          </summary>
          <div className="max-h-[32rem] space-y-2 overflow-y-auto border-t px-3 py-3">
            {r.ai_chat.map((m, i) => (
              <div key={i} className={cn('flex', m.role === 'user' && 'justify-end')}>
                <div className={cn('max-w-[85%] rounded-2xl px-3 py-2 text-sm break-words whitespace-pre-wrap',
                  m.role === 'user' ? 'rounded-br-md bg-primary text-white' : 'rounded-bl-md bg-muted')}>
                  {m.content}
                  {/* a speech-to-text transcript: words may be misheard */}
                  {m.voice && <span className="mt-1 flex items-center gap-1 text-[10px] opacity-70"><Mic className="size-3" /> {t('clarify.spoken')}</span>}
                </div>
              </div>
            ))}
          </div>
        </details>
      )}
    </Section>
  );
}
