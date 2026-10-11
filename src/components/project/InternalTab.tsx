'use client';

import { CornerDownRight, Lock, Plus } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useApp } from '@/components/AppProvider';
import { BoardGroup, EmptyState, Person, PriorityChip, ProgressBar, SelectField, StatusChip, Tip } from '@/components/common';
import GanttChart from '@/components/GanttChart';
import { TaskDialog } from '@/components/PlanDialogs';
import TaskKanban from '@/components/TaskKanban';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { GROUP_COLORS, TASK_STATUSES, TASK_TYPES, optLabel } from '@/lib/constants';
import { fmtDate, isOverdue } from '@/lib/format';
import type { InternalTask } from '@/lib/types';
import { cn } from '@/lib/utils';
import { buildGanttRows } from './ganttRows';
import { ViewToggle } from './PlanTab';
import type { TabProps } from './types';

export default function InternalTab({ data, perm, reload, memberProfiles, focusTask }: TabProps & { focusTask?: string | null }) {
  const { me, profileName } = useApp();
  const [view, setView] = useState('table');
  const [owner, setOwner] = useState('');
  const [status, setStatus] = useState('');
  const [edit, setEdit] = useState<InternalTask | null>(null);
  const [create, setCreate] = useState<Partial<InternalTask> | null>(null);
  const canCreate = perm.manage || data.members.some((m) => m.user_id === me?.id && ['developer', 'qa', 'support'].includes(m.member_role));

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- open task from notification link
    if (focusTask) setEdit(data.tasks.find((t) => t.id === focusTask) ?? null);
  }, [focusTask, data.tasks]);

  const filter = (t: InternalTask) => {
    if (owner === 'me' ? t.owner_id !== me?.id : owner && t.owner_id !== owner) return false;
    if (status === 'overdue') return isOverdue(t.due_date, t.status);
    if (status === 'open') return !['completed', 'cancelled'].includes(t.status);
    return !status || t.status === status;
  };
  const filtered = data.tasks.filter(filter);
  const owners = useMemo(() => [...new Set(data.tasks.map((t) => t.owner_id))], [data.tasks]);
  const all = new Set([...data.activities.map((a) => a.id), ...data.tasks.map((t) => t.id)]);
  const rows = buildGanttRows({ activities: data.activities, tasks: data.tasks, expanded: all, name: profileName, showTasks: true, taskFilter: filter });

  const taskRow = (t: InternalTask, level: number) => {
    const od = isOverdue(t.due_date, t.status);
    return (
      <TableRow key={t.id} className={cn('cursor-pointer', od && 'bg-[#fff1f0] hover:bg-[#ffe5e3]')} onClick={() => setEdit(t)}>
        <TableCell className="min-w-80 whitespace-normal" style={{ paddingLeft: 12 + level * 24 }}>
          <div className="flex items-center gap-1">
            {level > 0 && <CornerDownRight className="size-3.5 text-muted-foreground/60" />}
            <span>{t.name}</span>
            <span className="ml-1 text-xs text-muted-foreground/70">{t.task_no}</span>
          </div>
          {(t.delay_reason || t.internal_comment) && (
            <div className={cn('text-xs', od ? 'text-destructive' : 'text-muted-foreground', level && 'pl-4')}>
              {t.delay_reason ? `Delay: ${t.delay_reason}` : t.internal_comment}
            </div>
          )}
        </TableCell>
        <TableCell className="text-center"><Person name={profileName(t.owner_id)} showName={false} /></TableCell>
        <TableCell className="text-center"><Person name={t.reviewer_id ? profileName(t.reviewer_id) : null} showName={false} /></TableCell>
        <TableCell className="text-center">{optLabel(TASK_TYPES, t.task_type)}</TableCell>
        <TableCell className="min-w-32 p-1"><StatusChip list={TASK_STATUSES} value={t.status} fullWidth /></TableCell>
        <TableCell className="p-1"><PriorityChip value={t.priority} fullWidth /></TableCell>
        <TableCell className={cn('text-center', od && 'font-semibold text-destructive')}>{od && '⚠ '}{fmtDate(t.due_date)}</TableCell>
        <TableCell><ProgressBar value={t.progress} /></TableCell>
        <TableCell className="no-print w-11 text-center" onClick={(e) => e.stopPropagation()}>
          {canCreate && level === 0 && (
            <Tip title="Add sub-task">
              <Button variant="ghost" size="icon-sm" onClick={() => setCreate({ activity_id: t.activity_id, parent_task_id: t.id, planned_start: t.planned_start, due_date: t.due_date, owner_id: t.owner_id })}><Plus /></Button>
            </Tip>
          )}
        </TableCell>
      </TableRow>
    );
  };

  return (
    <div>
      <Alert className="mb-4 border-[#cce5ff] bg-[#f0f7ff]">
        <Lock />
        <AlertDescription>Internal Execution Plan — visible to the System Service team only. Technical notes and internal comments are never shown in User / Management views.</AlertDescription>
      </Alert>
      <div className="no-print mb-5 flex flex-wrap items-end gap-3">
        <ViewToggle value={view} onChange={setView} options={[['table', 'Task List'], ['kanban', 'Kanban'], ['gantt', 'Gantt']]} />
        <SelectField className="w-48" label="Owner" value={owner} allowEmpty placeholder="All" onChange={setOwner}
          options={[{ value: 'me', label: 'Assigned to me' }, ...owners.map((o) => ({ value: o, label: profileName(o) }))]} />
        <SelectField className="w-44" label="Status" value={status} allowEmpty placeholder="All" onChange={setStatus}
          options={[{ value: 'open', label: 'Open' }, { value: 'overdue', label: '⚠ Overdue' }, ...TASK_STATUSES]} />
        <span className="pb-2 text-sm text-muted-foreground">{filtered.length} task(s)</span>
        <div className="flex-1" />
        {canCreate && data.activities.length > 0 && (
          <Button className="h-9" onClick={() => setCreate({ activity_id: data.activities[0].id })}><Plus /> Add Task</Button>
        )}
      </div>

      {view === 'kanban' ? (
        <TaskKanban
          tasks={filtered}
          canEdit={(t) => perm.manage || [t.owner_id, t.reviewer_id, t.created_by].includes(me?.id ?? '')}
          onOpen={setEdit}
          onChanged={reload}
          subtitle={(t) => data.activities.find((a) => a.id === t.activity_id)?.name}
        />
      ) : view === 'gantt' ? (
        <GanttChart rows={rows} deps={data.deps.map((d) => ({ from: d.predecessor_id, to: d.successor_id }))}
          onRowClick={(r) => r.level > 0 && setEdit(data.tasks.find((t) => t.id === r.id) ?? null)} />
      ) : (
        <div>
          {data.activities.map((a, i) => {
            const top = filtered.filter((t) => t.activity_id === a.id && !t.parent_task_id);
            const subsOnly = filtered.filter((t) => t.activity_id === a.id && t.parent_task_id && !top.some((p) => p.id === t.parent_task_id));
            if (!top.length && !subsOnly.length && (owner || status)) return null;
            const count = top.length + filtered.filter((t) => t.activity_id === a.id && t.parent_task_id).length;
            return (
              <BoardGroup
                key={a.id}
                title={a.name}
                color={GROUP_COLORS[i % GROUP_COLORS.length]}
                count={count}
                actions={<span className="text-xs text-muted-foreground">{fmtDate(a.plan_start)} → {fmtDate(a.plan_finish)} · {Math.round(a.progress)}%</span>}
              >
                <Table className="board-table">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-left">Task</TableHead><TableHead>Owner</TableHead><TableHead>Reviewer</TableHead><TableHead>Type</TableHead>
                      <TableHead>Status</TableHead><TableHead>Priority</TableHead><TableHead>Due Date</TableHead><TableHead>Progress</TableHead><TableHead className="no-print" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {top.flatMap((t) => [taskRow(t, 0), ...filtered.filter((c) => c.parent_task_id === t.id).map((c) => taskRow(c, 1))])}
                    {subsOnly.map((t) => taskRow(t, 1))}
                    {canCreate && (
                      <TableRow className="no-print hover:bg-transparent">
                        <TableCell colSpan={9} className="py-1">
                          <Button variant="ghost" size="sm" className="text-muted-foreground"
                            onClick={() => setCreate({ activity_id: a.id, planned_start: a.plan_start, due_date: a.plan_finish ?? undefined })}><Plus /> Add task</Button>
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </BoardGroup>
            );
          })}
          {data.activities.length === 0 && <EmptyState text="Add activities in the User Control Plan first" />}
        </div>
      )}

      {(edit || create) && (
        <TaskDialog
          project={data.project} task={edit} defaults={create ?? undefined}
          activities={data.activities} tasks={data.tasks} deps={data.deps}
          canManage={perm.manage} members={memberProfiles}
          onClose={() => { setEdit(null); setCreate(null); }}
          onSaved={async () => { setEdit(null); setCreate(null); await reload(); }}
        />
      )}
    </div>
  );
}
