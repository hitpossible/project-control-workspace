'use client';

import { ArrowRight, FolderKanban, Loader2, RefreshCw, Sparkles, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import type { AiAnalysis } from '@/lib/clarify';
import { dbClient } from '@/lib/db/client';
import { fmtDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Section } from '@/components/shared/layout';
import { Button } from '@/components/ui/button';

/** labels: ai.analysis.complexity.<level> */
const COMPLEXITY: Record<NonNullable<AiAnalysis['complexity']>, { fg: string; bg: string }> = {
  low: { fg: '#00854d', bg: '#e3f8ee' },
  medium: { fg: '#b45309', bg: '#fff1d6' },
  high: { fg: '#d83a52', bg: '#fdebee' },
};
const readinessColor = (n: number) => (n >= 80 ? '#00c875' : n >= 50 ? '#fdab3d' : '#e2445c');
/** where the reviewer's estimate falls against the AI's range */
function mdVerdict(md: number, lo: number, hi: number, t: ReturnType<typeof useTranslations<'ai.analysis'>>) {
  if (md < lo) return { label: t('verdict.below', { pct: Math.round(((lo - md) / lo) * 100) }), color: '#0073ea' };
  if (md > hi) return { label: t('verdict.above', { pct: Math.round(((md - hi) / hi) * 100) }), color: '#d83a52' };
  return { label: t('verdict.within'), color: '#00854d' };
}
const PHASE_COLORS = ['#579bfc', '#a25ddc', '#fdab3d', '#00c875'];
/** a pending analysis older than this is treated as lost (server restarted mid-way) */
const STALE_MS = 3 * 60_000;

function Label({ children }: { children: React.ReactNode }) {
  return <div className="mb-1 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{children}</div>;
}

/**
 * The AI's initial analysis of a submitted request (written in the background after submit). Polls only this column
 * while it is being written, so the rest of the page (e.g. an unsaved review) is left alone.
 * `reviewer` shows the System Service parts (suggested type / template, similar projects); `onApply` puts the
 * suggested type / template into the review form.
 */
export default function AiAnalysisCard({ requestId, initial, reviewerMd, canRun, reviewer, onApply, onError }: {
  requestId: number;
  initial: AiAnalysis | null;
  /** System Service's own estimate, shown next to the AI's for comparison */
  reviewerMd: number | null;
  canRun: boolean;
  reviewer: boolean;
  onApply?: (projectTypeId: number | null, templateId: number | null) => void;
  onError: (msg: string) => void;
}) {
  const t = useTranslations('ai.analysis');
  const db = dbClient();
  const [analysis, setAnalysis] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  // eslint-disable-next-line react-hooks/set-state-in-effect -- follow the page after it reloads the request
  useEffect(() => setAnalysis(initial), [initial]);
  const onRefresh = useCallback(async () => {
    const { data } = await db.from('project_requests').select('ai_analysis').eq('id', requestId).maybeSingle();
    if (data) setAnalysis((data as { ai_analysis: AiAnalysis | null }).ai_analysis);
    setNow(Date.now());
  }, [db, requestId]);
  const pending = analysis?.status === 'pending' && now - new Date(analysis.analyzed_at).getTime() < STALE_MS;

  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(() => onRefresh(), 4000);
    return () => clearInterval(timer);
  }, [pending, onRefresh]);

  const run = async () => {
    setBusy(true);
    try {
      const j = await fetch(`/api/requests/${requestId}/analysis`, { method: 'POST' }).then((r) => r.json());
      if (j.error) onError(j.error.message);
      else if (j.data?.off) onError(t('off'));
      await onRefresh();
    } catch {
      onError(t('startFailed'));
    } finally {
      setBusy(false);
    }
  };

  if (!analysis && !canRun) return null;
  const done = analysis?.status === 'done' ? analysis : null;
  const cx = done?.complexity ? COMPLEXITY[done.complexity] : null;

  return (
    <Section
      title={<span className="flex items-center gap-1.5"><Sparkles className="size-4 text-[#784bd1]" /> {t('title')}</span>}
      className="ring-[#784bd1]/30"
      actions={canRun && !pending && (
        <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs" disabled={busy} onClick={run} title={done ? t('again') : t('run')}>
          <RefreshCw className={cn('size-3.5', busy && 'animate-spin')} /> {done ? t('reanalyze') : t('analyze')}
        </Button>
      )}
    >
      {pending ? (
        <div className="flex items-center gap-2 py-3 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> {t('analyzing')}</div>
      ) : !done ? (
        <p className="text-sm text-muted-foreground">
          {analysis ? t('failed') : t('none')}
          {canRun && ` ${t('tryAgain')}`}
        </p>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-px overflow-hidden rounded-lg bg-border ring-1 ring-border">
            <div className="bg-card px-2.5 py-2">
              <div className="text-[11px] text-muted-foreground">{t('complexityLabel')}</div>
              {cx && <span className="mt-0.5 inline-block rounded-full px-2 py-0.5 text-xs font-semibold" style={{ background: cx.bg, color: cx.fg }}>{t(`complexity.${done.complexity!}`)}</span>}
            </div>
            <div className="bg-card px-2.5 py-2">
              <div className="text-[11px] text-muted-foreground">{t('readiness')}</div>
              <div className="text-sm font-semibold tabular-nums">{done.readiness ?? 0}%</div>
              <span className="mt-1 block h-1 overflow-hidden rounded-full bg-muted">
                <span className="block h-full rounded-full" style={{ width: `${done.readiness ?? 0}%`, background: readinessColor(done.readiness ?? 0) }} />
              </span>
            </div>
            <div className="bg-card px-2.5 py-2">
              <div className="text-[11px] text-muted-foreground">{t('effort')}</div>
              <div className="text-sm font-semibold tabular-nums">{t('md', { md: done.effort_min === done.effort_max ? String(done.effort_min) : `${done.effort_min}–${done.effort_max}` })}</div>
              {reviewerMd != null && (() => {
                const v = mdVerdict(reviewerMd, done.effort_min ?? 0, done.effort_max ?? 0, t);
                return (
                  <div className="mt-0.5 text-[11px] tabular-nums" title={t('reviewerTip')}>
                    <span className="text-muted-foreground">{t('reviewer')}</span> <span className="font-semibold">{t('md', { md: String(reviewerMd) })}</span>{' '}
                    <span className="font-medium" style={{ color: v.color }}>{v.label}</span>
                  </div>
                );
              })()}
            </div>
          </div>

          {!!done.phases?.length && (() => {
            const total = done.phases.reduce((sum, x) => sum + x.md, 0);
            return (
              <div>
                <Label>{t('phases')} <span className="font-normal tracking-normal normal-case">· {t('mostLikely', { md: total })}</span></Label>
                <div className="mb-1.5 flex h-1.5 overflow-hidden rounded-full bg-muted">
                  {done.phases.map((x, i) => <span key={x.phase} style={{ width: `${(x.md / total) * 100}%`, background: PHASE_COLORS[i % PHASE_COLORS.length] }} />)}
                </div>
                <ul className="space-y-0.5 text-sm">
                  {done.phases.map((x, i) => (
                    <li key={x.phase} className="flex items-center gap-2">
                      <span className="size-2 shrink-0 rounded-full" style={{ background: PHASE_COLORS[i % PHASE_COLORS.length] }} />
                      <span className="flex-1">{x.phase}</span>
                      <span className="font-medium tabular-nums">{t('md', { md: String(x.md) })}</span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })()}

          {done.rationale && (
            <div>
              <Label>{t('why')}</Label>
              <p className="text-sm text-muted-foreground">{done.rationale}</p>
            </div>
          )}

          {reviewer && (done.project_type || done.template) && (
            <div className="rounded-lg border px-3 py-2">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <Label>{t('suggested')}</Label>
                  <div className="text-sm"><span className="text-muted-foreground">{t('type')}</span> <span className="font-medium">{done.project_type?.name ?? '-'}</span></div>
                  <div className="text-sm"><span className="text-muted-foreground">{t('template')}</span> <span className="font-medium">{done.template?.name ?? '-'}</span></div>
                </div>
                {onApply && (
                  <Button variant="outline" size="sm" className="h-7 shrink-0 px-2 text-xs" onClick={() => onApply(done.project_type?.id ?? null, done.template?.id ?? null)}>{t('use')}</Button>
                )}
              </div>
            </div>
          )}

          {reviewer && !!done.similar?.length && (
            <div>
              <Label>{t('similar')}</Label>
              <ul className="space-y-1.5">
                {done.similar.map((p) => (
                  <li key={p.id} className="flex gap-1.5 text-sm">
                    <FolderKanban className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0">
                      <Link href={`/projects/${p.id}`} className="font-medium text-primary hover:underline">{p.code}</Link> {p.name}
                      {p.reason && <span className="block text-xs text-muted-foreground">{p.reason}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {!!done.modules?.length && (
            <div>
              <Label>{t('modules')}</Label>
              <div className="flex flex-wrap gap-1.5">
                {done.modules.map((m) => <span key={m} className="rounded-md bg-[#f1eafc] px-2 py-0.5 text-xs font-medium text-[#784bd1]">{m}</span>)}
              </div>
            </div>
          )}

          {!!done.risks?.length && (
            <div>
              <Label>{t('risks')}</Label>
              <ul className="space-y-1">
                {done.risks.map((x) => (
                  <li key={x} className="flex gap-1.5 text-sm"><TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-[#b45309]" />{x}</li>
                ))}
              </ul>
            </div>
          )}

          {done.next_step && (
            <div className="rounded-lg bg-[#e6f1fd] px-3 py-2">
              <Label>{t('nextStep')}</Label>
              <div className="flex gap-1.5 text-sm font-medium text-[#0060c2]"><ArrowRight className="mt-0.5 size-3.5 shrink-0" />{done.next_step}</div>
            </div>
          )}

          <p className="text-[11px] text-muted-foreground">{t('footer', { at: fmtDateTime(done.analyzed_at) })}</p>
        </div>
      )}
    </Section>
  );
}
