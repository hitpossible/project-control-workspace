'use client';

import { Pencil, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { dispatchEmails, useApp } from '@/components/AppProvider';
import { DateField, Field, HealthDot, Person, ProgressBar, Section, SelectField, StatCard, StatusChip, TextField, UserSelect } from '@/components/common';
import InsightList from '@/components/InsightList';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ACTIVITY_STATUSES, MEMBER_ROLES, PRIORITIES, PROJECT_STATUSES, optLabel } from '@/lib/constants';
import { errMsg, fmtDate, fmtDateTime, isOverdue, nullify } from '@/lib/format';
import { dbClient } from '@/lib/db/client';
import type { Project } from '@/lib/types';
import { cn } from '@/lib/utils';
import type { TabProps } from './types';

// Statuses a leader may set manually; Delayed / At Risk are derived by the system
const MANUAL_STATUSES = PROJECT_STATUSES.filter((s) => ['planning', 'in_progress', 'waiting', 'on_hold', 'completed', 'cancelled'].includes(s.value));

export default function OverviewTab({ data, perm, reload }: TabProps) {
  const { profileName } = useApp();
  const p = data.project;
  const [edit, setEdit] = useState(false);
  const overdueTasks = data.tasks.filter((t) => isOverdue(t.due_date, t.status));
  const openTasks = data.tasks.filter((t) => !['completed', 'cancelled'].includes(t.status));
  const sv = p.schedule_variance;

  return (
    <div className="grid grid-cols-12 gap-4">
      <div className={cn('col-span-12 grid grid-cols-2 gap-3', perm.internal ? 'md:grid-cols-4 xl:grid-cols-7' : 'md:grid-cols-3 xl:grid-cols-6')}>
        <StatCard label="Progress" value={`${Math.round(p.progress)}%`} color="#00c875" hint={`${data.activities.filter((a) => a.status === 'completed').length}/${data.activities.length} activities done`} />
        <StatCard label="Target / Forecast" value={<span className="text-lg">{fmtDate(p.target_date)}<br /><span className={cn('text-sm', sv && sv > 0 ? 'text-destructive' : 'text-muted-foreground')}>FC {fmtDate(p.forecast_date)}</span></span>} color="#579bfc" />
        <StatCard label="Schedule Variance" value={sv == null ? '—' : `${sv > 0 ? '+' : ''}${sv}d`} color={sv && sv > 0 ? '#e2445c' : '#00c875'} hint={p.baseline_finish ? `vs Baseline V${p.baseline_version} ${fmtDate(p.baseline_finish)}` : 'Baseline not set'} />
        <StatCard label="Overdue Activities" value={p.overdue_activities} color={p.overdue_activities ? '#e2445c' : '#00c875'} hint={p.delayed_without_recovery ? `${p.delayed_without_recovery} without recovery plan` : 'All have recovery plan'} />
        {perm.internal && <StatCard label="Overdue Tasks" value={overdueTasks.length} color={overdueTasks.length ? '#e2445c' : '#00c875'} hint={`${openTasks.length} open tasks`} />}
        <StatCard label="Bugs Open / Critical" value={<>{p.open_bugs}<span className="text-lg text-[#bb3354]"> / {p.critical_bugs}</span></>} color={p.critical_bugs ? '#bb3354' : '#579bfc'} hint={`${p.retest_pending} waiting retest`} />
        <StatCard label="Evidence Missing" value={p.evidence_missing} color={p.evidence_missing ? '#784bd1' : '#00c875'} hint={`${data.requirements.length} checklist items`} />
      </div>

      <div className="col-span-12 lg:col-span-8">
        {p.attention.length > 0 && (
          <Alert variant={p.health === 'red' ? 'destructive' : 'default'} className="mb-4">
            <TriangleAlert />
            <AlertTitle>Project Need Attention</AlertTitle>
            <AlertDescription><ul className="list-disc pl-4">{p.attention.map((a) => <li key={a}>{a}</li>)}</ul></AlertDescription>
          </Alert>
        )}
        <Section title="Project Record" actions={perm.manage && <Button variant="ghost" size="sm" className="no-print" onClick={() => setEdit(true)}><Pencil /> Edit</Button>}>
          <div className="grid grid-cols-2 gap-x-4 md:grid-cols-4">
            <Field label="Project Code">{p.project_code}</Field>
            <Field label="Project Type">{p.project_type_name}</Field>
            <Field label="Project Leader"><Person name={p.leader_name} /></Field>
            <Field label="Sponsor">{p.sponsor}</Field>
            <Field label="Department">{p.requestor_department ?? p.department}</Field>
            <Field label="Priority">{optLabel(PRIORITIES, p.priority)}</Field>
            <Field label="Start Date">{fmtDate(p.start_date)}</Field>
            <Field label="Target Date">{fmtDate(p.target_date)}</Field>
            <Field label="Status"><StatusChip list={PROJECT_STATUSES} value={p.status} /></Field>
            <Field label="Health"><HealthDot value={p.health} label /></Field>
            <div className="col-span-2"><Field label="Progress"><ProgressBar value={p.progress} className="max-w-72" /></Field></div>
          </div>
          <Field label="Next Action">{p.next_action}</Field>
          <Field label="High-level Remark (visible to User / Management)">{p.remark}</Field>
          <p className="text-xs text-muted-foreground">Last updated {fmtDateTime(p.updated_at)} by {p.updated_by ? profileName(p.updated_by) : 'System'}</p>
        </Section>

        <Section title="Activity Status">
          <Table className="board-table">
            <TableHeader>
              <TableRow><TableHead className="text-left">Activity</TableHead><TableHead>PIC</TableHead><TableHead>Plan Finish</TableHead><TableHead>Progress</TableHead><TableHead>Status</TableHead><TableHead>Next Action</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {data.activities.map((a) => {
                const od = isOverdue(a.plan_finish, a.status);
                return (
                  <TableRow key={a.id} className={cn(od && 'bg-[#fff1f0]')}>
                    <TableCell className="font-medium">{a.name}</TableCell>
                    <TableCell>{a.pic_user_id ? <Person name={profileName(a.pic_user_id)} /> : a.pic_label}</TableCell>
                    <TableCell className={cn('text-center', od && 'font-semibold text-destructive')}>{fmtDate(a.plan_finish)}</TableCell>
                    <TableCell><ProgressBar value={a.progress} /></TableCell>
                    <TableCell className="min-w-32 p-1"><StatusChip list={ACTIVITY_STATUSES} value={a.status} fullWidth /></TableCell>
                    <TableCell className="whitespace-normal">{a.next_action ?? '-'}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Section>
      </div>

      <div className="col-span-12 lg:col-span-4">
        <Section title="Smart Insights" className="pb-1"><div className="-mx-4"><InsightList projectId={p.id} showProject={false} /></div></Section>
        <Section title="Project Team">
          <div className="space-y-2">
            {data.members.map((m) => (
              <div key={m.id} className="flex items-center justify-between gap-2">
                <Person name={profileName(m.user_id)} />
                <span className="text-xs text-muted-foreground">{optLabel(MEMBER_ROLES, m.member_role)}</span>
              </div>
            ))}
          </div>
        </Section>
        {perm.internal && (
          <Section title="Upcoming / Overdue Tasks">
            <div className="space-y-2">
              {[...openTasks].sort((a, b) => a.due_date.localeCompare(b.due_date)).slice(0, 8).map((t) => (
                <div key={t.id} className="flex justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{t.task_no} {t.name}</div>
                    <div className="text-xs text-muted-foreground">{profileName(t.owner_id)}</div>
                  </div>
                  <span className={cn('text-xs font-semibold whitespace-nowrap', isOverdue(t.due_date, t.status) ? 'text-destructive' : 'text-muted-foreground')}>{fmtDate(t.due_date)}</span>
                </div>
              ))}
              {openTasks.length === 0 && <p className="text-sm text-muted-foreground">No open tasks</p>}
            </div>
          </Section>
        )}
      </div>

      {edit && <EditProjectDialog project={p} onClose={() => setEdit(false)} onSaved={async () => { setEdit(false); await reload(); }} />}
    </div>
  );
}

function EditProjectDialog({ project, onClose, onSaved }: { project: Project; onClose: () => void; onSaved: () => void }) {
  const db = dbClient();
  const { notify } = useApp();
  const [f, setF] = useState({
    leader_id: project.leader_id, sponsor: project.sponsor ?? '', priority: project.priority, target_date: project.target_date ?? '',
    status: project.status, next_action: project.next_action ?? '', remark: project.remark ?? '',
  });
  const derived = !MANUAL_STATUSES.some((s) => s.value === f.status);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>Edit Project</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <UserSelect label="Project Leader" roles={['project_leader']} value={f.leader_id} onChange={(v) => setF({ ...f, leader_id: v })} />
          <TextField label="Sponsor" value={f.sponsor} onChange={(v) => setF({ ...f, sponsor: v })} />
          <SelectField label="Priority" value={f.priority} onChange={(v) => setF({ ...f, priority: v })} options={PRIORITIES} />
          <DateField label="Target Date" value={f.target_date} onChange={(v) => setF({ ...f, target_date: v })} helperText="Changes are kept in history. Use Baseline revision for re-plan." />
          <SelectField label="Status" value={f.status} onChange={(v) => setF({ ...f, status: v })}
            options={derived ? [...MANUAL_STATUSES, PROJECT_STATUSES.find((s) => s.value === f.status)!] : MANUAL_STATUSES}
            helperText="Delayed / At Risk are set automatically from the plan" />
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
