'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { useApp } from '@/providers/AppProvider';
import { TextField } from '@/components/shared/common';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { errMsg } from '@/lib/format';
import { dbClient } from '@/lib/db/client';
import type { ProjectType } from '@/lib/types';
import { TOKENS, TokenHints, previewCode } from './codeFormat';

export function SettingsAdmin() {
  const t = useTranslations('admin.projectCode');
  const tc = useTranslations('common');
  const db = dbClient();
  const { notify } = useApp();
  const [vals, setVals] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<Record<string, string>>({});
  const [typeCode, setTypeCode] = useState('DEV');
  const key = 'project_code_format';
  useEffect(() => {
    db.from('app_settings').select('*').then(({ data }) => {
      const v = Object.fromEntries((data ?? []).map((s: { key: string; value: unknown }) => [s.key, String(s.value)]));
      setVals(v);
      setSaved(v);
    });
    db.from('project_types').select('*').eq('is_active', true).order('code').then(({ data }) => {
      const first = (data as ProjectType[] | null)?.[0];
      if (first) setTypeCode(first.code);
    });
  }, [db]);
  const save = async () => {
    const { error } = await db.from('app_settings').update({ value: vals[key], updated_at: new Date().toISOString() }).eq('key', key);
    if (!error) setSaved({ ...saved, [key]: vals[key] });
    notify(error ? errMsg(error) : t('saved'), error ? 'error' : 'success');
  };

  return (
    <Card className="max-w-xl">
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div>
          <div className="flex items-end gap-2">
            <TextField className="flex-1" label={t('title')} mono value={vals[key]} onChange={(v) => setVals({ ...vals, [key]: v })} />
            <Button variant={vals[key] !== saved[key] ? 'default' : 'outline'} className="h-9" disabled={vals[key] === saved[key]} onClick={save}>{tc('save')}</Button>
          </div>
          <div className="mt-1.5 text-xs text-muted-foreground">
            {t('preview')} <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-foreground">{previewCode(vals[key], typeCode) || '—'}</span>
          </div>
        </div>
        <div className="border-t pt-4"><TokenHints tokens={TOKENS} /></div>
      </CardContent>
    </Card>
  );
}
