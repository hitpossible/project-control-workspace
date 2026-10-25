'use client';

import { MonitorX, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useApp } from '@/providers/AppProvider';
import { BoardGroup, MultiSelect, Person, SelectField, TextField } from '@/components/shared/common';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useOptions } from '@/i18n/useOptions';
import { ROLES } from '@/lib/constants';
import { errMsg } from '@/lib/format';
import { dbClient } from '@/lib/db/client';
import type { Profile, Role } from '@/lib/types';
import { POSITION_LEVELS } from '@/lib/approval';
import { cn } from '@/lib/utils';
import { confirmDialog } from '@/components/shared/ConfirmDialog';
import { useDepartments } from './useDepartments';

export function UsersAdmin() {
  const t = useTranslations('admin.users');
  const tc = useTranslations('common');
  const { label: optLabel, options: optOptions } = useOptions();
  const db = dbClient();
  const { profiles, refreshProfiles, notify } = useApp();
  const [edit, setEdit] = useState<(Partial<Profile> & { password?: string }) | null>(null);
  const { departments, sections, positions } = useDepartments();
  // active entries, plus the user's current one so an inactive entry is not lost
  const options = (rows: { id: number; name: string; is_active?: boolean }[], current: number | null | undefined) =>
    rows.filter((r) => r.is_active !== false || r.id === current).map((r) => ({ value: String(r.id), label: r.name }));
  const deptOpts = options(departments, edit?.department_id);
  const sectionOpts = options(sections.filter((x) => x.department_id === edit?.department_id), edit?.section_id);
  const positionOpts = options(positions, edit?.position_id);
  const idOrNull = (v: string) => (v ? Number(v) : null);

  const save = async () => {
    if (!edit) return;
    const call = async (method: 'POST' | 'PATCH', body: unknown) => {
      const res = await fetch('/api/admin/users', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      return res.ok ? null : ((await res.json().catch(() => null))?.error?.message ?? t('failed'));
    };
    if (!edit.id) {
      const err = await call('POST', edit);
      if (err) return notify(err, 'error');
    } else {
      const { error } = await db.from('profiles').update({
        username: edit.username || null, email: edit.email || null,
        full_name: edit.full_name, employee_id: edit.employee_id, department_id: edit.department_id ?? null, section_id: edit.section_id ?? null, position_id: edit.position_id ?? null,
        telephone: edit.telephone, extension: edit.extension, roles: edit.roles, is_active: edit.is_active,
      }).eq('id', edit.id);
      if (error) return notify(errMsg(error), 'error');
      if (edit.password) {
        const err = await call('PATCH', { id: edit.id, password: edit.password });
        if (err) return notify(err, 'error');
      }
    }
    notify(t('saved'));
    setEdit(null);
    refreshProfiles();
  };

  const set = (patch: Partial<Profile> & { password?: string }) => setEdit((e) => ({ ...e, ...patch }));

  const revokeSessions = async () => {
    if (!edit?.id) return;
    if (!(await confirmDialog({ title: t('revoke.title', { name: edit.full_name ?? '' }), description: t('revoke.text'), confirmText: t('revoke.confirm'), destructive: true }))) return;
    const res = await fetch('/api/admin/users', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: edit.id, revoke_sessions: true }) });
    if (!res.ok) return notify((await res.json().catch(() => null))?.error?.message ?? t('failed'), 'error');
    notify(t('revoke.done'));
  };

  return (
    <>
      <BoardGroup title={t('title')} color="#579bfc" count={profiles.length}
        actions={<Button size="sm" onClick={() => setEdit({ roles: ['requestor'], is_active: true })}><Plus /> {t('add')}</Button>}>
        <Table className="board-table">
          <TableHeader><TableRow><TableHead className="text-left">{t('col.name')}</TableHead><TableHead>{t('col.empId')}</TableHead><TableHead>{t('col.username')}</TableHead><TableHead>{t('col.email')}</TableHead><TableHead>{t('col.department')}</TableHead><TableHead>{t('col.position')}</TableHead><TableHead>{t('col.roles')}</TableHead><TableHead>{t('col.active')}</TableHead></TableRow></TableHeader>
          <TableBody>
            {profiles.map((p) => (
              <TableRow key={p.id} className={cn('cursor-pointer', !p.is_active && 'opacity-50')} onClick={() => setEdit({ ...p })}>
                <TableCell><Person name={p.full_name} /></TableCell>
                <TableCell className="text-center">{p.employee_id}</TableCell>
                <TableCell className="text-center">{p.username}</TableCell>
                <TableCell className="text-center">{p.email}</TableCell>
                <TableCell className="text-center">{p.department}</TableCell>
                <TableCell className="text-center">{p.position}</TableCell>
                <TableCell className="whitespace-normal">
                  <div className="flex flex-wrap gap-1">{p.roles.map((r) => <span key={r} className="rounded bg-secondary px-1.5 py-0.5 text-xs">{optLabel(ROLES, r)}</span>)}</div>
                </TableCell>
                <TableCell className="text-center">{p.is_active ? t('yes') : t('no')}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </BoardGroup>
      {edit && (
        <Dialog open onOpenChange={(o) => !o && setEdit(null)}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader><DialogTitle>{edit.id ? t('edit') : t('add')}</DialogTitle></DialogHeader>
            <div className="grid grid-cols-12 gap-3">
              <TextField className="col-span-8" label={t('field.fullName')} required value={edit.full_name} onChange={(v) => set({ full_name: v })} />
              <TextField className="col-span-4" label={t('field.employeeId')} value={edit.employee_id} onChange={(v) => set({ employee_id: v })} />
              <TextField className="col-span-6" label={t('field.username')} value={edit.username} onChange={(v) => set({ username: v })} helperText={t('field.usernameHelp')} />
              <TextField className="col-span-6" label={t('field.email')} value={edit.email} onChange={(v) => set({ email: v })} />
              <TextField className="col-span-12" label={edit.id ? t('field.setPassword') : t('field.password')} type="password" value={edit.password} onChange={(v) => set({ password: v })}
                helperText={t('field.passwordHelp')} />
              <SelectField className="col-span-6" label={t('field.department')} allowEmpty value={edit.department_id?.toString()} options={deptOpts}
                onChange={(v) => set({ department_id: idOrNull(v), section_id: idOrNull(v) === edit.department_id ? edit.section_id : null })} />
              <SelectField className="col-span-6" label={t('field.section')} allowEmpty value={edit.section_id?.toString()} options={sectionOpts}
                disabled={!edit.department_id} onChange={(v) => set({ section_id: idOrNull(v) })} />
              <SelectField className="col-span-12" label={t('field.position')} allowEmpty value={edit.position_id?.toString()} options={positionOpts}
                onChange={(v) => set({ position_id: idOrNull(v) })}
                helperText={t('field.positionHelp', { positions: POSITION_LEVELS.filter((l) => l.value !== 'staff').map((l) => l.position).join(', ') })} />
              <TextField className="col-span-8" label={t('field.telephone')} value={edit.telephone} onChange={(v) => set({ telephone: v })} />
              <TextField className="col-span-4" label={t('field.ext')} value={edit.extension} onChange={(v) => set({ extension: v })} />
              <MultiSelect className="col-span-12" label={t('col.roles')} value={edit.roles ?? []} onChange={(v) => set({ roles: v as Role[] })} options={optOptions(ROLES)} />
              <label className="col-span-12 flex items-center gap-2 text-sm"><Switch checked={!!edit.is_active} onCheckedChange={(c) => set({ is_active: c })} /> {t('col.active')}</label>
            </div>
            <DialogFooter>
              {edit.id && <Button variant="outline" className="sm:mr-auto" onClick={revokeSessions}><MonitorX /> {t('revoke.button')}</Button>}
              <Button variant="outline" onClick={() => setEdit(null)}>{tc('cancel')}</Button><Button onClick={save}>{tc('save')}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
