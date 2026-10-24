'use client';

import { ArrowLeft, ChevronRight, FileText, PencilLine, Sparkles } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { dispatchEmails, useApp } from '@/components/AppProvider';
import AiIntake from '@/components/clarify/AiIntake';
import { EmptyState, PageHeader } from '@/components/common';
import { celebrate } from '@/components/motion';
import RequestForm, { emptyRequest, type RequestDraft } from '@/components/RequestForm';
import { Button } from '@/components/ui/button';
import { useDocumentTypes } from '@/components/useDocumentTypes';
import { dbClient } from '@/lib/db/client';
import { errMsg } from '@/lib/format';
import type { ProjectRequest } from '@/lib/types';
import { cn } from '@/lib/utils';

type Mode = 'ai' | 'form';

export default function NewRequestPage() {
  const t = useTranslations('requests.newPage');
  const td = useTranslations('requestDetail');
  const { me, notify, refreshUnread } = useApp();
  const router = useRouter();
  const types = useDocumentTypes().filter((d) => d.is_active);
  const [picked, setPicked] = useState<number | null>(null);
  const [mode, setMode] = useState<Mode | null>(null);
  // the form so far when switching from the AI to the plain form
  const [carry, setCarry] = useState<RequestDraft | null>(null);
  const [aiOk, setAiOk] = useState<boolean | null>(null);

  useEffect(() => {
    fetch('/api/requests/intake').then((r) => r.json()).then((j) => setAiOk(!!j.data?.enabled)).catch(() => setAiOk(false));
  }, []);

  if (!me) return null;

  // Only one kind of document → go straight to its form
  const type = types.find((d) => d.id === picked) ?? (types.length === 1 ? types[0] : null);

  if (!type) {
    return (
      <div className="max-w-5xl">
        <PageHeader title={t('title')} subtitle={t('subtitle')} />
        {types.length === 0 && <EmptyState text={t('noTypes')} />}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {types.map((d) => (
            <button key={d.id} type="button" onClick={() => setPicked(d.id)}
              className="flex items-center gap-3 rounded-lg border bg-card p-4 text-left transition-colors hover:border-primary hover:bg-primary/5">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><FileText className="size-5" /></span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">{d.name}</span>
                <span className="block text-xs text-muted-foreground">{[d.form_no, d.code].filter(Boolean).join(' · ')}</span>
              </span>
              <ChevronRight className="size-4 text-muted-foreground" />
            </button>
          ))}
        </div>
      </div>
    );
  }

  // no AI on this server → the plain form, as before
  const shown: Mode | null = aiOk === false ? 'form' : mode;

  /** submit straight from the new page (the pre-submit AI dialog runs first, inside RequestForm) */
  const submit = async (r: ProjectRequest) => {
    const { error } = await dbClient().rpc('submit_request', { p_request_id: r.id });
    if (error) notify(errMsg(error), 'error');
    else {
      notify(td('toast.submitted'));
      dispatchEmails();
      refreshUnread();
      celebrate(td('celebrate.submitted'), td('celebrate.submittedHint'));
    }
    router.replace(`/requests/${r.id}`);
  };
  const saved = (r: ProjectRequest) => router.replace(`/requests/${r.id}`);

  const header = (
    <PageHeader
      title={t('titleFor', { name: type.name })}
      subtitle={[type.form_no, type.name].filter(Boolean).join(' ')}
      actions={<>
        {shown && aiOk && <Button variant="outline" onClick={() => { setMode(null); setCarry(null); }}><ArrowLeft /> {t('changeMode')}</Button>}
        {!shown && types.length > 1 && <Button variant="outline" onClick={() => setPicked(null)}><ArrowLeft /> {t('changeType')}</Button>}
      </>}
    />
  );

  if (!shown) {
    const choice = (m: Mode, icon: React.ReactNode, recommended?: boolean) => (
      <button type="button" disabled={aiOk === null && m === 'ai'} onClick={() => setMode(m)}
        className={cn('relative flex flex-col items-start gap-2 rounded-xl border bg-card p-5 text-left transition-colors hover:border-primary hover:bg-primary/5 disabled:opacity-60',
          recommended && 'border-primary/40')}>
        {recommended && <span className="absolute top-3 right-3 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">{t('mode.recommended')}</span>}
        <span className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">{icon}</span>
        <span className="font-heading text-lg font-semibold">{t(`mode.${m}.title`)}</span>
        <span className="text-sm text-muted-foreground">{t(`mode.${m}.desc`)}</span>
      </button>
    );
    return (
      <div className="max-w-3xl">
        {header}
        <div className="grid gap-4 sm:grid-cols-2">
          {choice('ai', <Sparkles className="size-5" />, true)}
          {choice('form', <PencilLine className="size-5" />)}
        </div>
      </div>
    );
  }

  return (
    <div className={shown === 'ai' ? 'max-w-7xl' : 'max-w-5xl'}>
      {header}
      {shown === 'ai' ? (
        <AiIntake key={type.id} initial={emptyRequest(type.id)} onSaved={saved} onSubmit={submit}
          onOff={() => { notify(t('aiOff'), 'warning'); setMode('form'); }}
          onUseForm={(f) => { setCarry(f); setMode('form'); }} />
      ) : (
        <RequestForm key={type.id} initial={carry ?? emptyRequest(type.id)} onSaved={saved} onSubmit={submit} />
      )}
    </div>
  );
}
