'use client';

import { useTranslations } from 'next-intl';
import { Section } from '@/components/shared/layout';
import { SelectField, TextField, UserSelect } from '@/components/shared/form';
import { Button } from '@/components/ui/button';
import type { ProjectRequest, ProjectTemplate, ProjectType } from '@/lib/types';

export type ReviewDraft = {
  project_type_id: string; template_id: string; proposed_leader_id: number | null; authority_approver_id: number | null; scope_assessment: string; estimated_md: string;
};

export const reviewDraft = (r: ProjectRequest): ReviewDraft => ({
  project_type_id: r.project_type_id?.toString() ?? '', template_id: r.template_id?.toString() ?? '',
  proposed_leader_id: r.proposed_leader_id, authority_approver_id: r.authority_approver_id, scope_assessment: r.scope_assessment ?? '',
  estimated_md: r.estimated_md?.toString() ?? '',
});

/** The receiving step fills in Project Type / Template / Leader before approving */
export function ReviewCard({ r, stepName, review, onChange, types, templates, legacy, onSave }: {
  r: ProjectRequest; stepName: string; review: ReviewDraft; onChange: (v: ReviewDraft) => void;
  types: ProjectType[]; templates: ProjectTemplate[];
  /** old system_review step, which also picks the authority approver */
  legacy: boolean; onSave: () => void;
}) {
  const t = useTranslations('requestDetail');
  return (
    <Section title={t('review.title', { step: stepName })} className="ring-2 ring-[#fdab3d]">
      <div className="space-y-3">
        <SelectField label={t('review.projectType')} required value={review.project_type_id} onChange={(v) => {
          const tpl = templates.find((x) => x.project_type_id === Number(v));
          onChange({ ...review, project_type_id: v, template_id: review.template_id || tpl?.id.toString() || '' });
        }} options={types.map((x) => ({ value: x.id.toString(), label: x.name }))} />
        <SelectField label={t('review.projectTemplate')} allowEmpty value={review.template_id} onChange={(v) => onChange({ ...review, template_id: v })} options={templates.map((x) => ({ value: x.id.toString(), label: x.name }))} />
        <UserSelect label={t('review.projectLeader')} required roles={['project_leader']} value={review.proposed_leader_id} onChange={(v) => onChange({ ...review, proposed_leader_id: v })} />
        {legacy && <UserSelect label={t('review.authorityApprover')} required roles={['authority_approver']} value={review.authority_approver_id} onChange={(v) => onChange({ ...review, authority_approver_id: v })} />}
        <TextField label={t('review.estimatedEffortMd')} type="number" value={review.estimated_md} onChange={(v) => onChange({ ...review, estimated_md: v })}
          placeholder={r.ai_analysis?.status === 'done' ? t('review.aiRange', { min: r.ai_analysis.effort_min ?? '', max: r.ai_analysis.effort_max ?? '' }) : t('review.manDays')}
          helperText={t('review.estimateHelp')} />
        <TextField label={t('review.scope')} multiline value={review.scope_assessment} onChange={(v) => onChange({ ...review, scope_assessment: v })} />
        <Button variant="outline" className="w-full" onClick={onSave}>{t('review.save')}</Button>
      </div>
    </Section>
  );
}
