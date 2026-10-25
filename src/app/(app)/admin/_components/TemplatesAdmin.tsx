'use client';

import { Copy, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { useApp } from '@/providers/AppProvider';
import { BoardGroup } from '@/components/shared/labels';
import { TemplateEditor, draftProblems, fromDraft, toDraft, type TemplateDraft } from './TemplateEditor';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { errMsg } from '@/lib/format';
import { dbClient } from '@/lib/db/client';
import type { ProjectTemplate, ProjectType } from '@/lib/types';
import { cn } from '@/lib/utils';

export function TemplatesAdmin() {
  const t = useTranslations('admin.templates');
  const tt = useTranslations('template');
  const tc = useTranslations('common');
  const db = dbClient();
  const { notify } = useApp();
  const [rows, setRows] = useState<ProjectTemplate[]>([]);
  const [types, setTypes] = useState<ProjectType[]>([]);
  const [edit, setEdit] = useState<TemplateDraft | null>(null);
  const load = useCallback(async () => {
    setRows(((await db.from('project_templates').select('*').order('name')).data ?? []) as ProjectTemplate[]);
    setTypes(((await db.from('project_types').select('*').order('name')).data ?? []) as ProjectType[]);
  }, [db]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data fetch
    load();
  }, [load]);

  const problems = edit ? draftProblems(edit, tt) : [];
  const save = async () => {
    if (!edit) return;
    if (problems.length) return notify(problems[0], 'error');
    const payload = fromDraft(edit);
    const res = edit.id ? await db.from('project_templates').update(payload).eq('id', edit.id) : await db.from('project_templates').insert(payload);
    if (res.error) return notify(errMsg(res.error), 'error');
    notify(t('saved'));
    setEdit(null);
    load();
  };

  const open = (x?: ProjectTemplate) => setEdit(toDraft(x));
  const duplicate = () => edit && setEdit({ ...edit, id: undefined, code: `${edit.code ?? ''}-COPY`, name: tt('copyName', { name: edit.name ?? '' }) });
  const totalDays = (x: ProjectTemplate) => x.default_activities.reduce((s, a) => s + Math.max(1, a.duration_days ?? 1), 0);

  return (
    <>
      <p className="mb-3 text-sm text-muted-foreground">{t('intro')}</p>
      <BoardGroup title={t('title')} color="#00c875" count={rows.length} actions={<Button size="sm" onClick={() => open()}><Plus /> {t('add')}</Button>}>
        <Table className="board-table">
          <TableHeader><TableRow><TableHead>{t('col.code')}</TableHead><TableHead className="text-left">{t('col.name')}</TableHead><TableHead>{t('col.type')}</TableHead><TableHead className="text-left">{t('col.activities')}</TableHead><TableHead>{t('col.duration')}</TableHead><TableHead>{t('col.active')}</TableHead></TableRow></TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id} className={cn('cursor-pointer', !r.is_active && 'opacity-50')} onClick={() => open(r)}>
                <TableCell className="font-semibold">{r.code}</TableCell>
                <TableCell>{r.name}</TableCell>
                <TableCell className="text-center">{types.find((x) => x.id === r.project_type_id)?.name}</TableCell>
                <TableCell className="whitespace-normal">
                  <div className="flex flex-wrap items-center gap-1">
                    {r.default_activities.map((a, i) => (
                      <span key={i} className={cn('rounded px-1.5 py-0.5 text-xs', a.is_milestone ? 'bg-amber-100 text-amber-900' : 'bg-secondary')}>{a.name}</span>
                    ))}
                  </div>
                </TableCell>
                <TableCell className="text-center text-muted-foreground">{t('days', { count: totalDays(r) })}</TableCell>
                <TableCell className="text-center">{r.is_active ? t('yes') : t('no')}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </BoardGroup>
      {edit && (
        <Dialog open onOpenChange={(o) => !o && setEdit(null)}>
          <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-5xl">
            <DialogHeader><DialogTitle>{edit.id ? t('edit', { code: edit.code ?? '' }) : t('add')}</DialogTitle></DialogHeader>
            <TemplateEditor draft={edit} onChange={setEdit} types={types} />
            <DialogFooter className="items-center sm:justify-between">
              {edit.id ? <Button variant="ghost" onClick={duplicate}><Copy /> {t('duplicate')}</Button> : <span />}
              <div className="flex items-center gap-2">
                {problems.length > 0 && <span className="text-xs text-destructive">{problems[0]}</span>}
                <Button variant="outline" onClick={() => setEdit(null)}>{tc('cancel')}</Button>
                <Button onClick={save} disabled={problems.length > 0}>{tc('save')}</Button>
              </div>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
