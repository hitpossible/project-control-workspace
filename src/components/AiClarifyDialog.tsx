'use client';

import { Check, Circle, Loader2, Minus, Sparkles } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { MAX_ROUNDS, coverageCount, type AiCoverage, type CriterionCoverage } from '@/lib/clarify';
import { errMsg } from '@/lib/format';
import { dbClient } from '@/lib/db/client';
import type { AiClarification, ProjectRequest } from '@/lib/types';
import { cn } from '@/lib/utils';
import { useApp } from './AppProvider';
import { TextField } from './common';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';

type Question = { key: string; question: string };
type RoundResult = { questions: Question[] | null; coverage: AiCoverage | null };

export function CoverageIcon({ c }: { c: Pick<CriterionCoverage, 'status' | 'required'> }) {
  if (c.status === 'covered') return <Check className="size-3.5 shrink-0 text-[#00854d]" strokeWidth={3} />;
  if (c.status === 'not_applicable') return <Minus className="size-3.5 shrink-0 text-muted-foreground" />;
  return <Circle className={cn('size-3.5 shrink-0', c.required ? 'text-[#d83a52]' : 'text-muted-foreground')} />;
}

/**
 * Just before submit: the AI checks the document type's criteria against the saved draft and asks about the missing
 * ones, round after round (at most MAX_ROUNDS), until nothing important is missing. Answers are saved on the request
 * (ai_clarifications) after every round. AI off, failing or with nothing to ask → submits straight away;
 * the requestor can always skip.
 */
export default function AiClarifyDialog({ request, onSubmit, onClose }: {
  request: ProjectRequest;
  onSubmit: (r: ProjectRequest) => Promise<void>;
  onClose: () => void;
}) {
  const db = dbClient();
  const { notify } = useApp();
  const [req, setReq] = useState(request);
  const [round, setRound] = useState(1);
  const [questions, setQuestions] = useState<Question[] | null>(null);
  const [answers, setAnswers] = useState<string[]>([]);
  const [coverage, setCoverage] = useState<AiCoverage | null>(request.ai_coverage);
  const [busy, setBusy] = useState(false);
  const ctrl = useRef<AbortController | null>(null);

  const submit = async (r: ProjectRequest) => {
    setBusy(true);
    try {
      await onSubmit(r);
    } finally {
      setBusy(false);
      onClose();
    }
  };

  /** One AI round; null = AI off / failed, 'aborted' = the requestor moved on (skip, back, closed) */
  const check = async (): Promise<RoundResult | null | 'aborted'> => {
    const c = (ctrl.current = new AbortController());
    try {
      const res = await fetch(`/api/requests/${request.id}/clarify`, { method: 'POST', signal: c.signal });
      const json = await res.json();
      if (!res.ok || json.error) throw new Error(json.error?.message ?? res.statusText);
      return json.data as RoundResult;
    } catch {
      return c.signal.aborted ? 'aborted' : null;
    } finally {
      if (ctrl.current === c) ctrl.current = null;
    }
  };

  /** Show the next questions, or submit when there is nothing (more) to ask */
  const next = async (r: ProjectRequest, last: boolean) => {
    setQuestions(null);
    const out = await check();
    if (out === 'aborted') return;
    if (out?.coverage) setCoverage(out.coverage);
    if (!out || last || !out.questions?.length) return submit(r);
    setQuestions(out.questions);
    setAnswers(out.questions.map(() => ''));
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data fetch
    void next(request, false);
    return () => ctrl.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- start the first round once
  }, []);

  /** Append this round's answers (blank = skipped) to the request */
  const saveAnswers = async (): Promise<ProjectRequest | null> => {
    if (!questions?.length) return req;
    const asked_at = new Date().toISOString();
    const added: AiClarification[] = questions.map((q, i) => ({ criterion: q.key, question: q.question, answer: answers[i].trim() || null, asked_at }));
    const res = await db.from('project_requests')
      .update({ ai_clarifications: [...(req.ai_clarifications ?? []), ...added] })
      .eq('id', req.id).select().single();
    if (res.error) {
      notify(errMsg(res.error), 'error');
      return null;
    }
    setReq(res.data as ProjectRequest);
    return res.data as ProjectRequest;
  };

  const proceed = async () => {
    setBusy(true);
    const r = await saveAnswers();
    setBusy(false);
    if (!r) return;
    // after the last round the AI checks once more so the approvers see an up-to-date checklist, then it submits
    setRound((n) => n + 1);
    await next(r, round >= MAX_ROUNDS);
  };

  const skip = async () => {
    ctrl.current?.abort();
    setBusy(true);
    const r = answers.some((a) => a.trim()) ? await saveAnswers() : req;
    setBusy(false);
    if (r) await submit(r);
  };

  const { covered, total } = coverageCount(coverage);
  const lastRound = round >= MAX_ROUNDS;
  const labelOf = (key: string) => coverage?.criteria.find((c) => c.key === key)?.label;

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Sparkles className="size-4 text-primary" /> A few questions about your project</DialogTitle>
          <DialogDescription>
            Your answers are attached to the request so the System Service team can understand and plan it without coming back to you.
            Leave a question blank to skip it, or answer &quot;not sure yet&quot;.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_14rem]">
          <div className="min-w-0">
            {!questions ? (
              <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> {round === 1 ? 'AI is reading your request' : 'AI is checking your answers'}
              </div>
            ) : (
              <div className="max-h-[55vh] space-y-3 overflow-y-auto pr-1">
                <div className="text-xs font-medium text-muted-foreground">Round {round} of {MAX_ROUNDS}</div>
                {questions.map((q, i) => (
                  <div key={`${round}-${i}`}>
                    {labelOf(q.key) && <div className="mb-0.5 text-[11px] font-semibold tracking-wide text-primary uppercase">{labelOf(q.key)}</div>}
                    <TextField label={`${i + 1}. ${q.question}`} multiline rows={2} value={answers[i]}
                      onChange={(v) => setAnswers((a) => a.map((x, j) => (j === i ? v : x)))} />
                  </div>
                ))}
              </div>
            )}
          </div>

          {coverage && (
            <aside className="rounded-lg border bg-muted/30 p-3">
              <div className="mb-2 flex items-baseline justify-between text-xs">
                <span className="font-semibold">Checklist</span>
                <span className="text-muted-foreground">Required {covered}/{total}</span>
              </div>
              <ul className="space-y-1.5">
                {coverage.criteria.map((c) => (
                  <li key={c.key} className="flex items-center gap-1.5 text-xs" title={c.note ?? undefined}>
                    <CoverageIcon c={c} />
                    <span className={cn('truncate', c.status !== 'missing' && 'text-muted-foreground')}>{c.label}</span>
                    {c.required && c.status === 'missing' && <span className="text-[#d83a52]">*</span>}
                  </li>
                ))}
              </ul>
            </aside>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => { ctrl.current?.abort(); onClose(); }}>Back to Edit</Button>
          <Button variant="ghost" disabled={busy} onClick={skip}>Skip & Submit</Button>
          {questions && (
            <Button disabled={busy} onClick={proceed}>
              {busy && <Loader2 className="animate-spin" />} {lastRound ? 'Submit for Approval' : 'Continue'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
