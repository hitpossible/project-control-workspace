'use client';

import { PencilLine } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import type { ProjectRequest } from '@/lib/types';
import RequestForm, { type AiPatch, type RequestDraft } from '../RequestForm';
import { Button } from '../ui/button';
import { AiAvatar, ChatComposer, ChatMessages, CoverageChips } from './ChatParts';
import { intakeApi, useClarifyChat } from './useClarifyChat';

/**
 * A new request written by talking to the AI: the chat on the left asks what the requestor needs and the
 * document type's criteria, and fills in the form on the right as it goes. The requestor checks and edits the form,
 * picks the priority and required date, then saves or submits as usual — the transcript and criteria check are saved
 * with the draft, so the pre-submit dialog only asks about what is still missing.
 */
export default function AiIntake({ initial, onSaved, onSubmit, onOff, onUseForm }: {
  initial: RequestDraft;
  onSaved: (r: ProjectRequest) => void;
  onSubmit: (r: ProjectRequest) => Promise<void>;
  /** AI not available — continue with the plain form */
  onOff: () => void;
  /** the requestor prefers to fill in the form themselves (keeps what is there so far) */
  onUseForm: (f: RequestDraft) => void;
}) {
  const t = useTranslations('requests.intake');
  const locale = useLocale();
  // the form as edited so far — sent with every turn, so the AI sees the requestor's own edits
  const [form, setForm] = useState<RequestDraft>(initial);
  const [patch, setPatch] = useState<AiPatch>({ values: {}, seq: 0 });

  const api = useMemo(() => intakeApi(initial.document_type_id!, () => form as Record<string, unknown>, locale), [initial.document_type_id, form, locale]);
  const chat = useClarifyChat({
    api,
    initialMessages: [],
    initialCoverage: null,
    start: true,
    onOff,
    onResult: (d) => {
      if (d.form && Object.keys(d.form).length) setPatch((p) => ({ values: d.form as RequestDraft, seq: p.seq + 1 }));
    },
  });

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-start">
      <div className="flex h-[min(720px,calc(100vh-12rem))] flex-col overflow-hidden rounded-xl border bg-card lg:sticky lg:top-20">
        <div className="flex items-center gap-3 border-b px-4 py-3">
          <AiAvatar glow={chat.thinking} className="size-9 rounded-lg" />
          <div className="min-w-0 flex-1">
            <div className="font-heading font-semibold">{t('title')}</div>
            <div className="text-xs text-muted-foreground">{t('subtitle')}</div>
          </div>
          <Button variant="ghost" size="sm" onClick={() => { chat.halt(); onUseForm(form); }}><PencilLine /> {t('useForm')}</Button>
        </div>
        <CoverageChips chat={chat} />
        <ChatMessages chat={chat} doneContent={<div className="text-sm font-medium">{t('done')}</div>} />
        <ChatComposer chat={chat} />
      </div>

      <RequestForm
        initial={initial}
        aiPatch={patch}
        onChange={setForm}
        extra={() => ({ ai_chat: chat.getMessages(), ai_coverage: chat.coverage })}
        onBeforeSave={() => chat.halt()}
        onSaved={onSaved}
        onSubmit={onSubmit}
      />
    </div>
  );
}
