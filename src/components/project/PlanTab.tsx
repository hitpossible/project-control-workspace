'use client';

import dayjs from 'dayjs';
import { ChevronsDownUp, ChevronsUpDown, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useApp } from '@/components/AppProvider';
import { BoardGroup, DateField, EmptyState, Person, ProgressBar, SelectField, StatusChip } from '@/components/common';
import GanttChart from '@/components/GanttChart';
import { ActivityDialog, TaskDialog } from '@/components/PlanDialogs';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { ACTIVITY_STATUSES } from '@/lib/constants';
import { fmtDate, isOverdue } from '@/lib/format';
import type { Activity, InternalTask } from '@/lib/types';
import { cn } from '@/lib/utils';
import { buildGanttRows } from './ganttRows';
import type { TabProps } from './types';

export function ViewToggle({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <ToggleGroup type="single" variant="outline" size="sm" value={value} onValueChange={(v) => v && onChange(v)} className="h-9">
      {options.map(([v, l]) => (
        <ToggleGroupItem key={v} value={v} className="h-9 px-3 data-[state=on]:bg-selected data-[state=on]:text-primary">{l}</ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

export default function PlanTab({ data, perm, reload, memberProfiles }: TabProps) {
  const { profileName } = useApp();
  const [view, setView] = useState('gantt');
  const [pic, setPic] = useState('');
  const [status, setStatus] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [editAct, setEditAct] = useState<Activity | 'new' | null>(null);
  const [editTask, setEditTask] = useState<InternalTask | null>(null);

  const picName = (a: Activity) => (a.pic_user_id ? profileName(a.pic_user_id) : a.pic_label ?? '-');
  const pics = useMemo(() => [...new Set(data.activities.map(picName))].sort(), [data.activities]); // eslint-disable-line react-hooks/exhaustive-deps

  const acts = data.activities.filter((a) => {
    if (pic && picName(a) !== pic) return false;
    if (status === 'overdue' ? !isOverdue(a.plan_finish, a.status) : status && a.status !== status) return false;
    if (from && a.plan_finish && dayjs(a.plan_finish).isBefore(from)) return false;
    if (to && a.plan_start && dayjs(a.plan_start).isAfter(to)) return false;
    return true;
  });

  const rows = buildGanttRows({ activities: acts, tasks: data.tasks, expanded, name: profileName, showTasks: perm.internal });
  const toggle = (id: string) => setExpanded((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <div>
      <div className="no-print mb-4 flex flex-wrap items-end gap-3">
        <ViewToggle value={view} onChange={setView} options={[['gantt', 'Gantt'], ['table', 'Table']]} />
        <SelectField className="w-44" label="PIC" value={pic} allowEmpty placeholder="All" onChange={setPic} options={pics.map((p) => ({ value: p, label: p }))} />
        <SelectField className="w-44" label="Status" value={status} allowEmpty placeholder="All" onChange={setStatus}
          options={[{ value: 'overdue', label: '⚠ Overdue' }, ...ACTIVITY_STATUSES]} />
        <DateField className="w-40" label="From" value={from} onChange={setFrom} />
        <DateField className="w-40" label="To" value={to} onChange={setTo} />
        {perm.internal && view === 'gantt' && (
          <>
            <Button variant="ghost" className="h-9" onClick={() => setExpanded(new Set([...data.activities.map((a) => a.id), ...data.tasks.map((t) => t.id)]))}><ChevronsUpDown /> Expand</Button>
            <Button variant="ghost" className="h-9" onClick={() => setExpanded(new Set())}><ChevronsDownUp /> Collapse</Button>
          </>
        )}
        <div className="flex-1" />
        {perm.manage && <Button className="h-9" onClick={() => setEditAct('new')}><Plus /> Add Activity</Button>}
      </div>

      {acts.length === 0 ? <EmptyState text="No activities" /> : view === 'gantt' ? (
        <GanttChart
          rows={rows}
          deps={data.deps.map((d) => ({ from: d.predecessor_id, to: d.successor_id }))}
          onToggle={(r) => toggle(r.id)}
          onRowClick={(r) => {
            if (r.level === 0) setEditAct(data.activities.find((a) => a.id === r.id) ?? null);
            else setEditTask(data.tasks.find((t) => t.id === r.id) ?? null);
          }}
        />
      ) : (
        <BoardGroup title="User Control Plan" color="#579bfc" count={acts.length}>
          <Table className="board-table">
            <TableHeader>
              <TableRow>
                {['#', 'Activity', 'PIC', 'Status', 'Plan Start', 'Plan Finish', 'Actual Start', 'Actual Finish', 'Progress', 'Status Note', 'Next Action', 'Recovery Plan', 'Remark'].map((h) => <TableHead key={h}>{h}</TableHead>)}
              </TableRow>
            </TableHeader>
            <TableBody>
              {acts.map((a, i) => {
                const od = isOverdue(a.plan_finish, a.status);
                return (
                  <TableRow key={a.id} className={cn('cursor-pointer', od && 'bg-[#fff1f0]')} onClick={() => setEditAct(a)}>
                    <TableCell className="text-center">{i + 1}</TableCell>
                    <TableCell className="min-w-48 font-medium">{a.is_milestone && '◆ '}{a.name}</TableCell>
                    <TableCell>{a.pic_user_id ? <Person name={picName(a)} /> : picName(a)}</TableCell>
                    <TableCell className="min-w-32 p-1"><StatusChip list={ACTIVITY_STATUSES} value={a.status} fullWidth /></TableCell>
                    <TableCell className="text-center">{fmtDate(a.plan_start)}</TableCell>
                    <TableCell className={cn('text-center', od && 'font-semibold text-destructive')}>{fmtDate(a.plan_finish)}</TableCell>
                    <TableCell className="text-center">{fmtDate(a.actual_start)}</TableCell>
                    <TableCell className="text-center">{fmtDate(a.actual_finish)}</TableCell>
                    <TableCell><ProgressBar value={a.progress} /></TableCell>
                    <TableCell className="min-w-40 whitespace-normal">{a.status_note}</TableCell>
                    <TableCell className="min-w-40 whitespace-normal">{a.next_action}</TableCell>
                    <TableCell className="min-w-44 whitespace-normal">
                      {a.recovery_plan}
                      {a.forecast_finish && <div className="text-xs text-destructive">Forecast {fmtDate(a.forecast_finish)}</div>}
                    </TableCell>
                    <TableCell className="min-w-36 whitespace-normal">{a.remark}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </BoardGroup>
      )}

      {editAct && (
        <ActivityDialog
          project={data.project}
          activity={editAct === 'new' ? null : editAct}
          hasTasks={editAct !== 'new' && data.tasks.some((t) => t.activity_id === editAct.id)}
          canManage={perm.manage}
          canViewInternal={perm.internal}
          members={memberProfiles}
          onClose={() => setEditAct(null)}
          onSaved={async () => { setEditAct(null); await reload(); }}
        />
      )}
      {editTask && (
        <TaskDialog
          project={data.project} task={editTask} activities={data.activities} tasks={data.tasks} deps={data.deps}
          canManage={perm.manage} members={memberProfiles}
          onClose={() => setEditTask(null)} onSaved={async () => { setEditTask(null); await reload(); }}
        />
      )}
    </div>
  );
}
