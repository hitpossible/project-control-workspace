'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useApp } from '@/providers/AppProvider';
import { BoardGroup } from '@/components/shared/common';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { errMsg } from '@/lib/format';
import { dbClient } from '@/lib/db/client';
import { cn } from '@/lib/utils';
import { useDepartments } from './useDepartments';

/** Blank → null (codes are optional); otherwise trimmed upper case */
const normCode = (v: string) => v.trim().toUpperCase() || null;

export function DepartmentsAdmin() {
  const t = useTranslations('admin.departments');
  const tc = useTranslations('common');
  const db = dbClient();
  const { notify, refreshProfiles } = useApp();
  const { departments, sections, load } = useDepartments();
  const [selected, setSelected] = useState<number | null>(null);
  const [newDept, setNewDept] = useState({ code: '', name: '' });
  const [newSection, setNewSection] = useState({ code: '', name: '' });
  const current = departments.find((d) => d.id === selected) ?? departments[0];
  const deptSections = sections.filter((s) => s.department_id === current?.id);

  const run = async (p: PromiseLike<{ error: { message: string } | null }>) => {
    const { error } = await p;
    if (error) notify(errMsg(error), 'error');
    await load();
    return !error;
  };
  // renames are copied to user profiles by the server
  const rename = async (table: 'departments' | 'sections', id: number, name: string) => {
    if (await run(db.from(table).update({ name: name.trim() }).eq('id', id))) refreshProfiles();
  };
  const setCode = (table: 'departments' | 'sections', id: number, code: string) =>
    run(db.from(table).update({ code: normCode(code) }).eq('id', id));

  return (
    <>
      <p className="mb-3 text-sm text-muted-foreground">{t('intro')}</p>
      <div className="grid grid-cols-12 gap-5">
        <div className="col-span-12 lg:col-span-6">
          <BoardGroup title={t('title')} color="#00c875" count={departments.length}>
            <Table className="board-table">
              <TableHeader><TableRow><TableHead className="w-24 text-left">{t('col.code')}</TableHead><TableHead className="min-w-36 text-left">{t('col.name')}</TableHead><TableHead className="w-20">{t('col.sections')}</TableHead><TableHead>{t('col.active')}</TableHead></TableRow></TableHeader>
              <TableBody>
                {departments.map((d) => (
                  <TableRow key={d.id} className={cn('cursor-pointer', d.id === current?.id && 'bg-accent')} onClick={() => setSelected(d.id)}>
                    <TableCell className="w-24"><Input key={d.code} defaultValue={d.code ?? ''} placeholder="—" className="h-8 min-w-20 font-mono uppercase" onBlur={(e) => normCode(e.target.value) !== d.code && setCode('departments', d.id, e.target.value)} /></TableCell>
                    <TableCell><Input defaultValue={d.name} className="h-8" onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== d.name && rename('departments', d.id, e.target.value)} /></TableCell>
                    <TableCell className="w-20 text-center">{sections.filter((s) => s.department_id === d.id).length}</TableCell>
                    <TableCell className="w-24 text-center"><Switch checked={d.is_active} onCheckedChange={(c) => run(db.from('departments').update({ is_active: c }).eq('id', d.id))} /></TableCell>
                  </TableRow>
                ))}
                <TableRow>
                  <TableCell><Input placeholder={t('col.code')} className="h-8 min-w-20 font-mono uppercase" value={newDept.code} onChange={(e) => setNewDept({ ...newDept, code: e.target.value })} /></TableCell>
                  <TableCell><Input placeholder={t('newDepartment')} className="h-8" value={newDept.name} onChange={(e) => setNewDept({ ...newDept, name: e.target.value })} /></TableCell>
                  <TableCell />
                  <TableCell className="text-center"><Button size="sm" disabled={!newDept.name.trim()} onClick={async () => {
                    if (await run(db.from('departments').insert({ code: normCode(newDept.code), name: newDept.name.trim() }))) setNewDept({ code: '', name: '' });
                  }}>{tc('add')}</Button></TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </BoardGroup>
        </div>
        <div className="col-span-12 lg:col-span-6">
          {current && (
            <BoardGroup title={t('sectionsOf', { name: current.name })} color="#579bfc" count={deptSections.length}>
              <Table className="board-table">
                <TableHeader><TableRow><TableHead className="w-24 text-left">{t('col.code')}</TableHead><TableHead className="min-w-36 text-left">{t('col.name')}</TableHead><TableHead>{t('col.active')}</TableHead></TableRow></TableHeader>
                <TableBody>
                  {deptSections.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell className="w-24"><Input key={s.code} defaultValue={s.code ?? ''} placeholder="—" className="h-8 min-w-20 font-mono uppercase" onBlur={(e) => normCode(e.target.value) !== s.code && setCode('sections', s.id, e.target.value)} /></TableCell>
                      <TableCell><Input defaultValue={s.name} className="h-8" onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== s.name && rename('sections', s.id, e.target.value)} /></TableCell>
                      <TableCell className="w-24 text-center"><Switch checked={s.is_active} onCheckedChange={(c) => run(db.from('sections').update({ is_active: c }).eq('id', s.id))} /></TableCell>
                    </TableRow>
                  ))}
                  <TableRow>
                    <TableCell><Input placeholder={t('col.code')} className="h-8 min-w-20 font-mono uppercase" value={newSection.code} onChange={(e) => setNewSection({ ...newSection, code: e.target.value })} /></TableCell>
                    <TableCell><Input placeholder={t('newSection')} className="h-8" value={newSection.name} onChange={(e) => setNewSection({ ...newSection, name: e.target.value })} /></TableCell>
                    <TableCell className="text-center"><Button size="sm" disabled={!newSection.name.trim()} onClick={async () => {
                      if (await run(db.from('sections').insert({ department_id: current.id, code: normCode(newSection.code), name: newSection.name.trim() }))) setNewSection({ code: '', name: '' });
                    }}>{tc('add')}</Button></TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </BoardGroup>
          )}
        </div>
      </div>
    </>
  );
}
