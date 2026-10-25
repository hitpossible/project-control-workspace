'use client';

import { Download } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { BoardGroup } from '@/components/shared/labels';
import { EmptyState, PageHeader, StatCard } from '@/components/shared/layout';
import { SelectField } from '@/components/shared/form';
import { InsightRow, useInsights } from '@/components/shared/InsightList';
import { Button } from '@/components/ui/button';
import { useOptions } from '@/i18n/useOptions';
import { GROUP_COLORS, INSIGHT_SEVERITIES } from '@/lib/constants';
import { exportInsightsExcel } from '@/lib/exportExcel';

/** group key for insights without a project */
const TEAM = '__team__';

export default function InsightsPage() {
  const t = useTranslations('insights');
  const { label, options } = useOptions();
  const rows = useInsights(null);
  const [sev, setSev] = useState('');
  const [rule, setRule] = useState('');
  const list = (rows ?? []).filter((r) => (!sev || r.severity === sev) && (!rule || r.rule_code === rule));
  const rules = useMemo(() => [...new Map((rows ?? []).map((r) => [r.rule_code, r.rule_code.replace(/_/g, ' ')])).entries()], [rows]);
  const groups = [...new Set(list.map((r) => r.project_code ?? TEAM))];
  const count = (s: string) => (rows ?? []).filter((r) => r.severity === s).length;

  return (
    <>
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        actions={<Button variant="outline" onClick={() => exportInsightsExcel(list)}><Download /> {t('exportExcel')}</Button>}
      />
      <div className="mb-5 grid grid-cols-3 gap-3 md:max-w-2xl">
        <StatCard label={label(INSIGHT_SEVERITIES, 'critical')} value={count('critical')} color="#e2445c" onClick={() => setSev(sev === 'critical' ? '' : 'critical')} />
        <StatCard label={label(INSIGHT_SEVERITIES, 'warning')} value={count('warning')} color="#fdab3d" onClick={() => setSev(sev === 'warning' ? '' : 'warning')} />
        <StatCard label={label(INSIGHT_SEVERITIES, 'info')} value={count('info')} color="#579bfc" onClick={() => setSev(sev === 'info' ? '' : 'info')} />
      </div>
      <div className="mb-6 flex flex-wrap items-end gap-3 border-b border-grid pb-4">
        <SelectField className="w-40" label={t('severity')} value={sev} allowEmpty placeholder={t('all')} onChange={setSev} options={options(INSIGHT_SEVERITIES)} />
        <SelectField className="w-60" label={t('rule')} value={rule} allowEmpty placeholder={t('allRules')} onChange={setRule}
          options={rules.map(([v, l]) => ({ value: v, label: l.charAt(0).toUpperCase() + l.slice(1) }))} />
      </div>
      {rows === null ? <EmptyState text={t('analysing')} /> : list.length === 0 ? <EmptyState done text={t('none')} /> : groups.map((g, i) => {
        const items = list.filter((r) => (r.project_code ?? TEAM) === g);
        return (
          <BoardGroup key={g} title={g === TEAM ? t('teamResources') : g} color={GROUP_COLORS[i % GROUP_COLORS.length]} count={items.length}>
            <div className="divide-y divide-grid">
              {items.map((r, n) => <InsightRow key={`${r.rule_code}-${r.entity_id}-${n}`} i={r} showProject={false} />)}
            </div>
          </BoardGroup>
        );
      })}
    </>
  );
}
