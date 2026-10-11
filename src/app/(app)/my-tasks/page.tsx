'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { useApp } from '@/components/AppProvider';
import { BoardGroup, EmptyState, PageHeader, Person, PriorityChip, ProgressBar, SelectField, StatusChip } from '@/components/common';
import { ViewToggle } from '@/components/project/PlanTab';
import TaskKanban from '@/components/TaskKanban';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { BUG_STATUSES, GROUP_COLORS, SEVERITIES, TASK_STATUSES } from '@/lib/constants';
import { fmtDate, isOverdue } from '@/lib/format';
import { dbClient } from '@/lib/db/client';
import type { Bug, InternalTask, Retest } from '@/lib/types';
import { cn } from '@/lib/utils';

type ProjRef = { project_code: string; project_name: string } | null;
type Row = InternalTask & { projects: ProjRef; activities: { name: string } | null };
type BugRow = Bug & { projects: ProjRef };
type RetestRow = Retest & { projects: ProjRef; bugs: { bug_no: string; title: string; severity: string } | null };

function MyWork() {
  const db = dbClient();
  const router = useRouter();
  const params = useSearchParams();
  const { me, profileName, hasRole } = useApp();
  const [picked, setTab] = useState(params.get('tab') ?? '');
  const tab = picked || (hasRole('qa') && !hasRole('developer') ? 'retests' : 'tasks');
  const [rows, setRows] = useState<Row[]>([]);
  const [bugs, setBugs] = useState<BugRow[]>([]);
  const [retests, setRetests] = useState<RetestRow[]>([]);
  const [scope, setScope] = useState(params.get('scope') ?? 'mine');
  const [filter, setFilter] = useState(params.get('filter') ?? 'open');
  const [layout, setLayout] = useState(params.get('view') ?? 'list');
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!me) return;
    let q = db.from('internal_tasks').select('*, projects(project_code, project_name), activities(name)').order('due_date');
    if (scope === 'mine') q = q.eq('owner_id', me.id);
    if (scope === 'review') q = q.eq('reviewer_id', me.id);
    q.then(({ data }) => setRows((data ?? []) as Row[]));
    let b = db.from('bugs').select('*, projects(project_code, project_name)').order('due_date');
    if (scope !== 'all') b = b.eq('assigned_dev_id', me.id);
    b.then(({ data }) => setBugs((data ?? []) as BugRow[]));
    let r = db.from('retests').select('*, projects(project_code, project_name), bugs(bug_no, title, severity)').eq('status', 'pending').order('due_date');
    if (scope !== 'all') r = r.eq('tester_id', me.id);
    r.then(({ data }) => setRetests((data ?? []) as RetestRow[]));
  }, [db, me, scope, tick]);

  const list = rows.filter((t) => filter === 'all' || (filter === 'overdue' ? isOverdue(t.due_date, t.status) : !['completed', 'cancelled'].includes(t.status)));
  const bugList = bugs.filter((b) => filter === 'all' || (filter === 'overdue'
    ? ['assigned', 'in_progress', 'reopened'].includes(b.status) && isOverdue(b.due_date, 'open')
    : !['closed', 'cancelled'].includes(b.status)));
  const projects = [...new Map(list.map((t) => [t.project_id, t.projects])).entries()];
  const openBugs = bugs.filter((b) => !['closed', 'cancelled'].includes(b.status)).length;

  return (
    <>
      <PageHeader title="My work" subtitle="Tasks, bugs to fix and retests across all projects" />
      <Tabs value={tab} onValueChange={setTab} className="mb-4">
        <TabsList variant="line" className="w-full justify-start border-b border-grid">
          <TabsTrigger value="tasks" className="flex-none px-3">Tasks</TabsTrigger>
          <TabsTrigger value="bugs" className="flex-none px-3">Bugs to fix{openBugs > 0 && <span className="ml-1 rounded-full bg-[#e2445c] px-1.5 text-[11px] text-white">{openBugs}</span>}</TabsTrigger>
          <TabsTrigger value="retests" className="flex-none px-3">Retest queue{retests.length > 0 && <span className="ml-1 rounded-full bg-[#a25ddc] px-1.5 text-[11px] text-white">{retests.length}</span>}</TabsTrigger>
        </TabsList>
      </Tabs>
      <div className="mb-6 flex flex-wrap items-center gap-3 border-b border-grid pb-4">
        <ViewToggle value={scope} onChange={setScope} options={tab === 'tasks' ? [['mine', 'Assigned to me'], ['review', 'I review'], ['all', 'All visible']] : [['mine', 'Mine'], ['all', 'All visible']]} />
        {tab === 'tasks' && <ViewToggle value={layout} onChange={setLayout} options={[['list', 'List'], ['kanban', 'Kanban']]} />}
        {tab !== 'retests' && (
          <SelectField className="w-40" value={filter} onChange={setFilter}
            options={[{ value: 'open', label: 'Open' }, { value: 'overdue', label: '⚠ Overdue' }, { value: 'all', label: 'All' }]} />
        )}
      </div>

      {tab === 'tasks' && layout === 'kanban' && (
        <TaskKanban
          tasks={list}
          canEdit={(t) => [t.owner_id, t.reviewer_id, t.created_by].includes(me?.id ?? '')}
          onOpen={(t) => router.push(`/projects/${t.project_id}?tab=internal&task=${t.id}`)}
          onChanged={() => setTick((n) => n + 1)}
          subtitle={(t) => (t as Row).projects?.project_code}
        />
      )}

      {tab === 'tasks' && layout === 'list' && (
        <>
          {list.length === 0 && <EmptyState text="No tasks" />}
          {projects.map(([pid, p], i) => {
            const items = list.filter((t) => t.project_id === pid);
            return (
              <BoardGroup key={pid} title={`${p?.project_code} · ${p?.project_name}`} color={GROUP_COLORS[i % GROUP_COLORS.length]} count={items.length}>
                <Table className="board-table">
                  <TableHeader>
                    <TableRow><TableHead className="text-left">Task</TableHead><TableHead>Activity</TableHead><TableHead>Owner</TableHead><TableHead>Status</TableHead><TableHead>Priority</TableHead><TableHead>Due</TableHead><TableHead>Progress</TableHead></TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map((t) => {
                      const od = isOverdue(t.due_date, t.status);
                      return (
                        <TableRow key={t.id} className={cn('cursor-pointer', od && 'bg-[#fff1f0] hover:bg-[#ffe5e3]')} onClick={() => router.push(`/projects/${t.project_id}?tab=internal&task=${t.id}`)}>
                          <TableCell className="min-w-64 whitespace-normal">{t.name}<span className="ml-1 text-xs text-muted-foreground/70">{t.task_no}</span></TableCell>
                          <TableCell className="text-center">{t.activities?.name}</TableCell>
                          <TableCell><Person name={profileName(t.owner_id)} /></TableCell>
                          <TableCell className="min-w-32 p-1"><StatusChip list={TASK_STATUSES} value={t.status} fullWidth /></TableCell>
                          <TableCell className="p-1"><PriorityChip value={t.priority} fullWidth /></TableCell>
                          <TableCell className={cn('text-center font-semibold', od && 'text-destructive')}>{od && '⚠ '}{fmtDate(t.due_date)}</TableCell>
                          <TableCell><ProgressBar value={t.progress} /></TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </BoardGroup>
            );
          })}
        </>
      )}

      {tab === 'bugs' && (
        <BoardGroup title="Bugs to fix" color="#e2445c" count={bugList.length}>
          {bugList.length === 0 ? <EmptyState text="No bugs 🎉" /> : (
            <Table className="board-table">
              <TableHeader><TableRow><TableHead className="text-left">Bug</TableHead><TableHead>Project</TableHead><TableHead>Severity</TableHead><TableHead>Status</TableHead><TableHead>Developer</TableHead><TableHead>Fix Due</TableHead></TableRow></TableHeader>
              <TableBody>
                {bugList.map((b) => {
                  const od = ['assigned', 'in_progress', 'reopened'].includes(b.status) && isOverdue(b.due_date, 'open');
                  return (
                    <TableRow key={b.id} className={cn('cursor-pointer', od && 'bg-[#fff1f0] hover:bg-[#ffe5e3]')} onClick={() => router.push(`/projects/${b.project_id}?tab=qa&bug=${b.id}`)}>
                      <TableCell className="min-w-72 whitespace-normal">{b.title}<div className="text-xs text-muted-foreground">{b.bug_no}{b.reopen_count > 0 && ` · reopened ×${b.reopen_count}`}</div></TableCell>
                      <TableCell className="text-center">{b.projects?.project_code}</TableCell>
                      <TableCell className="p-1"><StatusChip list={SEVERITIES} value={b.severity} fullWidth /></TableCell>
                      <TableCell className="min-w-28 p-1"><StatusChip list={BUG_STATUSES} value={b.status} fullWidth /></TableCell>
                      <TableCell><Person name={b.assigned_dev_id ? profileName(b.assigned_dev_id) : null} /></TableCell>
                      <TableCell className={cn('text-center font-semibold', od && 'text-destructive')}>{od && '⚠ '}{fmtDate(b.due_date)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </BoardGroup>
      )}

      {tab === 'retests' && (
        <BoardGroup title="Waiting for retest" color="#a25ddc" count={retests.length}>
          {retests.length === 0 ? <EmptyState text="Nothing to retest" /> : (
            <Table className="board-table">
              <TableHeader><TableRow><TableHead className="text-left">Bug</TableHead><TableHead>Project</TableHead><TableHead>Severity</TableHead><TableHead>Retest Round</TableHead><TableHead>Tester</TableHead><TableHead>Due</TableHead></TableRow></TableHeader>
              <TableBody>
                {retests.map((r) => {
                  const od = isOverdue(r.due_date, 'open');
                  return (
                    <TableRow key={r.id} className={cn('cursor-pointer', od && 'bg-[#fff1f0] hover:bg-[#ffe5e3]')} onClick={() => router.push(`/projects/${r.project_id}?tab=qa&bug=${r.bug_id}`)}>
                      <TableCell className="min-w-72 whitespace-normal">{r.bugs?.title}<div className="text-xs text-muted-foreground">{r.bugs?.bug_no}</div></TableCell>
                      <TableCell className="text-center">{r.projects?.project_code}</TableCell>
                      <TableCell className="p-1"><StatusChip list={SEVERITIES} value={r.bugs?.severity} fullWidth /></TableCell>
                      <TableCell className="text-center">#{r.retest_round}</TableCell>
                      <TableCell><Person name={r.tester_id ? profileName(r.tester_id) : null} /></TableCell>
                      <TableCell className={cn('text-center font-semibold', od && 'text-destructive')}>{od && '⚠ '}{fmtDate(r.due_date)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </BoardGroup>
      )}
    </>
  );
}

export default function MyTasksPage() {
  return <Suspense><MyWork /></Suspense>;
}
