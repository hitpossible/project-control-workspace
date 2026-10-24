'use client';

import { ChevronRight, TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useOptions } from '@/i18n/useOptions';
import { ACTIVITY_STATUSES, DELAY_CATEGORIES, PRIORITIES, TASK_STATUSES, TASK_TYPES } from '@/lib/constants';
import { errMsg, fmtDateTime, isOverdue, nullify } from '@/lib/format';
import { dbClient } from '@/lib/db/client';
import type { Activity, InternalTask, Profile, Project, TaskDependency } from '@/lib/types';
import { cn } from '@/lib/utils';
import AuditHistory from './AuditHistory';
import CommentThread from './CommentThread';
import { dispatchEmails, useApp } from './AppProvider';
import { DateField, FormField, MultiSelect, SelectField, TextField, UserSelect } from './common';
import { EntityEvidence } from './EvidenceChecklist';
import { Alert, AlertDescription } from './ui/alert';
import { Button } from './ui/button';
import { Checkbox } from './ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';
import { Slider } from './ui/slider';
import { Tabs, TabsList, TabsTrigger } from './ui/tabs';
import { confirmDialog } from '@/components/ConfirmDialog';

/** tabs: [value, label] — values are fixed keys ('comments' is opened from notification links) */
function DialogTabs({ value, onChange, tabs }: { value: string; onChange: (v: string) => void; tabs: [string, string][] }) {
  return (
    <Tabs value={value} onValueChange={onChange}>
      <TabsList variant="line" className="w-full justify-start border-b border-grid">
        {tabs.map(([v, l]) => <TabsTrigger key={v} value={v}>{l}</TabsTrigger>)}
      </TabsList>
    </Tabs>
  );
}

function ProgressField({ label, value, onChange, disabled }: { label: string; value: number; onChange: (v: number) => void; disabled?: boolean }) {
  return (
    <FormField label={`${label} ${Math.round(value)}%`}>
      <Slider className="mt-2.5" value={[value]} max={100} step={5} disabled={disabled} onValueChange={(v) => onChange(v[0])} />
    </FormField>
  );
}

const Grid = ({ children }: { children: React.ReactNode }) => <div className="grid grid-cols-12 gap-3">{children}</div>;
const col = (n: string) => cn('col-span-12', n);

/** collapsible block in a dialog: title + one-line summary when closed */
function Section({ title, summary, open, onToggle, danger, children }: {
  title: string; summary: React.ReactNode; open: boolean; onToggle: () => void; danger?: boolean; children: React.ReactNode;
}) {
  return (
    <section>
      <button type="button" onClick={onToggle} aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left hover:bg-muted/40">
        <ChevronRight className={cn('size-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')} />
        <span className={cn('text-sm font-semibold', danger && 'text-destructive')}>{title}</span>
        {!open && <span className={cn('min-w-0 truncate text-xs', danger ? 'text-destructive' : 'text-muted-foreground')}>{summary}</span>}
      </button>
      {open && <div className="px-3 pt-1 pb-3">{children}</div>}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Activity (User Control Plan)
// ---------------------------------------------------------------------------
export function ActivityDialog({ project, activity, hasTasks, canManage, canViewInternal, members, onClose, onSaved }: {
  project: Project; activity: Activity | null; hasTasks: boolean; canManage: boolean; canViewInternal: boolean;
  members: Profile[]; onClose: () => void; onSaved: () => void;
}) {
  const t = useTranslations('plan');
  const tc = useTranslations('common');
  const { options } = useOptions();
  const db = dbClient();
  const { me, profileName, notify } = useApp();
  const [tab, setTab] = useState('details');
  const [f, setF] = useState<Partial<Activity>>(activity ?? { name: '', pic_label: 'System', progress: 0, status: 'not_started', is_milestone: false });
  const set = <K extends keyof Activity>(k: K, v: Activity[K] | null) => setF((p) => ({ ...p, [k]: v }));
  const isPic = activity?.pic_user_id === me?.id;
  const editable = canManage || isPic;
  const overdue = isOverdue(f.plan_finish, f.status ?? '');
  const needRecovery = f.status === 'delayed' || overdue;
  const { hasRole } = useApp();
  const canReview = hasRole('supervisor', 'manager');

  const reviewRecovery = async () => {
    if (!activity) return;
    const { error } = await db.rpc('review_recovery_plan', { p_activity_id: activity.id });
    if (error) return notify(errMsg(error), 'error');
    notify(t('activity.reviewed'));
    onSaved();
  };

  const save = async () => {
    if (!f.name?.trim()) return notify(t('activity.nameRequired'), 'warning');
    if (needRecovery && (!f.delay_category || !f.delay_reason?.trim() || !f.recovery_plan?.trim())) {
      setTab('details');
      return notify(t('activity.recoveryRequired'), 'warning');
    }
    const payload = nullify({
      name: f.name, seq: f.seq ?? 0, pic_user_id: f.pic_user_id ?? null, pic_label: f.pic_label ?? null,
      plan_start: f.plan_start ?? null, plan_finish: f.plan_finish ?? null, actual_start: f.actual_start ?? null,
      actual_finish: f.actual_finish ?? null, forecast_finish: f.forecast_finish ?? null,
      progress: f.progress ?? 0, status: f.status, status_note: f.status_note ?? null, remark: f.remark ?? null,
      next_action: f.next_action ?? null, delay_category: f.delay_category ?? null, delay_reason: f.delay_reason ?? null,
      recovery_plan: f.recovery_plan ?? null, is_milestone: !!f.is_milestone,
      delay_impact: f.delay_impact ?? null, recovery_owner_id: f.recovery_owner_id ?? null, recovery_due_date: f.recovery_due_date ?? null,
    });
    const res = activity
      ? await db.from('activities').update(payload).eq('id', activity.id)
      : await db.from('activities').insert({ ...payload, project_id: project.id });
    if (res.error) return notify(errMsg(res.error), 'error');
    notify(activity ? t('activity.updated') : t('activity.added'));
    dispatchEmails();
    onSaved();
  };

  const remove = async () => {
    if (!activity || !(await confirmDialog({ title: t('activity.deleteTitle', { name: activity.name }), description: t('activity.deleteText'), confirmText: tc('delete'), destructive: true }))) return;
    const { error } = await db.from('activities').delete().eq('id', activity.id);
    if (error) return notify(errMsg(error), 'error');
    notify(t('activity.deleted'));
    onSaved();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] gap-3 overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="font-heading text-lg">{activity ? activity.name : t('activity.new')}</DialogTitle>
          <DialogDescription>
            {t('activity.context')} · {project.project_code}{activity && ` · ${t('updatedBy', { at: fmtDateTime(activity.updated_at), name: profileName(activity.updated_by) })}`}
          </DialogDescription>
        </DialogHeader>
        {activity && <DialogTabs value={tab} onChange={setTab} tabs={[['details', t('tab.details')], ['evidence', t('tab.evidence')], ...(canViewInternal ? [['history', t('tab.history')] as [string, string]] : [])]} />}

        {tab === 'details' && (
          <Grid>
            {overdue && <Alert variant="destructive" className="col-span-12"><TriangleAlert /><AlertDescription>{t('activity.overdue')}</AlertDescription></Alert>}
            <TextField className={col('sm:col-span-9')} label={t('field.activity')} required value={f.name} onChange={(v) => set('name', v)} disabled={!canManage} />
            <TextField className={col('sm:col-span-3')} label={t('field.seq')} type="number" value={f.seq ?? 0} onChange={(v) => set('seq', Number(v))} disabled={!canManage} />
            <UserSelect className={col('sm:col-span-6')} label={t('field.picPerson')} value={f.pic_user_id} onChange={(v) => set('pic_user_id', v)} users={members} disabled={!canManage} />
            <TextField className={col('sm:col-span-6')} label={t('field.picLabel')} value={f.pic_label} onChange={(v) => set('pic_label', v)} disabled={!canManage} />
            <DateField className={col('col-span-6 sm:col-span-3')} label={t('field.planStart')} value={f.plan_start} onChange={(v) => set('plan_start', v)} disabled={!canManage} />
            <DateField className={col('col-span-6 sm:col-span-3')} label={t('field.planFinish')} value={f.plan_finish} onChange={(v) => set('plan_finish', v)} disabled={!canManage} />
            <DateField className={col('col-span-6 sm:col-span-3')} label={t('field.actualStart')} value={f.actual_start} onChange={(v) => set('actual_start', v)} disabled={!editable} />
            <DateField className={col('col-span-6 sm:col-span-3')} label={t('field.actualFinish')} value={f.actual_finish} onChange={(v) => set('actual_finish', v)} disabled={!editable} />
            <SelectField className={col('sm:col-span-6')} label={t('field.status')} value={f.status} onChange={(v) => set('status', v)} options={options(ACTIVITY_STATUSES)} disabled={!editable} />
            <div className={col('sm:col-span-6')}>
              <ProgressField label={hasTasks ? t('field.progressFromTasks') : t('field.progress')} value={Number(f.progress ?? 0)} onChange={(v) => set('progress', v)} disabled={!editable || hasTasks} />
            </div>
            <TextField className="col-span-12" label={t('field.statusNote')} value={f.status_note} onChange={(v) => set('status_note', v)} disabled={!editable} />
            <TextField className={col('sm:col-span-6')} label={t('field.nextAction')} value={f.next_action} onChange={(v) => set('next_action', v)} disabled={!editable} />
            <TextField className={col('sm:col-span-6')} label={t('field.remark')} value={f.remark} onChange={(v) => set('remark', v)} disabled={!editable} />
            <label className="col-span-12 flex items-center gap-2 text-sm">
              <Checkbox checked={!!f.is_milestone} onCheckedChange={(c) => set('is_milestone', !!c)} disabled={!canManage} /> {t('field.milestone')}
            </label>
            <h4 className={cn('col-span-12 text-sm font-semibold', needRecovery ? 'text-destructive' : 'text-muted-foreground')}>{t('activity.delaySection')}</h4>
            <SelectField className={col('sm:col-span-6')} label={t('field.delayCategory')} allowEmpty value={f.delay_category} onChange={(v) => set('delay_category', v)} options={options(DELAY_CATEGORIES)} disabled={!editable} required={needRecovery} />
            <DateField className={col('sm:col-span-6')} label={t('field.forecastFinish')} value={f.forecast_finish} onChange={(v) => set('forecast_finish', v)} disabled={!editable} />
            <TextField className="col-span-12" label={t('field.delayReason')} multiline rows={2} value={f.delay_reason} onChange={(v) => set('delay_reason', v)} disabled={!editable} required={needRecovery} />
            <TextField className="col-span-12" label={t('field.impact')} value={f.delay_impact} onChange={(v) => set('delay_impact', v)} disabled={!editable} placeholder={t('field.impactPlaceholder')} />
            <TextField className="col-span-12" label={t('field.recoveryPlan')} multiline rows={2} value={f.recovery_plan} onChange={(v) => set('recovery_plan', v)} disabled={!editable} required={needRecovery} />
            <UserSelect className={col('sm:col-span-6')} label={t('field.recoveryOwner')} value={f.recovery_owner_id} onChange={(v) => set('recovery_owner_id', v)} users={members} disabled={!editable} />
            <DateField className={col('sm:col-span-6')} label={t('field.recoveryDue')} value={f.recovery_due_date} onChange={(v) => set('recovery_due_date', v)} disabled={!editable} />
            {activity?.recovery_plan && (
              <div className="col-span-12 flex items-center gap-2 rounded-md bg-muted px-3 py-2 text-sm">
                {activity.recovery_reviewed_by
                  ? <span className="text-[#00854d]">✓ {t('activity.reviewedBy', { name: profileName(activity.recovery_reviewed_by), at: fmtDateTime(activity.recovery_reviewed_at) })}</span>
                  : <span className="text-muted-foreground">{t('activity.notReviewed')}</span>}
                {canReview && !activity.recovery_reviewed_by && (
                  <Button size="sm" className="ml-auto" onClick={reviewRecovery}>{t('activity.markReviewed')}</Button>
                )}
              </div>
            )}
          </Grid>
        )}
        {tab === 'evidence' && activity && (
          <EntityEvidence projectId={project.id} entityType="activity" entityId={activity.id} canAdd={canViewInternal} canManage={canManage} allowPublicToggle />
        )}
        {tab === 'history' && activity && <AuditHistory entity={{ table: 'activities', id: activity.id }} />}

        <DialogFooter className="sm:justify-between">
          {activity && canManage ? <Button variant="destructive" onClick={remove}>{tc('delete')}</Button> : <span />}
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>{tc('close')}</Button>
            {editable && tab === 'details' && <Button onClick={save}>{tc('save')}</Button>}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Internal Task / Sub-task
// ---------------------------------------------------------------------------
export function TaskDialog({ project, task, defaults, activities, tasks, deps, canManage, members, onClose, onSaved, initialTab }: {
  project: Project; task: InternalTask | null; defaults?: Partial<InternalTask>; initialTab?: string;
  activities: Activity[]; tasks: InternalTask[]; deps: TaskDependency[];
  canManage: boolean; members: Profile[]; onClose: () => void; onSaved: () => void;
}) {
  const t = useTranslations('plan');
  const tc = useTranslations('common');
  const { options, text: enumText } = useOptions();
  const db = dbClient();
  const { me, profileName, notify } = useApp();
  const [tab, setTab] = useState(initialTab ?? 'details');
  const [f, setF] = useState<Partial<InternalTask>>(task ?? { name: '', task_type: 'dev', priority: 'medium', status: 'todo', progress: 0, owner_id: me?.id, ...defaults });
  // MultiSelect works with string values
  const [preds, setPreds] = useState<string[]>(task ? deps.filter((d) => d.successor_id === task.id).map((d) => String(d.predecessor_id)) : []);
  const set = <K extends keyof InternalTask>(k: K, v: InternalTask[K] | null) => setF((p) => ({ ...p, [k]: v }));
  // folded sections start open when creating a task or when they already hold something
  const [open, setOpen] = useState({
    structure: !task,
    notes: !!(task?.technical_note?.trim() || task?.internal_comment?.trim()),
    delay: !!(task?.delay_category || task?.delay_reason?.trim() || task?.recovery_action?.trim()),
  });
  const toggle = (k: keyof typeof open) => setOpen((o) => ({ ...o, [k]: !o[k] }));
  const editable = !task || canManage || [task.owner_id, task.reviewer_id, task.created_by].includes(me?.id ?? -1);
  const hasChildren = !!task && tasks.some((x) => x.parent_task_id === task.id);
  const overdue = isOverdue(f.due_date, f.status ?? '');
  const parentOptions = tasks.filter((x) => !x.parent_task_id && x.id !== task?.id && x.activity_id === f.activity_id);
  const predOptions = tasks.filter((x) => x.id !== task?.id).map((x) => ({ value: String(x.id), label: `${x.task_no} ${x.name}` }));

  const save = async () => {
    if (!f.name?.trim() || !f.owner_id || !f.due_date || !f.activity_id) {
      if (!f.activity_id) setOpen((o) => ({ ...o, structure: true }));
      return notify(t('task.required'), 'warning');
    }
    if (overdue && (!f.delay_reason?.trim() || !f.recovery_action?.trim())) {
      return notify(t('task.overdueRequired'), 'warning');
    }
    const payload = nullify({
      name: f.name, activity_id: f.activity_id, parent_task_id: f.parent_task_id ?? null, seq: f.seq ?? 0,
      task_type: f.task_type, owner_id: f.owner_id, reviewer_id: f.reviewer_id ?? null, priority: f.priority,
      planned_start: f.planned_start ?? null, due_date: f.due_date, actual_start: f.actual_start ?? null,
      actual_finish: f.actual_finish ?? null, progress: f.progress ?? 0, status: f.status,
      description: f.description ?? null, technical_note: f.technical_note ?? null, internal_comment: f.internal_comment ?? null,
      delay_category: f.delay_category ?? null, delay_reason: f.delay_reason ?? null, recovery_action: f.recovery_action ?? null,
    });
    const res = task
      ? await db.from('internal_tasks').update(payload).eq('id', task.id).select().single()
      : await db.from('internal_tasks').insert({ ...payload, project_id: project.id }).select().single();
    if (res.error) return notify(errMsg(res.error), 'error');
    const id = res.data.id as number;

    if (canManage) {
      const current = deps.filter((d) => d.successor_id === id).map((d) => d.predecessor_id);
      const picked = preds.map(Number);
      const add = picked.filter((p) => !current.includes(p));
      const del = current.filter((p) => !picked.includes(p));
      if (del.length) await db.from('task_dependencies').delete().eq('successor_id', id).in('predecessor_id', del);
      if (add.length) {
        const r = await db.from('task_dependencies').insert(add.map((p) => ({ project_id: project.id, predecessor_id: p, successor_id: id, dep_type: 'FS' })));
        if (r.error) notify(errMsg(r.error), 'error');
      }
    }
    notify(task ? t('task.updated') : t('task.created'));
    dispatchEmails();
    onSaved();
  };

  const remove = async () => {
    if (!task || !(await confirmDialog({ title: t('task.deleteTitle', { no: task.task_no ?? '' }), description: t('task.deleteText', { name: task.name }), confirmText: tc('delete'), destructive: true }))) return;
    const { error } = await db.from('internal_tasks').delete().eq('id', task.id);
    if (error) return notify(errMsg(error), 'error');
    notify(t('task.deleted'));
    onSaved();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] gap-3 overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="font-heading text-lg">{task ? `${task.task_no} — ${task.name}` : f.parent_task_id ? t('task.newSub') : t('task.new')}</DialogTitle>
          <DialogDescription>
            {t('task.context')} · {project.project_code}{task && ` · ${t('updatedBy', { at: fmtDateTime(task.updated_at), name: profileName(task.updated_by) })}`}
          </DialogDescription>
        </DialogHeader>
        {task && <DialogTabs value={tab} onChange={setTab} tabs={[['details', t('tab.details')], ['comments', t('tab.comments')], ['evidence', t('tab.evidence')], ['history', t('tab.history')]]} />}

        {tab === 'details' && (
          <div className="space-y-3">
            {overdue && <Alert variant="destructive"><TriangleAlert /><AlertDescription>{t('task.overdue')}</AlertDescription></Alert>}

            {/* the fields people touch every day */}
            <Grid>
              <TextField className={col('sm:col-span-8')} label={t('field.taskName')} required value={f.name} onChange={(v) => set('name', v)} disabled={!editable} />
              <SelectField className={col('col-span-6 sm:col-span-2')} label={t('field.type')} value={f.task_type} onChange={(v) => set('task_type', v)} options={options(TASK_TYPES)} disabled={!editable} />
              <SelectField className={col('col-span-6 sm:col-span-2')} label={t('field.priority')} value={f.priority} onChange={(v) => set('priority', v)} options={options(PRIORITIES)} disabled={!editable} />
            </Grid>
            <div className="grid grid-cols-12 gap-3 rounded-lg bg-muted/50 p-3">
              <SelectField className={col('sm:col-span-5')} label={t('field.status')} value={f.status} onChange={(v) => set('status', v)} options={options(TASK_STATUSES)} disabled={!editable} />
              <div className={col('sm:col-span-7')}>
                <ProgressField label={hasChildren ? t('field.progressFromSubtasks') : t('field.progress')} value={Number(f.progress ?? 0)} onChange={(v) => set('progress', v)} disabled={!editable || hasChildren} />
              </div>
            </div>
            <Grid>
              <UserSelect className={col('sm:col-span-6')} label={t('field.owner')} required value={f.owner_id} onChange={(v) => set('owner_id', v as number)} users={members} disabled={!canManage && !!task} />
              <UserSelect className={col('sm:col-span-6')} label={t('field.reviewer')} value={f.reviewer_id} onChange={(v) => set('reviewer_id', v)} users={members} disabled={!editable} />
              <DateField className={col('col-span-6 sm:col-span-3')} label={t('field.plannedStart')} value={f.planned_start} onChange={(v) => set('planned_start', v)} disabled={!editable} />
              <DateField className={col('col-span-6 sm:col-span-3')} label={t('field.dueDate')} required value={f.due_date} onChange={(v) => set('due_date', v)} disabled={!canManage && !!task} />
              <DateField className={col('col-span-6 sm:col-span-3')} label={t('field.actualStart')} value={f.actual_start} onChange={(v) => set('actual_start', v)} disabled={!editable} />
              <DateField className={col('col-span-6 sm:col-span-3')} label={t('field.actualFinish')} value={f.actual_finish} onChange={(v) => set('actual_finish', v)} disabled={!editable} />
              <TextField className="col-span-12" label={t('field.description')} multiline rows={2} value={f.description} onChange={(v) => set('description', v)} disabled={!editable} />
            </Grid>

            {/* less frequent — folded, with a one-line summary */}
            <div className="divide-y divide-grid rounded-lg border border-grid">
              <Section title={t('task.structure')} open={open.structure} onToggle={() => toggle('structure')}
                summary={[
                  activities.find((a) => a.id === f.activity_id)?.name ?? t('task.noActivity'),
                  f.parent_task_id ? t('task.subTaskOf', { no: tasks.find((x) => x.id === f.parent_task_id)?.task_no ?? '?' }) : null,
                  preds.length ? t('task.dependencies', { count: preds.length }) : t('task.noDependency'),
                ].filter(Boolean).join(' · ')}>
                <Grid>
                  <SelectField className={col('sm:col-span-6')} label={t('field.parentActivity')} required value={f.activity_id?.toString()}
                    onChange={(v) => setF((p) => ({ ...p, activity_id: Number(v), parent_task_id: null }))}
                    options={activities.map((a) => ({ value: String(a.id), label: a.name }))} disabled={!editable || !!task?.parent_task_id} />
                  <SelectField className={col('sm:col-span-6')} label={t('field.parentTask')} allowEmpty value={f.parent_task_id?.toString()} onChange={(v) => set('parent_task_id', v ? Number(v) : null)}
                    options={parentOptions.map((x) => ({ value: String(x.id), label: `${x.task_no} ${x.name}` }))} disabled={!editable || hasChildren} />
                  <MultiSelect className="col-span-12" label={t('field.dependsOn')} value={preds} onChange={setPreds} options={predOptions} disabled={!canManage} placeholder={t('task.noDependencyPlaceholder')} />
                </Grid>
              </Section>
              <Section title={t('task.notes')} open={open.notes} onToggle={() => toggle('notes')}
                summary={[f.technical_note?.trim() && t('task.technicalNote'), f.internal_comment?.trim() && t('task.internalComment')].filter(Boolean).join(' · ') || t('task.empty')}>
                <Grid>
                  <TextField className={col('sm:col-span-6')} label={t('field.technicalNote')} multiline value={f.technical_note} onChange={(v) => set('technical_note', v)} disabled={!editable} />
                  <TextField className={col('sm:col-span-6')} label={t('field.internalComment')} multiline value={f.internal_comment} onChange={(v) => set('internal_comment', v)} disabled={!editable} />
                </Grid>
              </Section>
              <Section title={t('task.delay')} open={open.delay || overdue} onToggle={() => !overdue && toggle('delay')} danger={overdue}
                summary={overdue ? t('task.delayRequired') : f.delay_category || f.delay_reason?.trim() ? [f.delay_category && enumText('delayCategory', f.delay_category), f.delay_reason].filter(Boolean).join(' · ') : t('task.notDelayed')}>
                <Grid>
                  <SelectField className={col('sm:col-span-4')} label={t('field.delayCategory')} allowEmpty value={f.delay_category} onChange={(v) => set('delay_category', v)} options={options(DELAY_CATEGORIES)} disabled={!editable} />
                  <TextField className={col('sm:col-span-8')} label={t('field.delayReason')} value={f.delay_reason} onChange={(v) => set('delay_reason', v)} disabled={!editable} required={overdue} />
                  <TextField className="col-span-12" label={t('field.recoveryAction')} value={f.recovery_action} onChange={(v) => set('recovery_action', v)} disabled={!editable} required={overdue} />
                </Grid>
              </Section>
            </div>
          </div>
        )}
        {tab === 'evidence' && task && <EntityEvidence projectId={project.id} entityType="task" entityId={task.id} canAdd canManage={canManage} />}
        {tab === 'comments' && task && <CommentThread projectId={project.id} entityType="task" entityId={task.id} canModerate={canManage} />}
        {tab === 'history' && task && <AuditHistory entity={{ table: 'internal_tasks', id: task.id }} />}

        <DialogFooter className="sm:justify-between">
          {task && (canManage || (task.created_by === me?.id && task.status === 'todo')) ? <Button variant="destructive" onClick={remove}>{tc('delete')}</Button> : <span />}
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>{tc('close')}</Button>
            {editable && tab === 'details' && <Button onClick={save}>{tc('save')}</Button>}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
