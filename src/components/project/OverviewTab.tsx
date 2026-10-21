'use client';

import { Bug, CalendarClock, Check, Clock, FileCheck, Pencil, TrendingUp, TriangleAlert, type LucideIcon } from 'lucide-react';
import { useState } from 'react';
import { dispatchEmails, useApp } from '@/components/AppProvider';
import { DateField, HealthDot, Person, ProgressBar, Section, SelectField, StatusChip, TextField, UserSelect } from '@/components/common';
import InsightList from '@/components/InsightList';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ACTIVITY_STATUSES, MEMBER_ROLES, PRIORITIES, optColor, optLabel } from '@/lib/constants';
import { errMsg, fmtDate, fmtDateTime, isOverdue, nullify } from '@/lib/format';
import { dbClient } from '@/lib/db/client';
import type { Project } from '@/lib/types';
import { cn } from '@/lib/utils';
import { ReadyToCloseBanner } from './ProjectStatus';
import type { TabProps } from './types';

export default function OverviewTab({ data, perm, reload }: TabProps) {
  const { profileName } = useApp();
  const p = data.project;
  const [edit, setEdit] = useState(false);
  const overdueTasks = data.tasks.filter((t) => isOverdue(t.due_date, t.status));
  const openTasks = data.tasks.filter((t) => !['completed', 'cancelled'].includes(t.status));
  const sv = p.schedule_variance;

  const doneActs = data.activities.filter((a) => a.status === 'completed').length;
  const late = sv != null && sv > 0;

  return (
    <div className="grid grid-cols-12 gap-4">
      <div className={cn('col-span-12 grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-border ring-1 ring-border md:grid-cols-3', perm.internal ? 'xl:grid-cols-5' : 'xl:grid-cols-4')}>
        <Kpi icon={TrendingUp} label="Progress" value={`${Math.round(p.progress)}%`}
          hint={<><span className="mt-1.5 mb-1 block h-1.5 overflow-hidden rounded-full bg-muted"><span className="block h-full rounded-full bg-[#00c875]" style={{ width: `${Math.min(100, p.progress)}%` }} /></span>{doneActs}/{data.activities.length} activities done</>} />
        <Kpi icon={CalendarClock} label="Target / Forecast" tone={late ? 'bad' : undefined}
          value={<>{fmtDate(p.target_date)}{sv != null && <span className={cn('ml-1.5 align-middle text-xs font-medium', late ? 'text-destructive' : 'text-[#00854d]')}>{sv > 0 ? '+' : ''}{sv}d</span>}</>}
          hint={<><span className={cn('block truncate', late && 'font-medium text-destructive')}>Forecast {fmtDate(p.forecast_date)}</span><span className="block truncate">{p.baseline_finish ? `Baseline V${p.baseline_version} · ${fmtDate(p.baseline_finish)}` : 'Baseline not set'}</span></>} />
        <Kpi icon={Clock} label="Overdue" tone={p.overdue_activities || overdueTasks.length ? 'bad' : 'good'}
          value={<>{p.overdue_activities}<span className="text-sm font-normal text-muted-foreground"> activities</span>{perm.internal && <> · {overdueTasks.length}<span className="text-sm font-normal text-muted-foreground"> tasks</span></>}</>}
          hint={p.delayed_without_recovery ? `${p.delayed_without_recovery} without recovery plan` : perm.internal ? `${openTasks.length} open tasks` : 'All have recovery plan'} />
        <Kpi icon={Bug} label="Bugs" tone={p.critical_bugs ? 'bad' : undefined}
          value={<>{p.open_bugs}<span className="text-sm font-normal text-muted-foreground"> open</span> · <span className={cn(p.critical_bugs > 0 && 'text-[#bb3354]')}>{p.critical_bugs}</span><span className="text-sm font-normal text-muted-foreground"> critical</span></>}
          hint={`${p.retest_pending} waiting retest`} />
        <Kpi icon={FileCheck} label="Evidence Missing" tone={p.evidence_missing ? 'warn' : 'good'} value={p.evidence_missing} hint={`${data.requirements.length} checklist items`} />
      </div>

      <div className="col-span-12 min-w-0 lg:col-span-8">
        <ReadyToCloseBanner data={data} perm={perm} reload={reload} />
        {p.attention.length > 0 && (
          <Alert variant={p.health === 'red' ? 'destructive' : 'default'} className="mb-4">
            <TriangleAlert />
            <AlertTitle>Project Need Attention</AlertTitle>
            <AlertDescription><ul className="list-disc pl-4">{p.attention.map((a) => <li key={a}>{a}</li>)}</ul></AlertDescription>
          </Alert>
        )}

        <Section title="Current Focus" actions={perm.manage && <Button variant="ghost" size="sm" className="no-print" onClick={() => setEdit(true)}><Pencil /> Edit</Button>}>
          <div className="rounded-lg border-l-4 border-primary bg-[#eef5ff] px-4 py-3">
            <div className="text-xs font-medium text-primary">Next Action</div>
            <div className="mt-0.5 text-[15px] font-medium break-words whitespace-pre-wrap">{p.next_action || <span className="font-normal text-muted-foreground">Not set</span>}</div>
          </div>
          {p.remark && (
            <div className="mt-3 rounded-lg bg-muted/50 px-4 py-3">
              <div className="text-xs font-medium text-muted-foreground">High-level Remark <span className="font-normal">· visible to User / Management</span></div>
              <div className="mt-0.5 text-sm break-words whitespace-pre-wrap">{p.remark}</div>
            </div>
          )}
          <p className="mt-3 text-xs text-muted-foreground">Last updated {fmtDateTime(p.updated_at)} by {p.updated_by ? profileName(p.updated_by) : 'System'}</p>
        </Section>

        <Section title="Activity Status" actions={<span className="text-xs text-muted-foreground">{doneActs} / {data.activities.length} done</span>}>
          {data.activities.length === 0 ? <p className="text-sm text-muted-foreground">No activities</p> : (
            <ol className="divide-y rounded-lg border">
              {data.activities.map((a, i) => {
                const od = isOverdue(a.plan_finish, a.status);
                return (
                  <li key={a.id} className={cn('grid grid-cols-[1.75rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 px-3 py-2.5 md:grid-cols-[1.75rem_minmax(8rem,1fr)_9rem_6rem_7.5rem_7rem]', od && 'bg-[#fff1f0]')}>
                    <span className="flex size-6 items-center justify-center rounded-full text-[11px] font-semibold"
                      style={{ background: optColor(ACTIVITY_STATUSES, a.status), color: '#fff' }}>
                      {a.status === 'completed' ? <Check className="size-3.5" strokeWidth={3} /> : i + 1}
                    </span>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{a.name}</div>
                      {a.next_action && <div className="truncate text-xs text-muted-foreground" title={a.next_action}>→ {a.next_action}</div>}
                    </div>
                    <div className="col-start-2 min-w-0 md:col-start-auto">{a.pic_user_id ? <Person name={profileName(a.pic_user_id)} size={24} /> : <span className="text-sm text-muted-foreground">{a.pic_label ?? '-'}</span>}</div>
                    <div className={cn('text-sm tabular-nums md:text-center', od ? 'font-semibold text-destructive' : 'text-muted-foreground')}>{fmtDate(a.plan_finish)}</div>
                    <ProgressBar value={a.progress} className="col-start-2 min-w-0 md:col-start-auto" />
                    <StatusChip list={ACTIVITY_STATUSES} value={a.status} fullWidth className="h-6 text-xs" />
                  </li>
                );
              })}
            </ol>
          )}
        </Section>
      </div>

      <div className="col-span-12 lg:col-span-4">
        <Section title="Project Details" actions={perm.manage && <Button variant="ghost" size="icon-sm" className="no-print" title="Edit" onClick={() => setEdit(true)}><Pencil /></Button>}>
          <dl className="divide-y text-sm">
            <Row label="Project Type">{p.project_type_name}</Row>
            <Row label="Leader"><Person name={p.leader_name} size={22} /></Row>
            <Row label="Sponsor">{p.sponsor}</Row>
            <Row label="Department">{p.requestor_department ?? p.department}</Row>
            <Row label="Priority">{optLabel(PRIORITIES, p.priority)}</Row>
            <Row label="Health"><HealthDot value={p.health} label /></Row>
            <Row label="Start → Target">{fmtDate(p.start_date)} → {fmtDate(p.target_date)}</Row>
          </dl>
        </Section>
        <Section title="Smart Insights" className="pb-1"><div className="-mx-4"><InsightList projectId={p.id} showProject={false} /></div></Section>
        <Section title="Project Team" actions={<span className="text-xs text-muted-foreground">{data.members.length}</span>}>
          <div className="space-y-2">
            {data.members.map((m) => (
              <div key={m.id} className="flex items-center justify-between gap-2">
                <Person name={profileName(m.user_id)} />
                <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">{optLabel(MEMBER_ROLES, m.member_role)}</span>
              </div>
            ))}
          </div>
        </Section>
        {perm.internal && (
          <Section title="Upcoming / Overdue Tasks" actions={<span className="text-xs text-muted-foreground">{openTasks.length} open</span>}>
            <div className="-mx-1 space-y-0.5">
              {[...openTasks].sort((a, b) => a.due_date.localeCompare(b.due_date)).slice(0, 8).map((t) => {
                const od = isOverdue(t.due_date, t.status);
                return (
                  <div key={t.id} className="flex items-center justify-between gap-2 rounded-md px-1 py-1">
                    <div className="min-w-0">
                      <div className="truncate text-sm"><span className="text-xs text-muted-foreground">{t.task_no}</span> {t.name}</div>
                      <div className="text-xs text-muted-foreground">{profileName(t.owner_id)}</div>
                    </div>
                    <span className={cn('shrink-0 rounded px-1.5 py-0.5 text-xs font-medium whitespace-nowrap', od ? 'bg-[#fdebee] text-destructive' : 'bg-muted text-muted-foreground')}>{fmtDate(t.due_date)}</span>
                  </div>
                );
              })}
              {openTasks.length === 0 && <p className="text-sm text-muted-foreground">No open tasks</p>}
            </div>
          </Section>
        )}
      </div>

      {edit && <EditProjectDialog project={p} onClose={() => setEdit(false)} onSaved={async () => { setEdit(false); await reload(); }} />}
    </div>
  );
}

const KPI_TONE = { good: 'text-[#00854d]', warn: 'text-[#784bd1]', bad: 'text-destructive' };

function Kpi({ icon: Icon, label, value, hint, tone }: { icon: LucideIcon; label: string; value: React.ReactNode; hint?: React.ReactNode; tone?: keyof typeof KPI_TONE }) {
  return (
    <div className="min-w-0 bg-card px-4 py-3">
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><Icon className="size-3.5" />{label}</div>
      <div className={cn('mt-1 truncate font-heading text-xl font-semibold', tone && KPI_TONE[tone])}>{value}</div>
      {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate text-right font-medium">{children || <span className="font-normal text-muted-foreground">-</span>}</dd>
    </div>
  );
}

function EditProjectDialog({ project, onClose, onSaved }: { project: Project; onClose: () => void; onSaved: () => void }) {
  const db = dbClient();
  const { notify } = useApp();
  const [f, setF] = useState({
    leader_id: project.leader_id, sponsor: project.sponsor ?? '', priority: project.priority, target_date: project.target_date ?? '',
    next_action: project.next_action ?? '', remark: project.remark ?? '',
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>Edit Project</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <UserSelect label="Project Leader" roles={['project_leader']} value={f.leader_id} onChange={(v) => setF({ ...f, leader_id: v })} />
          <TextField label="Sponsor" value={f.sponsor} onChange={(v) => setF({ ...f, sponsor: v })} />
          <SelectField label="Priority" value={f.priority} onChange={(v) => setF({ ...f, priority: v })} options={PRIORITIES} />
          <DateField label="Target Date" value={f.target_date} onChange={(v) => setF({ ...f, target_date: v })} helperText="Changes are kept in history. Use Baseline revision for re-plan." />
          <TextField label="Next Action" value={f.next_action} onChange={(v) => setF({ ...f, next_action: v })} />
          <TextField label="High-level Remark" multiline rows={2} value={f.remark} onChange={(v) => setF({ ...f, remark: v })} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={async () => {
            const { error } = await db.from('projects').update(nullify(f)).eq('id', project.id);
            if (error) return notify(errMsg(error), 'error');
            notify('Project updated');
            dispatchEmails();
            onSaved();
          }}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
