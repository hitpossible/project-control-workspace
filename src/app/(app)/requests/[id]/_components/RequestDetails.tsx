'use client';

import { ArrowRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useApp } from '@/providers/AppProvider';
import { Field, Section } from '@/components/shared/common';
import { REDUCTION_ROWS } from '../../_components/RequestForm';
import { fmtNum } from '@/lib/format';
import type { ProjectRequest, ProjectTemplate, ProjectType } from '@/lib/types';
import { InfoBlock } from './parts';

/** Read-only view of a request that the current user can no longer edit */
export function RequestDetails({ r, types, templates }: { r: ProjectRequest; types: ProjectType[]; templates: ProjectTemplate[] }) {
  const t = useTranslations('requestDetail');
  const tf = useTranslations('requestForm.field');
  const te = useTranslations('enums');
  const { profileName } = useApp();
  return (
    <>
      <Section title={t('section.info')}>
        <p className="mb-4 text-[15px] leading-relaxed break-words whitespace-pre-wrap">{r.description || <span className="text-muted-foreground">{t('noDescription')}</span>}</p>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <InfoBlock label={tf('reason')}>{r.reason}</InfoBlock>
          <InfoBlock label={tf('expectation')}>{r.expectation}</InfoBlock>
        </div>
        {r.requestor_approver_id && (
          <div className="mt-3 text-xs text-muted-foreground">{t('requestorApprover')} · <span className="font-medium text-foreground">{profileName(r.requestor_approver_id)}</span></div>
        )}
      </Section>
      {REDUCTION_ROWS.some((row) => r[row.from] != null || r[row.to] != null) && (
        <Section title={t('section.reduction')}>
          <div className="overflow-hidden rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted/60 text-xs text-muted-foreground">
                <tr><th className="px-3 py-2 text-left font-medium">{t('reduction.item')}</th><th className="px-3 py-2 text-right font-medium">{t('reduction.current')}</th><th className="w-8" /><th className="px-3 py-2 text-right font-medium">{t('reduction.target')}</th></tr>
              </thead>
              <tbody className="divide-y">
                {REDUCTION_ROWS.filter((row) => r[row.from] != null || r[row.to] != null).map((row) => (
                  <tr key={row.key}>
                    <td className="px-3 py-2">{te(`reduction.${row.key}`)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtNum(r[row.from])}</td>
                    <td className="text-center text-muted-foreground"><ArrowRight className="mx-auto size-3.5" /></td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums">{fmtNum(r[row.to])}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}
      {(r.project_type_id || r.scope_assessment || r.estimated_md != null) && (
        <Section title={t('section.received')}>
          <div className="grid grid-cols-2 gap-x-4 md:grid-cols-4">
            <Field label={t('review.projectType')}>{types.find((x) => x.id === r.project_type_id)?.name}</Field>
            <Field label={t('review.template')}>{templates.find((x) => x.id === r.template_id)?.name}</Field>
            <Field label={t('review.projectLeader')}>{profileName(r.proposed_leader_id)}</Field>
            {r.authority_approver_id && <Field label={t('review.authorityApprover')}>{profileName(r.authority_approver_id)}</Field>}
            {r.estimated_md != null && <Field label={t('review.estimatedEffort')}>{t('review.md', { md: fmtNum(r.estimated_md) })}</Field>}
          </div>
          {r.scope_assessment && <InfoBlock label={t('review.scope')}>{r.scope_assessment}</InfoBlock>}
        </Section>
      )}
    </>
  );
}
