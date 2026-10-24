'use client';

import { ArrowRight, Loader2, RefreshCw, Sparkles, TriangleAlert } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { AiAnalysis } from '@/lib/clarify';
import { dbClient } from '@/lib/db/client';
import { fmtDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Section } from './common';
import { Button } from './ui/button';

const COMPLEXITY: Record<NonNullable<AiAnalysis['complexity']>, { label: string; fg: string; bg: string }> = {
  low: { label: 'Low', fg: '#00854d', bg: '#e3f8ee' },
  medium: { label: 'Medium', fg: '#b45309', bg: '#fff1d6' },
  high: { label: 'High', fg: '#d83a52', bg: '#fdebee' },
};
const readinessColor = (n: number) => (n >= 80 ? '#00c875' : n >= 50 ? '#fdab3d' : '#e2445c');
/** a pending analysis older than this is treated as lost (server restarted mid-way) */
const STALE_MS = 3 * 60_000;

function Label({ children }: { children: React.ReactNode }) {
  return <div className="mb-1 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{children}</div>;
}

/**
 * The AI's initial analysis of a submitted request (written in the background after submit). Polls only this column
 * while it is being written, so the rest of the page (e.g. an unsaved review) is left alone.
 */
export default function AiAnalysisCard({ requestId, initial, canRun, onError }: {
  requestId: number;
  initial: AiAnalysis | null;
  canRun: boolean;
  onError: (msg: string) => void;
}) {
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
    const t = setInterval(() => onRefresh(), 4000);
    return () => clearInterval(t);
  }, [pending, onRefresh]);

  const run = async () => {
    setBusy(true);
    try {
      const j = await fetch(`/api/requests/${requestId}/analysis`, { method: 'POST' }).then((r) => r.json());
      if (j.error) onError(j.error.message);
      else if (j.data?.off) onError('AI is not set up on this server');
      await onRefresh();
    } catch {
      onError('Could not start the analysis');
    } finally {
      setBusy(false);
    }
  };

  if (!analysis && !canRun) return null;
  const done = analysis?.status === 'done' ? analysis : null;
  const cx = done?.complexity ? COMPLEXITY[done.complexity] : null;

  return (
    <Section
      title={<span className="flex items-center gap-1.5"><Sparkles className="size-4 text-[#784bd1]" /> AI Initial Analysis</span>}
      className="ring-[#784bd1]/30"
      actions={canRun && !pending && (
        <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs" disabled={busy} onClick={run} title={done ? 'Analyze again' : 'Run analysis'}>
          <RefreshCw className={cn('size-3.5', busy && 'animate-spin')} /> {done ? 'Re-analyze' : 'Analyze'}
        </Button>
      )}
    >
      {pending ? (
        <div className="flex items-center gap-2 py-3 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Analyzing the request…</div>
      ) : !done ? (
        <p className="text-sm text-muted-foreground">
          {analysis ? 'The AI could not analyze this request this time.' : 'No analysis yet.'}
          {canRun && ' Press Analyze to try again.'}
        </p>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-px overflow-hidden rounded-lg bg-border ring-1 ring-border">
            <div className="bg-card px-2.5 py-2">
              <div className="text-[11px] text-muted-foreground">Complexity</div>
              {cx && <span className="mt-0.5 inline-block rounded-full px-2 py-0.5 text-xs font-semibold" style={{ background: cx.bg, color: cx.fg }}>{cx.label}</span>}
            </div>
            <div className="bg-card px-2.5 py-2">
              <div className="text-[11px] text-muted-foreground">Readiness</div>
              <div className="text-sm font-semibold tabular-nums">{done.readiness ?? 0}%</div>
              <span className="mt-1 block h-1 overflow-hidden rounded-full bg-muted">
                <span className="block h-full rounded-full" style={{ width: `${done.readiness ?? 0}%`, background: readinessColor(done.readiness ?? 0) }} />
              </span>
            </div>
            <div className="bg-card px-2.5 py-2">
              <div className="text-[11px] text-muted-foreground">Est. Effort</div>
              <div className="text-sm font-semibold tabular-nums">{done.effort_min === done.effort_max ? done.effort_min : `${done.effort_min}–${done.effort_max}`} MD</div>
            </div>
          </div>

          {!!done.modules?.length && (
            <div>
              <Label>Suggested Modules</Label>
              <div className="flex flex-wrap gap-1.5">
                {done.modules.map((m) => <span key={m} className="rounded-md bg-[#f1eafc] px-2 py-0.5 text-xs font-medium text-[#784bd1]">{m}</span>)}
              </div>
            </div>
          )}

          {!!done.risks?.length && (
            <div>
              <Label>Potential Risks</Label>
              <ul className="space-y-1">
                {done.risks.map((x) => (
                  <li key={x} className="flex gap-1.5 text-sm"><TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-[#b45309]" />{x}</li>
                ))}
              </ul>
            </div>
          )}

          {done.next_step && (
            <div className="rounded-lg bg-[#e6f1fd] px-3 py-2">
              <Label>Suggested Next Step</Label>
              <div className="flex gap-1.5 text-sm font-medium text-[#0060c2]"><ArrowRight className="mt-0.5 size-3.5 shrink-0" />{done.next_step}</div>
            </div>
          )}

          <p className="text-[11px] text-muted-foreground">AI estimate from the request and interview — {fmtDateTime(done.analyzed_at)}. Please verify before planning.</p>
        </div>
      )}
    </Section>
  );
}
