'use client';

import { TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { ACTIVITY_STATUSES, DELAY_CATEGORIES, PRIORITIES, TASK_STATUSES, TASK_TYPES } from '@/lib/constants';
import { errMsg, fmtDateTime, isOverdue, nullify } from '@/lib/format';
import { supabaseBrowser } from '@/lib/supabase/client';
import type { Activity, InternalTask, Profile, Project, TaskDependency } from '@/lib/types';
import { cn } from '@/lib/utils';
import AuditHistory from './AuditHistory';
import { dispatchEmails, useApp } from './AppProvider';
import { DateField, FormField, MultiSelect, SelectField, TextField, UserSelect } from './common';
import { EntityEvidence } from './EvidenceChecklist';
import { Alert, AlertDescription } from './ui/alert';
import { Button } from './ui/button';
import { Checkbox } from './ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';
import { Slider } from './ui/slider';
import { Tabs, TabsList, TabsTrigger } from './ui/tabs';

const delayOpts = DELAY_CATEGORIES.map((c) => ({ value: c, label: c }));

function DialogTabs({ value, onChange, tabs }: { value: string; onChange: (v: string) => void; tabs: string[] }) {
  return (
    <Tabs value={value} onValueChange={onChange}>
      <TabsList variant="line" className="w-full justify-start border-b border-grid">
        {tabs.map((t) => <TabsTrigger key={t} value={t}>{t}</TabsTrigger>)}
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

// ---------------------------------------------------------------------------
// Activity (User Control Plan)
// ---------------------------------------------------------------------------
export function ActivityDialog({ project, activity, hasTasks, canManage, canViewInternal, members, onClose, onSaved }: {
  project: Project; activity: Activity | null; hasTasks: boolean; canManage: boolean; canViewInternal: boolean;
  members: Profile[]; onClose: () => void; onSaved: () => void;
}) {
  const supabase = supabaseBrowser();
  const { me, profileName, notify } = useApp();
  const [tab, setTab] = useState('Details');
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
    const { error } = await supabase.rpc('review_recovery_plan', { p_activity_id: activity.id });
    if (error) return notify(errMsg(error), 'error');
    notify('Recovery plan marked as reviewed');
    onSaved();
  };

  const save = async () => {
    if (!f.name?.trim()) return notify('Activity name is required', 'warning');
    if (needRecovery && (!f.delay_category || !f.delay_reason?.trim() || !f.recovery_plan?.trim())) {
      setTab('Details');
      return notify('Delayed / overdue activity requires Delay Category, Delay Reason and Recovery Plan', 'warning');
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
      ? await supabase.from('activities').update(payload).eq('id', activity.id)
      : await supabase.from('activities').insert({ ...payload, project_id: project.id });
    if (res.error) return notify(errMsg(res.error), 'error');
    notify(activity ? 'Activity updated' : 'Activity added');
    dispatchEmails();
    onSaved();
  };

  const remove = async () => {
    if (!activity || !confirm(`Delete activity "${activity.name}" and all its internal tasks?`)) return;
    const { error } = await supabase.from('activities').delete().eq('id', activity.id);
    if (error) return notify(errMsg(error), 'error');
    notify('Activity deleted');
    onSaved();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] gap-3 overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="font-heading text-lg">{activity ? activity.name : 'New Activity'}</DialogTitle>
          <DialogDescription>
            User Control Plan · {project.project_code}{activity && ` · updated ${fmtDateTime(activity.updated_at)} by ${profileName(activity.updated_by)}`}
          </DialogDescription>
        </DialogHeader>
        {activity && <DialogTabs value={tab} onChange={setTab} tabs={canViewInternal ? ['Details', 'Evidence', 'History'] : ['Details', 'Evidence']} />}

        {tab === 'Details' && (
          <Grid>
            {overdue && <Alert variant="destructive" className="col-span-12"><TriangleAlert /><AlertDescription>This activity is overdue. Provide Delay Reason and Recovery Plan.</AlertDescription></Alert>}
            <TextField className={col('sm:col-span-9')} label="Activity" required value={f.name} onChange={(v) => set('name', v)} disabled={!canManage} />
            <TextField className={col('sm:col-span-3')} label="Seq" type="number" value={f.seq ?? 0} onChange={(v) => set('seq', Number(v))} disabled={!canManage} />
            <UserSelect className={col('sm:col-span-6')} label="PIC (person)" value={f.pic_user_id} onChange={(v) => set('pic_user_id', v)} users={members} disabled={!canManage} />
            <TextField className={col('sm:col-span-6')} label="PIC label (System / User / Vendor)" value={f.pic_label} onChange={(v) => set('pic_label', v)} disabled={!canManage} />
            <DateField className={col('col-span-6 sm:col-span-3')} label="Plan Start" value={f.plan_start} onChange={(v) => set('plan_start', v)} disabled={!canManage} />
            <DateField className={col('col-span-6 sm:col-span-3')} label="Plan Finish" value={f.plan_finish} onChange={(v) => set('plan_finish', v)} disabled={!canManage} />
            <DateField className={col('col-span-6 sm:col-span-3')} label="Actual Start" value={f.actual_start} onChange={(v) => set('actual_start', v)} disabled={!editable} />
            <DateField className={col('col-span-6 sm:col-span-3')} label="Actual Finish" value={f.actual_finish} onChange={(v) => set('actual_finish', v)} disabled={!editable} />
            <SelectField className={col('sm:col-span-6')} label="Status" value={f.status} onChange={(v) => set('status', v)} options={ACTIVITY_STATUSES} disabled={!editable} />
            <div className={col('sm:col-span-6')}>
              <ProgressField label={`Progress${hasTasks ? ' (from internal tasks)' : ''}`} value={Number(f.progress ?? 0)} onChange={(v) => set('progress', v)} disabled={!editable || hasTasks} />
            </div>
            <TextField className="col-span-12" label="Status Note" value={f.status_note} onChange={(v) => set('status_note', v)} disabled={!editable} />
            <TextField className={col('sm:col-span-6')} label="Next Action" value={f.next_action} onChange={(v) => set('next_action', v)} disabled={!editable} />
            <TextField className={col('sm:col-span-6')} label="Remark" value={f.remark} onChange={(v) => set('remark', v)} disabled={!editable} />
            <label className="col-span-12 flex items-center gap-2 text-sm">
              <Checkbox checked={!!f.is_milestone} onCheckedChange={(c) => set('is_milestone', !!c)} disabled={!canManage} /> Milestone
            </label>
            <h4 className={cn('col-span-12 text-sm font-semibold', needRecovery ? 'text-destructive' : 'text-muted-foreground')}>Delay / Recovery Plan</h4>
            <SelectField className={col('sm:col-span-6')} label="Delay Category" allowEmpty value={f.delay_category} onChange={(v) => set('delay_category', v)} options={delayOpts} disabled={!editable} required={needRecovery} />
            <DateField className={col('sm:col-span-6')} label="Revised Forecast Finish" value={f.forecast_finish} onChange={(v) => set('forecast_finish', v)} disabled={!editable} />
            <TextField className="col-span-12" label="Delay Reason" multiline rows={2} value={f.delay_reason} onChange={(v) => set('delay_reason', v)} disabled={!editable} required={needRecovery} />
            <TextField className="col-span-12" label="Impact" value={f.delay_impact} onChange={(v) => set('delay_impact', v)} disabled={!editable} placeholder="Impact on milestone / target date / user" />
            <TextField className="col-span-12" label="Recovery Plan" multiline rows={2} value={f.recovery_plan} onChange={(v) => set('recovery_plan', v)} disabled={!editable} required={needRecovery} />
            <UserSelect className={col('sm:col-span-6')} label="Recovery Owner" value={f.recovery_owner_id} onChange={(v) => set('recovery_owner_id', v)} users={members} disabled={!editable} />
            <DateField className={col('sm:col-span-6')} label="Recovery Due Date" value={f.recovery_due_date} onChange={(v) => set('recovery_due_date', v)} disabled={!editable} />
            {activity?.recovery_plan && (
              <div className="col-span-12 flex items-center gap-2 rounded-md bg-muted px-3 py-2 text-sm">
                {activity.recovery_reviewed_by
                  ? <span className="text-[#00854d]">✓ Recovery plan reviewed by {profileName(activity.recovery_reviewed_by)} · {fmtDateTime(activity.recovery_reviewed_at)}</span>
                  : <span className="text-muted-foreground">Recovery plan not yet reviewed by Supervisor / Manager</span>}
                {canReview && !activity.recovery_reviewed_by && (
                  <Button size="sm" className="ml-auto" onClick={reviewRecovery}>Mark Reviewed</Button>
                )}
              </div>
            )}
          </Grid>
        )}
        {tab === 'Evidence' && activity && (
          <EntityEvidence projectId={project.id} entityType="activity" entityId={activity.id} canAdd={canViewInternal} canManage={canManage} allowPublicToggle />
        )}
        {tab === 'History' && activity && <AuditHistory entityId={activity.id} />}

        <DialogFooter className="sm:justify-between">
          {activity && canManage ? <Button variant="destructive" onClick={remove}>Delete</Button> : <span />}
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>Close</Button>
            {editable && tab === 'Details' && <Button onClick={save}>Save</Button>}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Internal Task / Sub-task
// ---------------------------------------------------------------------------
export function TaskDialog({ project, task, defaults, activities, tasks, deps, canManage, members, onClose, onSaved }: {
  project: Project; task: InternalTask | null; defaults?: Partial<InternalTask>;
  activities: Activity[]; tasks: InternalTask[]; deps: TaskDependency[];
  canManage: boolean; members: Profile[]; onClose: () => void; onSaved: () => void;
}) {
  const supabase = supabaseBrowser();
  const { me, profileName, notify } = useApp();
  const [tab, setTab] = useState('Details');
  const [f, setF] = useState<Partial<InternalTask>>(task ?? { name: '', task_type: 'dev', priority: 'medium', status: 'todo', progress: 0, owner_id: me?.id, ...defaults });
  const [preds, setPreds] = useState<string[]>(task ? deps.filter((d) => d.successor_id === task.id).map((d) => d.predecessor_id) : []);
  const set = <K extends keyof InternalTask>(k: K, v: InternalTask[K] | null) => setF((p) => ({ ...p, [k]: v }));
  const editable = !task || canManage || [task.owner_id, task.reviewer_id, task.created_by].includes(me?.id ?? '');
  const hasChildren = !!task && tasks.some((t) => t.parent_task_id === task.id);
  const overdue = isOverdue(f.due_date, f.status ?? '');
  const parentOptions = tasks.filter((t) => !t.parent_task_id && t.id !== task?.id && t.activity_id === f.activity_id);
  const predOptions = tasks.filter((t) => t.id !== task?.id).map((t) => ({ value: t.id, label: `${t.task_no} ${t.name}` }));

  const save = async () => {
    if (!f.name?.trim() || !f.owner_id || !f.due_date || !f.activity_id) {
      return notify('Task name, Activity, Owner and Due Date are required', 'warning');
    }
    if (overdue && (!f.delay_reason?.trim() || !f.recovery_action?.trim())) {
      return notify('Overdue task requires Delay Reason and Recovery Action', 'warning');
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
      ? await supabase.from('internal_tasks').update(payload).eq('id', task.id).select().single()
      : await supabase.from('internal_tasks').insert({ ...payload, project_id: project.id }).select().single();
    if (res.error) return notify(errMsg(res.error), 'error');
    const id = res.data.id as string;

    if (canManage) {
      const current = deps.filter((d) => d.successor_id === id).map((d) => d.predecessor_id);
      const add = preds.filter((p) => !current.includes(p));
      const del = current.filter((p) => !preds.includes(p));
      if (del.length) await supabase.from('task_dependencies').delete().eq('successor_id', id).in('predecessor_id', del);
      if (add.length) {
        const r = await supabase.from('task_dependencies').insert(add.map((p) => ({ project_id: project.id, predecessor_id: p, successor_id: id, dep_type: 'FS' })));
        if (r.error) notify(errMsg(r.error), 'error');
      }
    }
    notify(task ? 'Task updated' : 'Task created');
    dispatchEmails();
    onSaved();
  };

  const remove = async () => {
    if (!task || !confirm(`Delete task ${task.task_no} "${task.name}"?`)) return;
    const { error } = await supabase.from('internal_tasks').delete().eq('id', task.id);
    if (error) return notify(errMsg(error), 'error');
    notify('Task deleted');
    onSaved();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] gap-3 overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="font-heading text-lg">{task ? `${task.task_no} — ${task.name}` : f.parent_task_id ? 'New Sub-task' : 'New Internal Task'}</DialogTitle>
          <DialogDescription>
            Internal Execution Plan · {project.project_code}{task && ` · updated ${fmtDateTime(task.updated_at)} by ${profileName(task.updated_by)}`}
          </DialogDescription>
        </DialogHeader>
        {task && <DialogTabs value={tab} onChange={setTab} tabs={['Details', 'Evidence', 'History']} />}

        {tab === 'Details' && (
          <Grid>
            {overdue && <Alert variant="destructive" className="col-span-12"><TriangleAlert /><AlertDescription>Task is overdue — record Delay Reason and Recovery Action.</AlertDescription></Alert>}
            <TextField className={col('sm:col-span-8')} label="Task Name" required value={f.name} onChange={(v) => set('name', v)} disabled={!editable} />
            <SelectField className={col('col-span-6 sm:col-span-2')} label="Type" value={f.task_type} onChange={(v) => set('task_type', v)} options={TASK_TYPES} disabled={!editable} />
            <SelectField className={col('col-span-6 sm:col-span-2')} label="Priority" value={f.priority} onChange={(v) => set('priority', v)} options={PRIORITIES} disabled={!editable} />
            <SelectField className={col('sm:col-span-6')} label="Parent Activity" required value={f.activity_id}
              onChange={(v) => setF((p) => ({ ...p, activity_id: v, parent_task_id: null }))}
              options={activities.map((a) => ({ value: a.id, label: a.name }))} disabled={!editable || !!task?.parent_task_id} />
            <SelectField className={col('sm:col-span-6')} label="Parent Task (for sub-task)" allowEmpty value={f.parent_task_id} onChange={(v) => set('parent_task_id', v || null)}
              options={parentOptions.map((t) => ({ value: t.id, label: `${t.task_no} ${t.name}` }))} disabled={!editable || hasChildren} />
            <UserSelect className={col('sm:col-span-6')} label="Owner" required value={f.owner_id} onChange={(v) => set('owner_id', v as string)} users={members} disabled={!canManage && !!task} />
            <UserSelect className={col('sm:col-span-6')} label="Reviewer" value={f.reviewer_id} onChange={(v) => set('reviewer_id', v)} users={members} disabled={!editable} />
            <DateField className={col('col-span-6 sm:col-span-3')} label="Planned Start" value={f.planned_start} onChange={(v) => set('planned_start', v)} disabled={!editable} />
            <DateField className={col('col-span-6 sm:col-span-3')} label="Due Date" required value={f.due_date} onChange={(v) => set('due_date', v)} disabled={!canManage && !!task} />
            <DateField className={col('col-span-6 sm:col-span-3')} label="Actual Start" value={f.actual_start} onChange={(v) => set('actual_start', v)} disabled={!editable} />
            <DateField className={col('col-span-6 sm:col-span-3')} label="Actual Finish" value={f.actual_finish} onChange={(v) => set('actual_finish', v)} disabled={!editable} />
            <SelectField className={col('sm:col-span-6')} label="Status" value={f.status} onChange={(v) => set('status', v)} options={TASK_STATUSES} disabled={!editable} />
            <div className={col('sm:col-span-6')}>
              <ProgressField label={`Progress${hasChildren ? ' (from sub-tasks)' : ''}`} value={Number(f.progress ?? 0)} onChange={(v) => set('progress', v)} disabled={!editable || hasChildren} />
            </div>
            <MultiSelect className="col-span-12" label="Depends on (finish-to-start)" value={preds} onChange={setPreds} options={predOptions} disabled={!canManage} placeholder="No dependency" />
            <TextField className="col-span-12" label="Description" multiline rows={2} value={f.description} onChange={(v) => set('description', v)} disabled={!editable} />
            <TextField className={col('sm:col-span-6')} label="Technical Note (internal)" multiline value={f.technical_note} onChange={(v) => set('technical_note', v)} disabled={!editable} />
            <TextField className={col('sm:col-span-6')} label="Internal Comment" multiline value={f.internal_comment} onChange={(v) => set('internal_comment', v)} disabled={!editable} />
            <h4 className={cn('col-span-12 text-sm font-semibold', overdue ? 'text-destructive' : 'text-muted-foreground')}>Delay / Recovery</h4>
            <SelectField className={col('sm:col-span-4')} label="Delay Category" allowEmpty value={f.delay_category} onChange={(v) => set('delay_category', v)} options={delayOpts} disabled={!editable} />
            <TextField className={col('sm:col-span-8')} label="Delay Reason" value={f.delay_reason} onChange={(v) => set('delay_reason', v)} disabled={!editable} required={overdue} />
            <TextField className="col-span-12" label="Recovery Action" value={f.recovery_action} onChange={(v) => set('recovery_action', v)} disabled={!editable} required={overdue} />
          </Grid>
        )}
        {tab === 'Evidence' && task && <EntityEvidence projectId={project.id} entityType="task" entityId={task.id} canAdd canManage={canManage} />}
        {tab === 'History' && task && <AuditHistory entityId={task.id} />}

        <DialogFooter className="sm:justify-between">
          {task && (canManage || (task.created_by === me?.id && task.status === 'todo')) ? <Button variant="destructive" onClick={remove}>Delete</Button> : <span />}
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>Close</Button>
            {editable && tab === 'Details' && <Button onClick={save}>Save</Button>}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
