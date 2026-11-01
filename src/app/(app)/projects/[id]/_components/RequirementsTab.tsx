'use client';

import { ListChecks, Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import { dispatchEmails, useApp } from '@/providers/AppProvider';
import { DateField, SelectField, TextField, UserSelect } from '@/components/shared/form';
import { BoardGroup, StatusChip } from '@/components/shared/labels';
import { EmptyState } from '@/components/shared/layout';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useOptions } from '@/i18n/useOptions';
import { REQ_PRIORITIES, REQ_STATUSES } from '@/lib/constants';
import { dbClient } from '@/lib/db/client';
import { errMsg } from '@/lib/format';
import type { ProjectRequirement } from '@/lib/types';
import { rpc } from './ClosureSignoff';
import type { TabProps } from './types';

/** Project requirements → tasks. Server: src/server/rpc/requirements.ts */
export default function RequirementsTab({ data, perm, reload, memberProfiles }: TabProps) {
  const t = useTranslations('project.requirements');
  const [editing, setEditing] = useState<ProjectRequirement | 'new' | null>(null);
  const [converting, setConverting] = useState(false);
  const p = data.project;
  const closed = ['completed', 'cancelled'].includes(p.status);
  const canEdit = perm.manage && !closed;

  // tasks per requirement (only the project team sees tasks)
  const progress = useMemo(() => {
    const m = new Map<number, { total: number; done: number }>();
    for (const task of data.tasks) {
      if (!task.requirement_id || task.status === 'cancelled') continue;
      const c = m.get(task.requirement_id) ?? { total: 0, done: 0 };
      c.total++;
      if (task.status === 'completed') c.done++;
      m.set(task.requirement_id, c);
    }
    return m;
  }, [data.tasks]);

  const live = data.reqs.filter((r) => r.status !== 'dropped' && r.priority !== 'wont');
  const doneCount = live.filter((r) => { const c = progress.get(r.id); return c && c.total > 0 && c.done === c.total; }).length;
  const convertable = data.reqs.filter((r) => r.status === 'approved' && r.priority !== 'wont' && !data.tasks.some((x) => x.requirement_id === r.id));

  const groups = useMemo(() => {
    const m = new Map<string, ProjectRequirement[]>();
    for (const r of data.reqs) m.set(r.category ?? '', [...(m.get(r.category ?? '') ?? []), r]);
    return [...m.entries()].sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)));
  }, [data.reqs]);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="max-w-2xl text-sm text-muted-foreground">{t('intro')}</p>
          {data.reqs.length > 0 && (
            <p className="mt-1 text-xs text-muted-foreground">
              {t('total', { n: data.reqs.length })} · {t('approvedCount', { n: data.reqs.filter((r) => r.status === 'approved').length })}
              {perm.internal && live.length > 0 && <> · {t('covered', { pct: Math.round((doneCount / live.length) * 100) })}</>}
            </p>
          )}
        </div>
        {canEdit && (
          <div className="flex gap-2">
            {perm.internal && <Button variant="outline" disabled={!convertable.length} onClick={() => setConverting(true)}><ListChecks /> {t('convert')}{convertable.length ? ` (${convertable.length})` : ''}</Button>}
            <Button onClick={() => setEditing('new')}><Plus /> {t('new')}</Button>
          </div>
        )}
      </div>

      {data.reqs.length === 0 ? <EmptyState text={t('empty')} /> : groups.map(([cat, rows]) => (
        <BoardGroup key={cat} title={cat || t('uncategorised')} color="#579bfc" count={rows.length}>
          <Table className="board-table">
            <TableHeader>
              <TableRow>
                <TableHead className="text-left">{t('field.title')}</TableHead><TableHead>{t('field.priority')}</TableHead><TableHead>{t('field.status')}</TableHead>
                <TableHead>{t('field.effort')}</TableHead>{perm.internal && <TableHead>{t('field.tasks')}</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const c = progress.get(r.id);
                return (
                  <TableRow key={r.id} className={canEdit ? 'cursor-pointer' : undefined} onClick={canEdit ? () => setEditing(r) : undefined}>
                    <TableCell className="min-w-64 whitespace-normal">{r.title}<span className="ml-1 text-xs text-muted-foreground/70">{r.req_no}</span></TableCell>
                    <TableCell className="p-1"><StatusChip list={REQ_PRIORITIES} value={r.priority} fullWidth /></TableCell>
                    <TableCell className="p-1"><StatusChip list={REQ_STATUSES} value={r.status} fullWidth /></TableCell>
                    <TableCell className="text-center">{r.estimated_md == null ? '–' : t('md', { n: r.estimated_md })}</TableCell>
                    {perm.internal && <TableCell className="text-center text-xs">{c ? t('tasksDone', c) : <span className="text-muted-foreground">{t('noTasks')}</span>}</TableCell>}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </BoardGroup>
      ))}

      {editing && <RequirementDialog key={editing === 'new' ? 'new' : editing.id} req={editing === 'new' ? null : editing} projectId={p.id} reload={reload} onClose={() => setEditing(null)} />}
      {converting && <ConvertDialog data={data} reqs={convertable} people={memberProfiles} reload={reload} onClose={() => setConverting(false)} />}
    </div>
  );
}

function RequirementDialog({ req, projectId, reload, onClose }: { req: ProjectRequirement | null; projectId: number; reload: () => Promise<void>; onClose: () => void }) {
  const t = useTranslations('project.requirements');
  const { notify } = useApp();
  const { options } = useOptions();
  const [f, setF] = useState({
    title: req?.title ?? '', description: req?.description ?? '', category: req?.category ?? '', priority: req?.priority ?? 'should',
    acceptance: req?.acceptance_criteria ?? '', md: req?.estimated_md?.toString() ?? '', status: req?.status ?? 'draft',
  });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (v: string) => setF({ ...f, [k]: v });
  const run = async (fn: () => Promise<void>, msg: string) => {
    setBusy(true);
    try {
      await fn();
      notify(msg);
      await reload();
      onClose();
    } catch (e) {
      notify(errMsg(e), 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{req ? `${t('edit')} · ${req.req_no}` : t('new')}</DialogTitle>
          <DialogDescription className="sr-only">{t('intro')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <TextField label={t('field.title')} required value={f.title} onChange={set('title')} />
          <div className="grid grid-cols-2 gap-3">
            <TextField label={t('field.category')} value={f.category} onChange={set('category')} placeholder={t('categoryPlaceholder')} />
            <TextField label={t('field.effort')} type="number" value={f.md} onChange={set('md')} />
            <SelectField label={t('field.priority')} value={f.priority} onChange={set('priority')} options={options(REQ_PRIORITIES)} />
            <SelectField label={t('field.status')} value={f.status} onChange={set('status')} options={options(REQ_STATUSES)} />
          </div>
          <TextField label={t('field.description')} multiline rows={3} value={f.description} onChange={set('description')} placeholder={t('descriptionPlaceholder')} />
          <TextField label={t('field.acceptance')} multiline rows={3} value={f.acceptance} onChange={set('acceptance')} placeholder={t('acceptancePlaceholder')} />
        </div>
        <DialogFooter className="sm:justify-between">
          {req ? (
            <Button variant="outline" className="text-destructive" disabled={busy} onClick={() => {
              if (window.confirm(t('confirmDelete', { no: req.req_no }))) void run(() => rpc('delete_requirement', { p_id: req.id }), t('deleted'));
            }}><Trash2 /> {t('delete')}</Button>
          ) : <span />}
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>{t('cancel')}</Button>
            <Button disabled={busy || !f.title.trim()} onClick={() => run(() => rpc('save_requirement', {
              p_project_id: projectId, p_id: req?.id, p_title: f.title, p_description: f.description, p_category: f.category,
              p_priority: f.priority, p_acceptance_criteria: f.acceptance, p_estimated_md: f.md, p_status: f.status,
            }), t('saved'))}>{t('save')}</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Preview of the tasks that will be created; nothing is written until "Create" */
function ConvertDialog({ data, reqs, people, reload, onClose }: Pick<TabProps, 'data' | 'reload'> & { reqs: ProjectRequirement[]; people: TabProps['memberProfiles']; onClose: () => void }) {
  const t = useTranslations('project.requirements');
  const { me, notify } = useApp();
  const [picked, setPicked] = useState<number[]>(reqs.map((r) => r.id));
  const [activity, setActivity] = useState(data.activities.length === 1 ? String(data.activities[0].id) : '');
  const [owner, setOwner] = useState<number | null>(me?.id ?? null);
  const [due, setDue] = useState(data.project.target_date ?? '');
  const [busy, setBusy] = useState(false);
  const toggle = (id: number) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t('convertTitle')}</DialogTitle>
          <DialogDescription>{t('convertDescription')}</DialogDescription>
        </DialogHeader>
        {data.activities.length === 0 ? <p className="text-sm text-muted-foreground">{t('needActivity')}</p> : (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <SelectField label={t('activity')} required value={activity} onChange={setActivity} options={data.activities.map((a) => ({ value: String(a.id), label: a.name }))} className="col-span-2" />
              <UserSelect label={t('owner')} required value={owner} onChange={setOwner} users={people} />
              <DateField label={t('due')} required value={due} onChange={setDue} />
            </div>
            <div>
              <div className="mb-1 text-xs font-medium text-muted-foreground">{t('preview')}</div>
              <ul className="max-h-60 space-y-1 overflow-y-auto rounded border border-grid p-2 text-sm">
                {reqs.map((r) => (
                  <li key={r.id}>
                    <label className="flex cursor-pointer items-center gap-2">
                      <input type="checkbox" checked={picked.includes(r.id)} onChange={() => toggle(r.id)} />
                      <span>{r.req_no} {r.title}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('cancel')}</Button>
          <Button disabled={busy || !picked.length || !activity || !owner || !due} onClick={async () => {
            setBusy(true);
            try {
              const { data: res, error } = await dbClient().rpc('convert_requirements_to_tasks', {
                p_project_id: data.project.id, p_requirement_ids: picked, p_activity_id: Number(activity), p_owner_id: owner, p_due_date: due,
              });
              if (error) throw new Error(errMsg(error));
              dispatchEmails();
              const r = res as { created: number; skipped: number };
              notify(r.skipped ? t('createdSkipped', r) : t('created', { n: r.created }));
              await reload();
              onClose();
            } catch (e) {
              notify(errMsg(e), 'error');
            } finally {
              setBusy(false);
            }
          }}>{t('confirm', { n: picked.length })}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
