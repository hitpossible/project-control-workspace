'use client';

import { Mail, Phone } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Section } from '@/components/shared/layout';
import type { ProjectRequest } from '@/lib/types';

export function RequestorCard({ r }: { r: ProjectRequest }) {
  const t = useTranslations('requestDetail');
  return (
    <Section title={t('section.requestor')}>
      <div className="mb-3 flex items-center gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[#e6f1fd] text-sm font-semibold text-[#0073ea]">
          {(r.req_full_name ?? '?').split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase()}
        </span>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{r.req_full_name}</div>
          <div className="truncate text-xs text-muted-foreground">{[r.req_employee_id, r.req_department, r.req_section].filter(Boolean).join(' · ')}</div>
        </div>
      </div>
      <div className="space-y-1.5 text-sm">
        {r.req_email && <a href={`mailto:${r.req_email}`} className="flex items-center gap-2 truncate text-primary hover:underline"><Mail className="size-3.5 shrink-0 text-muted-foreground" />{r.req_email}</a>}
        {(r.req_telephone || r.req_extension) && <div className="flex items-center gap-2"><Phone className="size-3.5 shrink-0 text-muted-foreground" />{[r.req_telephone, r.req_extension && t('ext', { ext: r.req_extension })].filter(Boolean).join(' · ')}</div>}
      </div>
    </Section>
  );
}
