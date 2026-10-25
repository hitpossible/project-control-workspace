'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { useApp } from '@/providers/AppProvider';
import { MultiSelect } from '@/components/shared/common';
import { Button } from '@/components/ui/button';
import { useOptions } from '@/i18n/useOptions';
import { DELAY_CATEGORIES } from '@/lib/constants';
import { errMsg } from '@/lib/format';
import { dbClient } from '@/lib/db/client';

export function KpiSettingsAdmin() {
  const t = useTranslations('admin.kpi');
  const tc = useTranslations('common');
  const { options } = useOptions();
  const db = dbClient();
  const { notify } = useApp();
  const [cats, setCats] = useState<string[]>([]);
  useEffect(() => {
    db.from('app_settings').select('value').eq('key', 'kpi_excluded_delay_categories').maybeSingle().then(({ data }) => setCats((data?.value as string[]) ?? []));
  }, [db]);
  return (
    <div className="max-w-2xl">
      <h3 className="mb-1 font-semibold">{t('title')}</h3>
      <p className="mb-3 text-sm text-muted-foreground">
        {t.rich('intro', { b: (c) => <b>{c}</b> })}
      </p>
      <MultiSelect label={t('excused')} value={cats} onChange={setCats} options={options(DELAY_CATEGORIES)} />
      <Button className="mt-3" onClick={async () => {
        const { error } = await db.from('app_settings').upsert({ key: 'kpi_excluded_delay_categories', value: cats, updated_at: new Date().toISOString() });
        notify(error ? errMsg(error) : t('saved'), error ? 'error' : 'success');
      }}>{tc('save')}</Button>
    </div>
  );
}
