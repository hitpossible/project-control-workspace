'use client';

import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { useApp } from '@/providers/AppProvider';
import { BoardGroup } from '@/components/shared/labels';
import { SelectField } from '@/components/shared/form';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useOptions } from '@/i18n/useOptions';
import { INSIGHT_SEVERITIES } from '@/lib/constants';
import { errMsg } from '@/lib/format';
import { dbClient } from '@/lib/db/client';
import type { InsightRule } from '@/lib/types';

export function InsightRulesAdmin() {
  const t = useTranslations('admin.insightRules');
  const { options } = useOptions();
  const db = dbClient();
  const { notify } = useApp();
  const [rows, setRows] = useState<InsightRule[]>([]);
  const load = useCallback(async () => setRows(((await db.from('insight_rules').select('*').order('internal').order('code')).data ?? []) as InsightRule[]), [db]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data fetch
    load();
  }, [load]);
  const upd = async (code: string, patch: Partial<InsightRule>) => {
    const { error } = await db.from('insight_rules').update(patch).eq('code', code);
    if (error) notify(errMsg(error), 'error');
    load();
  };
  return (
    <>
      <p className="mb-3 text-sm text-muted-foreground">{t('intro')}</p>
      <BoardGroup title={t('title')} color="#784bd1" count={rows.length}>
        <Table className="board-table">
          <TableHeader><TableRow><TableHead className="text-left">{t('col.rule')}</TableHead><TableHead>{t('col.threshold')}</TableHead><TableHead>{t('col.severity')}</TableHead><TableHead>{t('col.visibility')}</TableHead><TableHead>{t('col.active')}</TableHead></TableRow></TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.code}>
                <TableCell className="whitespace-normal"><div className="font-semibold">{r.name}</div><div className="text-xs text-muted-foreground">{r.description}</div></TableCell>
                <TableCell className="text-center">{r.threshold_label
                  ? <div className="flex items-center justify-center gap-1"><Input type="number" defaultValue={r.threshold ?? ''} className="h-8 w-20" onBlur={(e) => upd(r.code, { threshold: e.target.value === '' ? null : Number(e.target.value) })} /><span className="text-xs text-muted-foreground">{r.threshold_label}</span></div>
                  : '-'}</TableCell>
                <TableCell className="w-36"><SelectField value={r.severity} onChange={(v) => upd(r.code, { severity: v })} options={options(INSIGHT_SEVERITIES)} /></TableCell>
                <TableCell className="text-center text-xs">{r.internal ? t('internal') : t('everyone')}</TableCell>
                <TableCell className="text-center"><Switch checked={r.is_active} onCheckedChange={(c) => upd(r.code, { is_active: c })} /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </BoardGroup>
    </>
  );
}
