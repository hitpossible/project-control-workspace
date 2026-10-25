'use client';

import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { useApp } from '@/providers/AppProvider';
import { BoardGroup, MultiSelect } from '@/components/shared/common';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useOptions } from '@/i18n/useOptions';
import { MEMBER_ROLES } from '@/lib/constants';
import { errMsg } from '@/lib/format';
import { dbClient } from '@/lib/db/client';
import type { NotificationRule } from '@/lib/types';

export function RulesAdmin() {
  const t = useTranslations('admin.notificationRules');
  const { options } = useOptions();
  const db = dbClient();
  const { notify } = useApp();
  const [rows, setRows] = useState<NotificationRule[]>([]);
  const load = useCallback(async () => setRows(((await db.from('notification_rules').select('*').order('event_code')).data ?? []) as NotificationRule[]), [db]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data fetch
    load();
  }, [load]);
  const upd = async (code: string, patch: Partial<NotificationRule>) => {
    const { error } = await db.from('notification_rules').update(patch).eq('event_code', code);
    if (error) notify(errMsg(error), 'error');
    load();
  };
  const recipientOpts = [{ value: 'explicit', label: t('explicit') }, ...options(MEMBER_ROLES)];
  return (
    <>
      <p className="mb-3 text-sm text-muted-foreground">
        {t('intro')}
      </p>
      <BoardGroup title={t('title')} color="#fdab3d" count={rows.length}>
        <Table className="board-table">
          <TableHeader><TableRow><TableHead className="text-left">{t('col.event')}</TableHead><TableHead className="min-w-80">{t('col.recipients')}</TableHead><TableHead>{t('col.inApp')}</TableHead><TableHead>{t('col.email')}</TableHead><TableHead>{t('col.repeat')}</TableHead><TableHead>{t('col.escalateAfter')}</TableHead><TableHead className="min-w-56">{t('col.escalateTo')}</TableHead><TableHead>{t('col.active')}</TableHead></TableRow></TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.event_code}>
                <TableCell><div className="font-semibold">{r.name}</div><div className="text-xs text-muted-foreground">{r.event_code}</div></TableCell>
                <TableCell className="whitespace-normal"><MultiSelect value={r.recipient_roles} onChange={(v) => upd(r.event_code, { recipient_roles: v })} options={recipientOpts} /></TableCell>
                {(['in_app', 'email'] as const).map((ch) => (
                  <TableCell key={ch} className="text-center">
                    <Checkbox checked={r.channels.includes(ch)} onCheckedChange={(c) => upd(r.event_code, { channels: c ? [...r.channels, ch] : r.channels.filter((x) => x !== ch) })} />
                  </TableCell>
                ))}
                {['task_overdue', 'fix_overdue'].includes(r.event_code) ? (
                  <>
                    <TableCell className="text-center"><Input type="number" defaultValue={r.escalation_days ?? 1} className="mx-auto h-8 w-20" onBlur={(e) => upd(r.event_code, { escalation_days: Math.max(1, Number(e.target.value)) })} /></TableCell>
                    <TableCell className="text-center"><Input type="number" defaultValue={r.escalate_after_days ?? ''} placeholder={t('never')} className="mx-auto h-8 w-20" onBlur={(e) => upd(r.event_code, { escalate_after_days: e.target.value ? Math.max(1, Number(e.target.value)) : null })} /></TableCell>
                    <TableCell className="whitespace-normal"><MultiSelect value={r.escalate_roles ?? []} onChange={(v) => upd(r.event_code, { escalate_roles: v })} options={options(MEMBER_ROLES)} placeholder="—" /></TableCell>
                  </>
                ) : <><TableCell className="text-center">-</TableCell><TableCell className="text-center">-</TableCell><TableCell className="text-center">-</TableCell></>}
                <TableCell className="text-center"><Switch checked={r.is_active} onCheckedChange={(c) => upd(r.event_code, { is_active: c })} /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </BoardGroup>
    </>
  );
}
