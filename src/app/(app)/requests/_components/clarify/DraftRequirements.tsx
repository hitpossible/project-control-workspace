'use client';

import { ListChecks } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { StatusChip } from '@/components/shared/labels';
import { REQ_PRIORITIES } from '@/lib/constants';
import type { AiRequirement } from '@/lib/clarify';

/** The functions the AI has understood so far, grouped by module — they become draft requirements of the project */
export function DraftRequirements({ items, className }: { items: AiRequirement[] | null | undefined; className?: string }) {
  const t = useTranslations('requests.draftReq');
  if (!items?.length) return null;
  const groups = new Map<string, AiRequirement[]>();
  for (const q of items) groups.set(q.category ?? '', [...(groups.get(q.category ?? '') ?? []), q]);
  return (
    <section className={className}>
      <div className="mb-2 flex items-center gap-1.5 text-sm font-semibold"><ListChecks className="size-4 text-primary" /> {t('title', { count: items.length })}</div>
      <p className="mb-3 text-xs text-muted-foreground">{t('note')}</p>
      <div className="space-y-3">
        {[...groups.entries()].map(([cat, rows]) => (
          <div key={cat} className="rounded-lg border">
            <div className="border-b bg-muted/50 px-3 py-1.5 text-xs font-semibold text-muted-foreground">{cat || t('other')}</div>
            <ul className="divide-y">
              {rows.map((q) => (
                <li key={q.title} className="flex gap-3 px-3 py-2 text-sm">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{q.title}</div>
                    {q.description && <div className="mt-0.5 text-xs break-words text-muted-foreground">{q.description}</div>}
                    {q.acceptance_criteria && <div className="mt-1 text-xs break-words whitespace-pre-wrap text-muted-foreground"><b>{t('accept')}:</b> {q.acceptance_criteria}</div>}
                  </div>
                  <StatusChip list={REQ_PRIORITIES} value={q.priority} className="h-6 min-w-24 shrink-0 self-start text-xs" />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
