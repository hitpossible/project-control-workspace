'use client';

import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { useApp } from '@/providers/AppProvider';
import { BoardGroup } from '@/components/shared/common';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { errMsg } from '@/lib/format';
import { dbClient } from '@/lib/db/client';
import type { ProjectType } from '@/lib/types';

export function TypesAdmin() {
  const t = useTranslations('admin.types');
  const tc = useTranslations('common');
  const db = dbClient();
  const { notify } = useApp();
  const [rows, setRows] = useState<ProjectType[]>([]);
  const [n, setN] = useState({ code: '', name: '' });
  const load = useCallback(async () => setRows(((await db.from('project_types').select('*').order('code')).data ?? []) as ProjectType[]), [db]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data fetch
    load();
  }, [load]);
  const upd = async (id: number, patch: Partial<ProjectType>) => {
    const { error } = await db.from('project_types').update(patch).eq('id', id);
    if (error) notify(errMsg(error), 'error');
    load();
  };
  return (
    <>
      <p className="mb-3 text-sm text-muted-foreground">{t('intro', { token: '{TYPE}' })}</p>
      <BoardGroup title={t('title')} color="#a25ddc" count={rows.length}>
        <Table className="board-table">
          <TableHeader><TableRow><TableHead>{t('col.code')}</TableHead><TableHead className="text-left">{t('col.name')}</TableHead><TableHead>{t('col.active')}</TableHead></TableRow></TableHeader>
          <TableBody>
            {rows.map((x) => (
              <TableRow key={x.id}>
                <TableCell className="w-28 text-center font-semibold">{x.code}</TableCell>
                <TableCell><Input defaultValue={x.name} className="h-8" onBlur={(e) => e.target.value !== x.name && upd(x.id, { name: e.target.value })} /></TableCell>
                <TableCell className="w-24 text-center"><Switch checked={x.is_active} onCheckedChange={(c) => upd(x.id, { is_active: c })} /></TableCell>
              </TableRow>
            ))}
            <TableRow>
              <TableCell><Input placeholder={t('codePlaceholder')} className="h-8" value={n.code} onChange={(e) => setN({ ...n, code: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') })} /></TableCell>
              <TableCell><Input placeholder={t('col.name')} className="h-8" value={n.name} onChange={(e) => setN({ ...n, name: e.target.value })} /></TableCell>
              <TableCell className="text-center"><Button size="sm" disabled={!n.code || !n.name} onClick={async () => {
                const { error } = await db.from('project_types').insert(n);
                if (error) return notify(errMsg(error), 'error');
                setN({ code: '', name: '' }); load();
              }}>{tc('add')}</Button></TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </BoardGroup>
    </>
  );
}
