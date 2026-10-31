'use client';

import { useTranslations } from 'next-intl';
import { useOptions } from '@/i18n/useOptions';
import { ROLES } from '@/lib/constants';
import { fmtDateTime } from '@/lib/format';
import { useApp } from '@/providers/AppProvider';
import { Field, PageHeader, Section } from '@/components/shared/layout';
import { Person } from '@/components/shared/labels';
import MySignature from '@/components/srs/MySignature';
import ApiTokens from './_components/ApiTokens';

/** The signed-in user's own page: account details (read-only, from AD) and their signature */
export default function ProfilePage() {
  const t = useTranslations('profile');
  const ts = useTranslations('srs.signature');
  const { label } = useOptions();
  const { me } = useApp();
  if (!me) return null;

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title={t('title')} subtitle={t('subtitle')} />

      <Section title={t('account')}>
        <div className="mb-4 flex items-center gap-3">
          <Person name={me.full_name} showName={false} size={56} />
          <div className="min-w-0">
            <div className="truncate text-lg font-semibold">{me.full_name}</div>
            <div className="truncate text-sm text-muted-foreground">{[me.position, me.department].filter(Boolean).join(' · ')}</div>
          </div>
        </div>
        <div className="grid gap-x-6 sm:grid-cols-2 lg:grid-cols-3">
          <Field label={t('field.employeeId')}>{me.employee_id}</Field>
          <Field label={t('field.username')}>{me.username}</Field>
          <Field label={t('field.email')}>{me.email}</Field>
          <Field label={t('field.department')}>{me.department}</Field>
          <Field label={t('field.section')}>{me.section}</Field>
          <Field label={t('field.position')}>{me.position}</Field>
          <Field label={t('field.telephone')}>{me.telephone}</Field>
          <Field label={t('field.extension')}>{me.extension}</Field>
          {me.last_login_at && <Field label={t('field.lastLogin')}>{fmtDateTime(me.last_login_at)}</Field>}
        </div>
        <div className="mt-1">
          <div className="text-xs font-medium text-muted-foreground">{t('field.roles')}</div>
          <div className="mt-1 flex flex-wrap gap-1">
            {me.roles.map((r) => <span key={r} className="rounded bg-secondary px-1.5 py-0.5 text-xs">{label(ROLES, r)}</span>)}
          </div>
        </div>
        <p className="mt-4 text-xs text-muted-foreground">{t('accountNote')}</p>
      </Section>

      <Section title={ts('title')}>
        <p className="mb-3 text-sm text-muted-foreground">{ts('description')}</p>
        <MySignature />
      </Section>

      <Section title={t('tokens.title')}>
        <p className="mb-3 text-sm text-muted-foreground">{t('tokens.description')}</p>
        <ApiTokens />
      </Section>
    </div>
  );
}
