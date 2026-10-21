'use client';

import { ArrowLeft, ArrowRight, Check, Circle, Loader2, Minus, RotateCcw, SendHorizontal, Sparkles } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { coverageCount, type AiCoverage, type ChatMessage, type CriterionCoverage } from '@/lib/clarify';
import { errMsg } from '@/lib/format';
import { dbClient } from '@/lib/db/client';
import type { ProjectRequest } from '@/lib/types';
import { cn } from '@/lib/utils';
import { useApp } from './AppProvider';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog';
import { Textarea } from './ui/textarea';

const ENTER = 'pcw-motion motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 motion-safe:duration-300';
const QUICK_REPLIES = ['Not sure yet', 'Skip this question'];

export function CoverageIcon({ c }: { c: Pick<CriterionCoverage, 'status' | 'required'> }) {
  if (c.status === 'covered') return <Check className="size-3.5 shrink-0 text-[#00854d]" strokeWidth={3} />;
  if (c.status === 'not_applicable') return <Minus className="size-3.5 shrink-0 text-muted-foreground" />;
  return <Circle className={cn('size-3.5 shrink-0', c.required ? 'text-[#d83a52]' : 'text-muted-foreground')} />;
}

function AiAvatar({ glow, className }: { glow?: boolean; className?: string }) {
  return (
    <span
      className={cn('pcw-motion flex size-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#0073ea] to-[#a25ddc] text-white shadow-sm', className)}
      style={glow ? { animation: 'pcw-glow 1.6s ease-in-out infinite' } : undefined}
    >
      <Sparkles className="size-4" />
    </span>
  );
}

function TypingDots() {
  return (
    <span className="flex h-5 items-center gap-1" aria-label="AI is typing">
      {[0, 1, 2].map((i) => (
        <span key={i} className="pcw-motion size-1.5 rounded-full bg-muted-foreground" style={{ animation: `pcw-typing 1.2s ease-in-out ${i * 0.15}s infinite` }} />
      ))}
    </span>
  );
}

/** Reveals the AI's reply character by character (≤ 1.6 s), calling onTick so the chat can follow it */
function Typewriter({ text, onTick, onDone }: { text: string; onTick: () => void; onDone: () => void }) {
  const chars = useMemo(() => Array.from(text), [text]);
  const [n, setN] = useState(0);
  const cb = useRef({ onTick, onDone });
  useEffect(() => {
    cb.current = { onTick, onDone };
  });
  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const total = reduced ? 0 : Math.min(1600, Math.max(350, chars.length * 22));
    const t0 = performance.now();
    let raf = 0;
    const step = (t: number) => {
      const k = total ? Math.min(1, (t - t0) / total) : 1;
      setN(Math.ceil(k * chars.length));
      cb.current.onTick();
      if (k < 1) raf = requestAnimationFrame(step);
      else cb.current.onDone();
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [chars]);
  return (
    <>
      {chars.slice(0, n).join('')}
      {n < chars.length && <span className="pcw-motion ml-0.5 inline-block h-4 w-0.5 translate-y-0.5 bg-current" style={{ animation: 'pcw-caret 0.8s step-end infinite' }} />}
    </>
  );
}

type TurnResult = { off?: boolean; message?: ChatMessage | null; coverage?: AiCoverage; done?: boolean };

/**
 * Just before submit the requestor chats with the AI, which asks about the document type's criteria that the form does
 * not cover yet — following up on vague answers — until the important ones are covered. The requestor then reviews the
 * AI's summary per criterion (editable) and submits. The transcript and checklist are saved on the request after every
 * AI message. AI off, or failing on the first message → submits straight away; the requestor can always skip.
 */
export default function AiClarifyDialog({ request, onSubmit, onClose }: {
  request: ProjectRequest;
  onSubmit: (r: ProjectRequest) => Promise<void>;
  onClose: () => void;
}) {
  const db = dbClient();
  const { notify } = useApp();
  const [messages, setMessages] = useState<ChatMessage[]>(request.ai_chat ?? []);
  const [coverage, setCoverage] = useState<AiCoverage | null>(request.ai_coverage);
  const [turns, setTurns] = useState(0);
  const [thinking, setThinking] = useState(false);
  const [failed, setFailed] = useState(false);
  const [done, setDone] = useState(false);
  const [typing, setTyping] = useState<number | null>(null);
  const [flash, setFlash] = useState<Set<string>>(new Set());
  const [input, setInput] = useState('');
  const [phase, setPhase] = useState<'chat' | 'review'>('chat');
  const [summaries, setSummaries] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const ctrl = useRef<AbortController | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const scrollDown = (behavior: ScrollBehavior = 'smooth') => {
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior });
  };

  const submit = async () => {
    ctrl.current?.abort();
    setBusy(true);
    try {
      await onSubmit(request);
    } finally {
      setBusy(false);
      onClose();
    }
  };

  /** Ask the AI for its next message, given the conversation so far */
  const ask = async (msgs: ChatMessage[], n: number) => {
    const c = (ctrl.current = new AbortController());
    setThinking(true);
    setFailed(false);
    let data: TurnResult;
    try {
      const res = await fetch(`/api/requests/${request.id}/clarify`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: c.signal,
        body: JSON.stringify({ messages: msgs, turns: n }),
      });
      const json = await res.json();
      if (!res.ok || json.error) throw new Error(json.error?.message ?? res.statusText);
      data = json.data;
    } catch {
      data = { message: null };
    } finally {
      if (ctrl.current === c) ctrl.current = null;
    }
    if (c.signal.aborted) return;
    setThinking(false);
    if (data.off || (!data.message && !msgs.length)) return submit();
    if (!data.message) return setFailed(true);

    if (data.coverage) {
      // briefly highlight what this answer just covered
      const before = new Map(coverage?.criteria.map((x) => [x.key, x.status]));
      const changed = data.coverage.criteria.filter((x) => x.status !== 'missing' && before.get(x.key) !== x.status).map((x) => x.key);
      setCoverage(data.coverage);
      if (changed.length) {
        setFlash(new Set(changed));
        setTimeout(() => setFlash(new Set()), 1800);
      }
    }
    setMessages([...msgs, data.message]);
    setTyping(msgs.length);
    setTurns(n + 1);
    setDone(!!data.done);
  };

  useEffect(() => {
    const last = messages.at(-1);
    // a conversation left at an AI question (Back to Edit, then Submit again) just continues where it was
    if (!last || last.role === 'user' || request.status === 'need_more_information') {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- first AI message
      void ask(messages, 0);
    }
    requestAnimationFrame(() => scrollDown('auto'));
    return () => ctrl.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- start once
  }, []);

  useEffect(() => {
    scrollDown();
  }, [messages.length, thinking, failed, done]);

  const send = (text: string) => {
    const content = text.trim();
    if (!content || thinking || typing !== null) return;
    const next = [...messages, { role: 'user' as const, content, at: new Date().toISOString() }];
    setMessages(next);
    setInput('');
    setDone(false);
    void ask(next, turns);
  };

  const openReview = () => {
    if (!coverage) return submit();
    ctrl.current?.abort();
    setThinking(false);
    // a missing criterion starts empty: what the requestor types there is what makes it covered
    setSummaries(Object.fromEntries(coverage.criteria.map((c) => [c.key, c.status === 'missing' ? '' : c.summary ?? ''])));
    setPhase('review');
  };

  /** Save the summaries as confirmed by the requestor, then submit */
  const confirm = async () => {
    if (!coverage) return submit();
    const criteria = coverage.criteria.map((c): CriterionCoverage => {
      const summary = summaries[c.key]?.trim() || null;
      if (c.status !== 'missing') return { ...c, summary };
      // still missing: keep whatever partial information the AI noted, unless the requestor filled it in
      return summary ? { ...c, summary, status: 'covered', note: 'Added by the requestor' } : c;
    });
    setBusy(true);
    const res = await db.from('project_requests').update({ ai_coverage: { ...coverage, criteria } }).eq('id', request.id).select().single();
    setBusy(false);
    if (res.error) return notify(errMsg(res.error), 'error');
    await submit();
  };

  const { covered, total } = coverageCount(coverage);
  const pct = total ? Math.round((covered / total) * 100) : 0;
  const inputLocked = thinking || typing !== null || busy;
  const label = (key: string) => coverage?.criteria.find((c) => c.key === key)?.label ?? key;

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="flex h-[min(720px,92vh)] flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl">
        {/* Header */}
        <div className="relative flex items-center gap-3 border-b bg-gradient-to-r from-[#0073ea]/10 via-[#a25ddc]/5 to-transparent px-5 py-4 pr-12">
          <AiAvatar glow={thinking} className="size-10" />
          <div className="min-w-0 flex-1">
            <DialogTitle className="text-base">Project Assistant</DialogTitle>
            <DialogDescription className="text-xs">
              {phase === 'chat' ? 'A few questions so the System Service team can plan your project' : 'Check what the team will see, then submit'}
            </DialogDescription>
          </div>
          {coverage && (
            <span className="rounded-full bg-background/80 px-2.5 py-1 text-xs font-medium shadow-sm ring-1 ring-border sm:hidden">{covered}/{total}</span>
          )}
        </div>

        <div className="grid min-h-0 flex-1 sm:grid-cols-[minmax(0,1fr)_15rem]">
          {/* Chat / review */}
          <div className="flex min-h-0 flex-col">
            {phase === 'chat' ? (
              <>
                <div ref={scroller} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-5">
                  {messages.map((m, i) => m.role === 'assistant' ? (
                    <div key={i} className={cn('flex items-end gap-2', ENTER)}>
                      <AiAvatar />
                      <div className="max-w-[85%]">
                        <div className="rounded-2xl rounded-bl-md bg-muted px-3.5 py-2.5 text-sm leading-relaxed break-words whitespace-pre-wrap">
                          {typing === i
                            ? <Typewriter text={m.content} onTick={() => scrollDown('auto')} onDone={() => { setTyping(null); inputRef.current?.focus(); }} />
                            : m.content}
                        </div>
                        {!!m.criteria?.length && typing !== i && (
                          <div className={cn('mt-1 flex flex-wrap gap-1', ENTER)}>
                            {m.criteria.map((k) => <span key={k} className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">{label(k)}</span>)}
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div key={i} className={cn('flex justify-end', ENTER)}>
                      <div className="max-w-[80%] rounded-2xl rounded-br-md bg-primary px-3.5 py-2.5 text-sm leading-relaxed break-words whitespace-pre-wrap text-white shadow-sm">
                        {m.content}
                      </div>
                    </div>
                  ))}

                  {thinking && (
                    <div className={cn('flex items-end gap-2', ENTER)}>
                      <AiAvatar />
                      <div className="rounded-2xl rounded-bl-md bg-muted px-4 py-2.5"><TypingDots /></div>
                    </div>
                  )}

                  {failed && (
                    <div className={cn('flex items-end gap-2', ENTER)}>
                      <AiAvatar />
                      <div className="rounded-2xl rounded-bl-md border border-[#fdab3d]/60 bg-[#fff8eb] px-3.5 py-2.5 text-sm">
                        The assistant didn&apos;t answer this time.
                        <div className="mt-2 flex gap-2">
                          <Button size="sm" variant="outline" className="h-7" onClick={() => ask(messages, turns)}><RotateCcw /> Try again</Button>
                          <Button size="sm" variant="ghost" className="h-7" onClick={openReview}>Review & Submit</Button>
                        </div>
                      </div>
                    </div>
                  )}

                  {done && typing === null && (
                    <div className={cn('mx-auto flex max-w-sm flex-col items-center gap-2 rounded-xl border border-[#00c875]/40 bg-[#e3f8ee]/60 px-4 py-3 text-center', ENTER)}>
                      <span className="pcw-motion flex size-8 items-center justify-center rounded-full bg-[#00c875] text-white motion-safe:animate-in motion-safe:zoom-in-50 motion-safe:duration-500">
                        <Check className="size-4" strokeWidth={3} />
                      </span>
                      <div className="text-sm font-medium">That covers what the team needs</div>
                      <Button size="sm" onClick={openReview}>Review summary <ArrowRight /></Button>
                    </div>
                  )}
                </div>

                <div className="border-t bg-background px-4 py-3">
                  <div className="mb-2 flex flex-wrap gap-1.5">
                    {QUICK_REPLIES.map((q) => (
                      <button key={q} type="button" disabled={inputLocked || !messages.length}
                        className="rounded-full border px-2.5 py-1 text-xs text-muted-foreground transition-all hover:-translate-y-px hover:border-primary hover:text-primary disabled:pointer-events-none disabled:opacity-50"
                        onClick={() => send(q)}>{q}</button>
                    ))}
                  </div>
                  <div className="flex items-end gap-2">
                    <Textarea ref={inputRef} rows={1} value={input} placeholder={inputLocked ? 'Assistant is typing…' : 'Type your answer…'}
                      className="max-h-32 min-h-10 resize-none rounded-2xl bg-muted/40 px-3.5 transition-colors focus-visible:bg-background"
                      onChange={(e) => setInput(e.target.value)}
                      onKeyDown={(e) => {
                        // Enter sends, Shift+Enter = new line; never while a Thai / IME composition is open
                        if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                          e.preventDefault();
                          send(input);
                        }
                      }} />
                    <Button size="icon" className="size-10 shrink-0 rounded-full transition-transform active:scale-90" disabled={inputLocked || !input.trim()} onClick={() => send(input)}>
                      <SendHorizontal />
                    </Button>
                  </div>
                </div>
              </>
            ) : (
              <div className="pcw-motion min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-5 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-right-4 motion-safe:duration-300">
                <p className="text-sm text-muted-foreground">This summary goes to the approvers and the System Service team with your request. Correct anything that is wrong — you can also fill in what is still missing.</p>
                {coverage?.criteria.filter((c) => c.status !== 'not_applicable').map((c, i) => (
                  <div key={c.key} className={cn('rounded-xl border p-3 transition-colors focus-within:border-primary', c.required && c.status === 'missing' && 'border-[#fdab3d]/70 bg-[#fff8eb]/60', ENTER)}
                    style={{ animationDelay: `${i * 40}ms`, animationFillMode: 'backwards' }}>
                    <div className="mb-1.5 flex items-center gap-1.5 text-sm font-medium">
                      <CoverageIcon c={c} /> {c.label}
                      {c.required && <span className="text-xs font-normal text-muted-foreground">· required</span>}
                    </div>
                    {c.status === 'missing' && (c.summary || c.note) && <p className="mb-1.5 text-xs text-muted-foreground">{c.summary || c.note}</p>}
                    <Textarea rows={1} value={summaries[c.key] ?? ''} placeholder={c.status === 'missing' ? 'Not covered yet — add a line if you can' : ''}
                      className="min-h-9 resize-none bg-background text-sm"
                      onChange={(e) => setSummaries((s) => ({ ...s, [c.key]: e.target.value }))} />
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Checklist */}
          <aside className="hidden min-h-0 overflow-y-auto border-l bg-muted/30 p-4 sm:block">
            <div className="mb-1 flex items-baseline justify-between">
              <span className="text-sm font-semibold">Checklist</span>
              <span className="text-xs text-muted-foreground">Required {covered}/{total}</span>
            </div>
            <div className="mb-4 h-1.5 overflow-hidden rounded-full bg-muted">
              <div className="pcw-motion h-full rounded-full bg-gradient-to-r from-[#0073ea] to-[#00c875] transition-[width] duration-700 ease-out" style={{ width: `${pct}%` }} />
            </div>
            {!coverage ? (
              <div className="space-y-2">
                {Array.from({ length: 8 }, (_, i) => <div key={i} className="h-4 animate-pulse rounded bg-muted" style={{ width: `${60 + ((i * 37) % 35)}%` }} />)}
              </div>
            ) : (
              (['Required', 'Optional'] as const).map((group) => (
                <div key={group} className="mb-3">
                  <div className="mb-1.5 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">{group}</div>
                  <ul className="space-y-0.5">
                    {coverage.criteria.filter((c) => c.required === (group === 'Required')).map((c) => (
                      <li key={c.key} title={c.summary ?? c.note ?? undefined}
                        className={cn('pcw-motion flex items-center gap-2 rounded-md px-1.5 py-1 text-xs transition-colors duration-700', flash.has(c.key) ? 'bg-[#00c875]/15' : 'bg-transparent')}>
                        <span key={c.status} className="pcw-motion motion-safe:animate-in motion-safe:zoom-in-50 motion-safe:duration-300"><CoverageIcon c={c} /></span>
                        <span className={cn('truncate', c.status !== 'missing' && 'text-muted-foreground', c.status === 'not_applicable' && 'line-through decoration-muted-foreground/40')}>{c.label}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))
            )}
          </aside>
        </div>

        {/* Footer */}
        <div className="flex items-center gap-2 border-t bg-muted/20 px-5 py-3">
          {phase === 'chat' ? (
            <>
              <Button variant="ghost" disabled={busy} onClick={() => { ctrl.current?.abort(); onClose(); }}>Back to Edit</Button>
              <span className="flex-1" />
              <Button variant="ghost" disabled={busy} onClick={submit}>Skip & Submit</Button>
              <Button disabled={busy || (!coverage && thinking)} onClick={openReview}>Review & Submit <ArrowRight /></Button>
            </>
          ) : (
            <>
              <Button variant="outline" disabled={busy} onClick={() => setPhase('chat')}><ArrowLeft /> Back to chat</Button>
              <span className="flex-1" />
              <Button disabled={busy} onClick={confirm}>{busy && <Loader2 className="animate-spin" />} Submit for Approval</Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
