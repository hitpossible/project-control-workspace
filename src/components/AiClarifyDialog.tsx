'use client';

import { ArrowLeft, ArrowRight, Loader2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { coverageCount, type AiCoverage, type CriterionCoverage } from '@/lib/clarify';
import { errMsg } from '@/lib/format';
import { dbClient } from '@/lib/db/client';
import type { ProjectRequest } from '@/lib/types';
import { cn } from '@/lib/utils';
import { useApp } from './AppProvider';
import { AiAvatar, ChatComposer, ChatMessages, CoverageChecklist, CoverageIcon, ENTER } from './clarify/ChatParts';
import { requestClarifyApi, useClarifyChat } from './clarify/useClarifyChat';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog';
import { Textarea } from './ui/textarea';

export { CoverageIcon };

/** Review starts with what is known; a missing criterion starts empty — what the requestor types there makes it covered */
const summariesOf = (c: AiCoverage) => Object.fromEntries(c.criteria.map((x) => [x.key, x.status === 'missing' ? '' : x.summary ?? '']));

/** every required criterion already covered (e.g. by the intake chat on the new request page) */
const complete = (c: AiCoverage | null) => !!c?.criteria.length && coverageCount(c).missing.length === 0;

/**
 * Just before submit the requestor chats with the AI, which asks about the document type's criteria that the form does
 * not cover yet — following up on vague answers — until the important ones are covered. The requestor then reviews the
 * AI's summary per criterion (editable) and submits. The transcript and checklist are saved on the request after every
 * AI message. AI off, or failing on the first message → submits straight away; the requestor can always skip.
 * A draft whose criteria are already covered (written with the AI) opens on the review.
 */
export default function AiClarifyDialog({ request, onSubmit, onClose }: {
  request: ProjectRequest;
  onSubmit: (r: ProjectRequest) => Promise<void>;
  onClose: () => void;
}) {
  const t = useTranslations('ai.clarify');
  const locale = useLocale();
  const db = dbClient();
  const { notify } = useApp();
  const moreInfo = request.status === 'need_more_information';
  const [phase, setPhase] = useState<'chat' | 'review'>(() => (!moreInfo && complete(request.ai_coverage) ? 'review' : 'chat'));
  const [summaries, setSummaries] = useState<Record<string, string>>(() => (request.ai_coverage ? summariesOf(request.ai_coverage) : {}));
  const [busy, setBusy] = useState(false);

  const api = useMemo(() => requestClarifyApi(request.id, locale, async (messages) => {
    const { error } = await db.from('project_requests').update({ ai_chat: messages }).eq('id', request.id);
    if (error) throw new Error(errMsg(error));
  }), [request.id, locale, db]);

  const last = request.ai_chat?.at(-1);
  const chat = useClarifyChat({
    api,
    initialMessages: request.ai_chat ?? [],
    initialCoverage: request.ai_coverage,
    // a conversation left at an AI question (Back to Edit, then Submit again) just continues where it was
    start: phase === 'chat' && (!last || last.role === 'user' || moreInfo),
    onOff: () => void submit(),
  });
  const { coverage } = chat;

  const submit = async () => {
    chat.halt();
    setBusy(true);
    try {
      await chat.endVoice();
      await onSubmit(request);
    } finally {
      setBusy(false);
      onClose();
    }
  };

  const openReview = () => {
    if (!coverage) return submit();
    chat.halt();
    setSummaries(summariesOf(coverage));
    setPhase('review');
  };

  /** Save the summaries as confirmed by the requestor, then submit */
  const confirm = async () => {
    if (!coverage) return submit();
    const criteria = coverage.criteria.map((c): CriterionCoverage => {
      const summary = summaries[c.key]?.trim() || null;
      if (c.status !== 'missing') return { ...c, summary };
      // still missing: keep whatever partial information the AI noted, unless the requestor filled it in
      return summary ? { ...c, summary, status: 'covered', note: t('addedByRequestor') } : c;
    });
    setBusy(true);
    const res = await db.from('project_requests').update({ ai_coverage: { ...coverage, criteria } }).eq('id', request.id).select().single();
    setBusy(false);
    if (res.error) return notify(errMsg(res.error), 'error');
    await submit();
  };

  const { covered, total } = coverageCount(coverage);

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="flex h-[min(720px,92vh)] flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl">
        {/* Header */}
        <div className="relative flex items-center gap-3 border-b bg-background px-5 py-4 pr-12">
          <AiAvatar glow={chat.thinking} className="size-9 rounded-lg" />
          <div className="min-w-0 flex-1">
            <DialogTitle className="font-heading text-lg">{t('title')}</DialogTitle>
            <DialogDescription className="mt-1 text-xs">
              {phase === 'chat' ? t('subtitleChat') : t('subtitleReview')}
            </DialogDescription>
          </div>
          {coverage && (
            <span className="rounded-md bg-muted px-2 py-1 text-xs font-medium sm:hidden">{covered}/{total}</span>
          )}
        </div>

        <div className="grid min-h-0 flex-1 sm:grid-cols-[minmax(0,1fr)_15rem]">
          {/* Chat / review */}
          <div className="flex min-h-0 flex-col">
            {phase === 'chat' ? (
              <>
                <ChatMessages chat={chat}
                  failedAction={<Button size="sm" variant="ghost" className="h-7" onClick={openReview}>{t('reviewSubmit')}</Button>}
                  doneContent={<>
                    <div className="text-sm font-medium">{t('allCovered')}</div>
                    <Button size="sm" onClick={openReview}>{t('reviewSummary')} <ArrowRight /></Button>
                  </>} />
                <ChatComposer chat={chat} locked={busy} />
              </>
            ) : (
              <div className="pcw-motion min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-5 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-right-4 motion-safe:duration-300">
                <p className="text-sm text-muted-foreground">{t('reviewNote')}</p>
                {coverage?.criteria.filter((c) => c.status !== 'not_applicable').map((c, i) => (
                  <div key={c.key} className={cn('rounded-lg border p-3 transition-colors focus-within:border-primary', c.required && c.status === 'missing' && 'border-[#fdab3d] bg-[#fff6e5]', ENTER)}
                    style={{ animationDelay: `${i * 40}ms`, animationFillMode: 'backwards' }}>
                    <div className="mb-1.5 flex items-center gap-1.5 text-sm font-medium">
                      <CoverageIcon c={c} /> {c.label}
                      {c.required && <span className="text-xs font-normal text-muted-foreground">· {t('requiredLower')}</span>}
                    </div>
                    {c.status === 'missing' && (c.summary || c.note) && <p className="mb-1.5 text-xs text-muted-foreground">{c.summary || c.note}</p>}
                    <Textarea rows={1} value={summaries[c.key] ?? ''} placeholder={c.status === 'missing' ? t('notCoveredPlaceholder') : ''}
                      className="min-h-9 resize-none bg-background text-sm"
                      onChange={(e) => setSummaries((s) => ({ ...s, [c.key]: e.target.value }))} />
                  </div>
                ))}
              </div>
            )}
          </div>

          <CoverageChecklist chat={chat} className="hidden border-l sm:block" />
        </div>

        {/* Footer */}
        <div className="flex items-center gap-2 border-t bg-muted/50 px-5 py-3">
          {phase === 'chat' ? (
            <>
              <Button variant="ghost" disabled={busy} onClick={async () => { chat.halt(); await chat.endVoice(); onClose(); }}>{t('backToEdit')}</Button>
              <span className="flex-1" />
              <Button variant="outline" disabled={busy} onClick={submit}>{t('skipSubmit')}</Button>
              <Button disabled={busy || (!coverage && chat.thinking)} onClick={openReview}>{t('reviewSubmit')} <ArrowRight /></Button>
            </>
          ) : (
            <>
              <Button variant="outline" disabled={busy} onClick={() => setPhase('chat')}><ArrowLeft /> {t('backToChat')}</Button>
              <span className="flex-1" />
              <Button disabled={busy} onClick={confirm}>{busy && <Loader2 className="animate-spin" />} {t('submit')}</Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
