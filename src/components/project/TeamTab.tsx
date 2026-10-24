'use client';

import { Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { dispatchEmails, useApp } from '@/components/AppProvider';
import { BoardGroup, Person, SelectField, UserSelect } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useOptions } from '@/i18n/useOptions';
import { MEMBER_ROLES } from '@/lib/constants';
import { errMsg } from '@/lib/format';
import { dbClient } from '@/lib/db/client';
import type { TabProps } from './types';
import { confirmDialog } from '@/components/ConfirmDialog';

export default function TeamTab({ data, perm, reload }: TabProps) {
  const t = useTranslations('project.team');
  const { label: optLabel, options } = useOptions();
  const db = dbClient();
  const { profiles, notify } = useApp();
  const [user, setUser] = useState<number | null>(null);
  const [role, setRole] = useState('developer');

  const add = async () => {
    if (!user) return;
    const { error } = await db.from('project_members').insert({ project_id: data.project.id, user_id: user, member_role: role });
    if (error) return notify(errMsg(error), 'error');
    setUser(null);
    notify(t('added'));
    dispatchEmails();
    await reload();
  };

  return (
    <div>
      <p className="mb-4 text-sm text-muted-foreground">
        {t('intro')}
      </p>
      {perm.manage && (
        <div className="no-print mb-5 grid grid-cols-12 items-end gap-3">
          <UserSelect className="col-span-12 sm:col-span-5" label={t('member')} value={user} onChange={setUser} />
          <SelectField className="col-span-8 sm:col-span-4" label={t('roleInProject')} value={role} onChange={setRole} options={options(MEMBER_ROLES)} />
          <Button className="col-span-4 h-9 sm:col-span-3" disabled={!user} onClick={add}>{t('add')}</Button>
        </div>
      )}
      <BoardGroup title={t('title')} color="#a25ddc" count={data.members.length}>
        <Table className="board-table">
          <TableHeader>
            <TableRow>
              <TableHead className="text-left">{t('col.name')}</TableHead><TableHead>{t('col.role')}</TableHead><TableHead>{t('col.department')}</TableHead><TableHead>{t('col.email')}</TableHead>
              <TableHead>{t('col.notify')}</TableHead>{perm.manage && <TableHead />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.members.map((m) => {
              const p = profiles.find((x) => x.id === m.user_id);
              return (
                <TableRow key={m.id}>
                  <TableCell><Person name={p?.full_name} /></TableCell>
                  <TableCell className="text-center">{optLabel(MEMBER_ROLES, m.member_role)}</TableCell>
                  <TableCell className="text-center">{p?.department}</TableCell>
                  <TableCell className="text-center">{p?.email}</TableCell>
                  <TableCell className="text-center">
                    <Checkbox checked={m.notify} disabled={!perm.manage} onCheckedChange={async (c) => {
                      const { error } = await db.from('project_members').update({ notify: !!c }).eq('id', m.id);
                      if (error) notify(errMsg(error), 'error');
                      await reload();
                    }} />
                  </TableCell>
                  {perm.manage && (
                    <TableCell className="w-11 text-center">
                      <Button variant="ghost" size="icon-sm" disabled={m.member_role === 'leader' && m.user_id === data.project.leader_id} onClick={async () => {
                        if (!(await confirmDialog({ title: t('remove.title', { name: p?.full_name ?? '' }), description: t('remove.description', { role: optLabel(MEMBER_ROLES, m.member_role) }), confirmText: t('remove.confirm'), destructive: true }))) return;
                        const { error } = await db.from('project_members').delete().eq('id', m.id);
                        if (error) return notify(errMsg(error), 'error');
                        await reload();
                      }}><Trash2 /></Button>
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </BoardGroup>
    </div>
  );
}
