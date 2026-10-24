'use client';

import { ArrowLeft, ChevronRight, FileText } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useApp } from '@/components/AppProvider';
import { EmptyState, PageHeader } from '@/components/common';
import RequestForm, { emptyRequest } from '@/components/RequestForm';
import { Button } from '@/components/ui/button';
import { useDocumentTypes } from '@/components/useDocumentTypes';

export default function NewRequestPage() {
  const t = useTranslations('requests.newPage');
  const { me } = useApp();
  const router = useRouter();
  const types = useDocumentTypes().filter((d) => d.is_active);
  const [picked, setPicked] = useState<number | null>(null);
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

  return (
    <div className="max-w-5xl">
      <PageHeader
        title={t('titleFor', { name: type.name })}
        subtitle={[type.form_no, type.name].filter(Boolean).join(' ')}
        actions={types.length > 1 && <Button variant="outline" onClick={() => setPicked(null)}><ArrowLeft /> {t('changeType')}</Button>}
      />
      <RequestForm key={type.id} initial={emptyRequest(type.id)} onSaved={(r) => router.replace(`/requests/${r.id}`)} />
    </div>
  );
}
