'use client';

import { ArrowUp, Check, ChevronDown, Circle, Loader2, Mic, MicOff, Minus, PhoneOff, RotateCcw, SendHorizontal, Sparkles } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useRef, useState } from 'react';
import { coverageCount, type CriterionCoverage } from '@/lib/clarify';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import type { ClarifyChat } from './useClarifyChat';

export const ENTER = 'pcw-motion motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 motion-safe:duration-300';
/** sent to the AI as the user's answer — texts: ai.clarify.quick.<key> */
const QUICK_REPLIES = ['notSure', 'skip'] as const;

export function CoverageIcon({ c }: { c: Pick<CriterionCoverage, 'status' | 'required'> }) {
  if (c.status === 'covered') return <Check className="size-3.5 shrink-0 text-[#00854d]" strokeWidth={3} />;
  if (c.status === 'not_applicable') return <Minus className="size-3.5 shrink-0 text-muted-foreground" />;
  return <Circle className={cn('size-3.5 shrink-0', c.required ? 'text-[#d83a52]' : 'text-muted-foreground')} />;
}

export function AiAvatar({ glow, className }: { glow?: boolean; className?: string }) {
  return (
    <span
      className={cn('pcw-motion flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground', className)}
      style={glow ? { animation: 'pcw-glow 1.6s ease-in-out infinite' } : undefined}
    >
      <Sparkles className="size-4" />
    </span>
  );
}

function TypingDots() {
  const t = useTranslations('ai.clarify');
  return (
    <span className="flex h-5 items-center gap-1" aria-label={t('aiTyping')}>
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

/** Live microphone level as a ring around the avatar */
function VoiceOrb({ level, speaking, connecting }: { level: number; speaking: boolean; connecting: boolean }) {
  return (
    <span className="relative flex size-10 shrink-0 items-center justify-center">
      <span className="pcw-motion absolute inset-0 rounded-lg bg-primary/20 transition-transform duration-100"
        style={{ transform: `scale(${1 + (speaking ? 0.25 : level * 0.6)})`, animation: speaking ? 'pcw-glow 1.6s ease-in-out infinite' : undefined }} />
      <span className="relative flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
        {connecting ? <Loader2 className="size-4 animate-spin" /> : <Mic className="size-4" />}
      </span>
    </span>
  );
}

/**
 * The conversation: messages (the newest AI reply typed out), the live voice transcript, typing dots,
 * a retry card when the AI failed (`failedAction`: extra button next to Try again) and `doneContent` once it is done.
 */
export function ChatMessages({ chat, failedAction, doneContent, className, roomy }: {
  chat: ClarifyChat; failedAction?: React.ReactNode; doneContent?: React.ReactNode; className?: string;
  /** full-page chat: a centred reading column, AI replies as plain text, the user's in soft bubbles */
  roomy?: boolean;
}) {
  const t = useTranslations('ai.clarify');
  const { messages, typing, setTyping, coverage, liveUser, liveModel, thinking, failed, done, attachScroller } = chat;
  const label = (key: string) => coverage?.criteria.find((c) => c.key === key)?.label ?? key;
  const aiRow = cn('flex gap-2', roomy ? 'items-start gap-3' : 'items-end');
  const aiText = roomy ? 'pt-1 text-[15px] leading-7 break-words whitespace-pre-wrap' : 'rounded-lg rounded-bl-sm bg-muted px-3.5 py-2.5 text-sm leading-relaxed break-words whitespace-pre-wrap';
  const userText = roomy
    ? 'max-w-[80%] rounded-2xl bg-muted px-4 py-2.5 text-[15px] leading-7 break-words whitespace-pre-wrap'
    : 'max-w-[80%] rounded-lg rounded-br-sm bg-primary px-3.5 py-2.5 text-sm leading-relaxed break-words whitespace-pre-wrap text-primary-foreground';
  return (
    <div ref={attachScroller} className={cn('min-h-0 flex-1 overflow-y-auto', roomy ? 'px-4 py-6 md:px-8' : 'px-5 py-5', className)}>
      <div className={cn(roomy ? 'mx-auto max-w-3xl space-y-6' : 'space-y-4')}>
        {messages.map((m, i) => m.role === 'assistant' ? (
          <div key={i} className={cn(aiRow, ENTER)}>
            <AiAvatar />
            <div className={roomy ? 'min-w-0 flex-1' : 'max-w-[85%]'}>
              <div className={aiText}>
                {typing === i
                  ? <Typewriter text={m.content} onTick={() => chat.scrollDown('auto')} onDone={() => { setTyping(null); chat.focusInput(); }} />
                  : m.content}
              </div>
              {!!m.criteria?.length && typing !== i && (
                <div className={cn('mt-1 flex flex-wrap gap-1', ENTER)}>
                  {m.criteria.map((k) => <span key={k} className={cn('bg-selected px-1.5 py-0.5 text-[11px] text-foreground', roomy ? 'rounded-full px-2' : 'rounded-sm')}>{label(k)}</span>)}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div key={i} className={cn('flex justify-end', ENTER)}>
            <div className={userText}>
              {m.content}
            </div>
          </div>
        ))}

        {liveUser && (
          <div className="flex justify-end">
            <div className={cn(userText, 'opacity-70')}>{liveUser}</div>
          </div>
        )}
        {liveModel && (
          <div className={aiRow}>
            <AiAvatar glow />
            <div className={cn(aiText, !roomy && 'max-w-[85%]')}>{liveModel}</div>
          </div>
        )}

        {thinking && (
          <div className={cn(aiRow, ENTER)}>
            <AiAvatar />
            <div className={roomy ? 'pt-2' : 'rounded-lg rounded-bl-sm bg-muted px-4 py-2.5'}><TypingDots /></div>
          </div>
        )}

        {failed && (
          <div className={cn(aiRow, ENTER)}>
            <AiAvatar />
            <div className="rounded-lg rounded-bl-sm border border-[#fdab3d] bg-[#fff6e5] px-3.5 py-2.5 text-sm">
              {t('noAnswer')}
              <div className="mt-2 flex gap-2">
                <Button size="sm" variant="outline" className="h-7" onClick={() => chat.retry()}><RotateCcw /> {t('tryAgain')}</Button>
                {failedAction}
              </div>
            </div>
          </div>
        )}

        {done && typing === null && doneContent && (
          <div className={cn('mx-auto flex max-w-sm flex-col items-center gap-2 rounded-lg border border-[#00c875] bg-[#e3f8ee] px-4 py-3 text-center', ENTER)}>
            <span className="pcw-motion flex size-8 items-center justify-center rounded-full bg-[#00c875] text-white motion-safe:animate-in motion-safe:zoom-in-50 motion-safe:duration-500">
              <Check className="size-4" strokeWidth={3} />
            </span>
            {doneContent}
          </div>
        )}
      </div>
    </div>
  );
}

/** Answer box with quick replies and the microphone — or the voice call bar while talking */
export function ChatComposer({ chat, locked, roomy }: { chat: ClarifyChat; locked?: boolean; /** full-page chat: one rounded box, buttons inside */ roomy?: boolean }) {
  const t = useTranslations('ai.clarify');
  const { voice, speaking, muted, level, input, setInput, thinking, typing, messages, voiceOk, attachInput } = chat;
  const inputLocked = thinking || typing !== null || !!locked;

  if (voice !== 'off') {
    return (
      <div className={cn('flex items-center gap-3 bg-background px-4 py-3', roomy ? 'mx-4 mb-4 rounded-2xl border shadow-sm md:mx-8' : 'border-t')}>
        <VoiceOrb level={level} speaking={speaking} connecting={voice === 'connecting'} />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">
            {voice === 'connecting' ? t('voice.connecting') : speaking ? t('voice.speaking') : muted ? t('voice.muted') : t('voice.listening')}
          </div>
          <div className="text-xs text-muted-foreground">{t('voice.hint')}</div>
        </div>
        <Button variant="outline" size="icon" disabled={voice !== 'live'} title={muted ? t('voice.micOn') : t('voice.micOff')} onClick={() => chat.toggleMute()}>
          {muted ? <MicOff /> : <Mic />}
        </Button>
        <Button variant="destructive" onClick={() => chat.stopVoice()} disabled={voice !== 'live'}><PhoneOff /> {t('voice.end')}</Button>
      </div>
    );
  }

  const send = () => chat.send(input);
  const keys = (e: React.KeyboardEvent) => {
    // Enter sends, Shift+Enter = new line; never while a Thai / IME composition is open
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  };
  const quick = QUICK_REPLIES.map((q) => (
    <button key={q} type="button" disabled={inputLocked || !messages.length}
      className={cn('border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:border-primary hover:bg-selected/40 hover:text-primary disabled:pointer-events-none disabled:opacity-50', roomy ? 'rounded-full' : 'rounded-md')}
      onClick={() => chat.send(t(`quick.${q}`))}>{t(`quick.${q}`)}</button>
  ));

  if (roomy) {
    return (
      <div className="px-4 pb-4 md:px-8">
        <div className="mx-auto max-w-3xl rounded-2xl border bg-background shadow-sm transition-shadow focus-within:border-primary/40 focus-within:shadow-md">
          <Textarea ref={attachInput} rows={2} value={input} placeholder={inputLocked ? t('assistantTyping') : t('typeAnswer')}
            className="max-h-48 min-h-14 resize-none border-0 bg-transparent px-4 pt-3 text-[15px] shadow-none focus-visible:ring-0 dark:bg-transparent"
            onChange={(e) => setInput(e.target.value)} onKeyDown={keys} />
          <div className="flex items-center gap-1.5 px-3 pb-3">
            <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">{quick}</div>
            {voiceOk && (
              <Button size="icon-sm" variant="ghost" className="shrink-0 rounded-lg text-muted-foreground" title={t('voice.start')} disabled={inputLocked} onClick={() => chat.startVoice()}>
                <Mic />
              </Button>
            )}
            <Button size="icon-sm" className="shrink-0 rounded-lg transition-transform active:scale-90" disabled={inputLocked || !input.trim()} onClick={send}>
              <ArrowUp />
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="border-t bg-background px-4 py-3">
      <div className="mb-2 flex flex-wrap gap-1.5">
        {quick}
      </div>
      <div className="flex items-end gap-2">
        <Textarea ref={attachInput} rows={1} value={input} placeholder={inputLocked ? t('assistantTyping') : t('typeAnswer')}
          className="max-h-32 min-h-10 resize-none px-3"
          onChange={(e) => setInput(e.target.value)} onKeyDown={keys} />
        {voiceOk && (
          <Button size="icon" variant="outline" className="size-10 shrink-0" title={t('voice.start')} disabled={inputLocked} onClick={() => chat.startVoice()}>
            <Mic />
          </Button>
        )}
        <Button size="icon" className="size-10 shrink-0 transition-transform active:scale-90" disabled={inputLocked || !input.trim()} onClick={send}>
          <SendHorizontal />
        </Button>
      </div>
    </div>
  );
}

/** Criteria checklist: required / optional with their status, the last answer's changes flashing green */
export function CoverageChecklist({ chat, className }: { chat: ClarifyChat; className?: string }) {
  const t = useTranslations('ai.clarify');
  const { coverage, flash } = chat;
  const { covered, total } = coverageCount(coverage);
  const pct = total ? Math.round((covered / total) * 100) : 0;
  return (
    <aside className={cn('min-h-0 overflow-y-auto bg-muted/50 p-4', className)}>
      <div className="mb-1 flex items-baseline justify-between">
        <span className="font-heading text-sm font-medium">{t('checklist')}</span>
        <span className="text-xs text-muted-foreground">{t('requiredCount', { covered, total })}</span>
      </div>
      <div className="mb-4 h-1.5 overflow-hidden rounded-full bg-grid">
        <div className="pcw-motion h-full rounded-full bg-[#00c875] transition-[width] duration-700 ease-out" style={{ width: `${pct}%` }} />
      </div>
      {!coverage ? (
        <div className="space-y-2">
          {Array.from({ length: 8 }, (_, i) => <div key={i} className="h-4 animate-pulse rounded bg-grid" style={{ width: `${60 + ((i * 37) % 35)}%` }} />)}
        </div>
      ) : (
        (['required', 'optional'] as const).map((group) => (
          <div key={group} className="mb-3">
            <div className="mb-1.5 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">{t(`group.${group}`)}</div>
            <ul className="space-y-0.5">
              {coverage.criteria.filter((c) => c.required === (group === 'required')).map((c) => (
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
  );
}

/** Compact criteria card for the intake page (beside the form): progress, what is still needed, the rest folded away */
export function CoverageSummary({ chat, className }: { chat: ClarifyChat; className?: string }) {
  const t = useTranslations('ai.clarify');
  const { coverage, flash } = chat;
  const [open, setOpen] = useState(false);
  if (!coverage?.criteria.length) return null;
  const { covered, total } = coverageCount(coverage);
  const pct = total ? Math.round((covered / total) * 100) : 0;
  const shown = coverage.criteria.filter((c) => c.status !== 'not_applicable');
  const required = shown.filter((c) => c.required);
  const optional = shown.filter((c) => !c.required);
  const chip = (c: CriterionCoverage) => (
    <span key={c.key} title={c.summary ?? c.note ?? undefined}
      className={cn('pcw-motion inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] transition-colors duration-700',
        flash.has(c.key) ? 'bg-[#00c875]/20' : 'bg-muted', c.status !== 'missing' && 'text-muted-foreground')}>
      <span key={c.status} className="pcw-motion motion-safe:animate-in motion-safe:zoom-in-50 motion-safe:duration-300"><CoverageIcon c={c} /></span>{c.label}
    </span>
  );
  return (
    <div className={cn('rounded-xl border bg-card px-4 py-3', className)}>
      <div className="flex items-center gap-3">
        <span className="font-heading text-sm font-semibold">{t('checklist')}</span>
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-grid">
          <div className="pcw-motion h-full rounded-full bg-[#00c875] transition-[width] duration-700 ease-out" style={{ width: `${pct}%` }} />
        </div>
        <span className="text-xs text-muted-foreground tabular-nums">{t('requiredCount', { covered, total })}</span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1">
        {required.map(chip)}
        {open && optional.map(chip)}
        {!!optional.length && (
          <button type="button" onClick={() => setOpen((o) => !o)}
            className="inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground">
            {open ? t('lessOptional') : t('moreOptional', { count: optional.length })}
            <ChevronDown className={cn('size-3 transition-transform', open && 'rotate-180')} />
          </button>
        )}
      </div>
    </div>
  );
}
