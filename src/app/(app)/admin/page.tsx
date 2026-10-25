'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useApp } from '@/providers/AppProvider';
import { PageHeader } from '@/components/shared/layout';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { UsersAdmin } from './_components/UsersAdmin';
import { DepartmentsAdmin } from './_components/DepartmentsAdmin';
import { DocumentTypesAdmin } from './_components/DocumentTypesAdmin';
import { TypesAdmin } from './_components/TypesAdmin';
import { TemplatesAdmin } from './_components/TemplatesAdmin';
import { SettingsAdmin } from './_components/SettingsAdmin';
import { WorkingDaysAdmin } from './_components/WorkingDaysAdmin';
import { RulesAdmin } from './_components/RulesAdmin';
import { InsightRulesAdmin } from './_components/InsightRulesAdmin';
import { KpiSettingsAdmin } from './_components/KpiSettingsAdmin';

// A plain mouse wheel only scrolls vertically, so turn it into horizontal scrolling of the tab strip.
function wheelScrollX(el: HTMLDivElement | null) {
  if (!el) return;
  const onWheel = (e: WheelEvent) => {
    if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
    const max = el.scrollWidth - el.clientWidth;
    if (max <= 0) return;
    const next = Math.min(max, Math.max(0, el.scrollLeft + e.deltaY));
    if (next === el.scrollLeft) return;
    e.preventDefault();
    el.scrollLeft = next;
  };
  el.addEventListener('wheel', onWheel, { passive: false });
  return () => el.removeEventListener('wheel', onWheel);
}

/** labels: admin.tab.<key> */
const TABS = ['users', 'departments', 'documentTypes', 'projectTypes', 'templates', 'projectCode', 'workingDays', 'notificationRules', 'insightRules', 'kpi'] as const;

export default function AdminPage() {
  const t = useTranslations('admin');
  const { hasRole } = useApp();
  const [tab, setTab] = useState<string>(TABS[0]);
  if (!hasRole('admin')) return <Alert><AlertDescription>{t('adminOnly')}</AlertDescription></Alert>;
  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <Tabs value={tab} onValueChange={setTab} className="mb-5">
        <TabsList ref={wheelScrollX} variant="line" className="no-scrollbar w-full justify-start overflow-x-auto border-b border-grid">
          {TABS.map((k) => <TabsTrigger key={k} value={k} className="flex-none px-3">{t(`tab.${k}`)}</TabsTrigger>)}
        </TabsList>
      </Tabs>
      <div key={tab} className="motion-rise">
      {tab === 'users' && <UsersAdmin />}
      {tab === 'departments' && <DepartmentsAdmin />}
      {tab === 'documentTypes' && <DocumentTypesAdmin />}
      {tab === 'projectTypes' && <TypesAdmin />}
      {tab === 'templates' && <TemplatesAdmin />}
      {tab === 'projectCode' && <SettingsAdmin />}
      {tab === 'workingDays' && <WorkingDaysAdmin />}
      {tab === 'notificationRules' && <RulesAdmin />}
      {tab === 'insightRules' && <InsightRulesAdmin />}
      {tab === 'kpi' && <KpiSettingsAdmin />}
      </div>
    </>
  );
}
