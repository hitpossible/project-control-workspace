'use client';

import { Trash2 } from 'lucide-react';
import { useState } from 'react';
import { dispatchEmails, useApp } from '@/components/AppProvider';
import { BoardGroup, Person, SelectField, UserSelect } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { MEMBER_ROLES, optLabel } from '@/lib/constants';
import { errMsg } from '@/lib/format';
import { dbClient } from '@/lib/db/client';
import type { TabProps } from './types';

export default function TeamTab({ data, perm, reload }: TabProps) {
  const db = dbClient();
  const { profiles, notify } = useApp();
  const [user, setUser] = useState<string | null>(null);
  const [role, setRole] = useState('developer');

  const add = async () => {
    if (!user) return;
    const { error } = await db.from('project_members').insert({ project_id: data.project.id, user_id: user, member_role: role });
    if (error) return notify(errMsg(error), 'error');
    setUser(null);
    notify('Member added');
    dispatchEmails();
    await reload();
  };

  return (
    <div>
      <p className="mb-4 text-sm text-muted-foreground">
        Project Team & Notification Group — notification recipients are resolved from team roles and the Notification Rules for each event.
      </p>
      {perm.manage && (
        <div className="no-print mb-5 grid grid-cols-12 items-end gap-3">
          <UserSelect className="col-span-12 sm:col-span-5" label="Member" value={user} onChange={setUser} />
          <SelectField className="col-span-8 sm:col-span-4" label="Role in project" value={role} onChange={setRole} options={MEMBER_ROLES} />
          <Button className="col-span-4 h-9 sm:col-span-3" disabled={!user} onClick={add}>Add Member</Button>
        </div>
      )}
      <BoardGroup title="Project Team" color="#a25ddc" count={data.members.length}>
        <Table className="board-table">
          <TableHeader>
            <TableRow>
              <TableHead className="text-left">Name</TableHead><TableHead>Role in Project</TableHead><TableHead>Department</TableHead><TableHead>Email</TableHead>
              <TableHead>Receive Notifications</TableHead>{perm.manage && <TableHead />}
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
                        if (!confirm(`Remove ${p?.full_name} (${optLabel(MEMBER_ROLES, m.member_role)})?`)) return;
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
