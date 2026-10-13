'use client';

import dayjs from 'dayjs';
import { RefreshCw, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { dispatchEmails, useApp } from '@/components/AppProvider';
import { BoardGroup, EmptyState, HealthDot, PageHeader, Person, StatCard, StatusChip, Tip } from '@/components/common';
import InsightList from '@/components/InsightList';
import ManagementDashboard from '@/components/ManagementDashboard';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PROJECT_STATUSES, TASK_STATUSES, WORK_TYPES, optColor, optLabel } from '@/lib/constants';
import { errMsg, fmtDate, isOverdue } from '@/lib/format';
import { dbClient } from '@/lib/db/client';
import type { ApprovalStep, InternalTask, ProjectView, WorkforcePlan } from '@/lib/types';
import { cn } from '@/lib/utils';

const OPEN_COLOR = '#579bfc';
const OVERDUE_COLOR = '#e2445c';

export default function HomePage() {
  const { me, isStaff } = useApp();
  if (!me) return null;
  return isStaff ? <InternalDashboard /> : <ManagementDashboard />;
}

function InternalDashboard() {
  const db = dbClient();
  const router = useRouter();
  const { me, profileName, notify, refreshUnread } = useApp();
  const [projects, setProjects] = useState<ProjectView[]>([]);
  const [tasks, setTasks] = useState<InternalTask[]>([]);
  const [steps, setSteps] = useState<ApprovalStep[]>([]);
  const [pendingEvidence, setPendingEvidence] = useState(0);
  const [today, setToday] = useState<WorkforcePlan[]>([]);

  const load = useCallback(async () => {
    const [p, t, s, e] = await Promise.all([
      db.from('v_projects').select('*').order('project_code'),
      db.from('internal_tasks').select('*').not('status', 'in', '(completed,cancelled)'),
      db.from('approval_steps').select('*').eq('status', 'waiting'),
      db.from('evidence').select('id', { count: 'exact', head: true }).eq('verification_status', 'pending').not('project_id', 'is', null),
    ]);
    setProjects((p.data ?? []) as ProjectView[]);
    setTasks((t.data ?? []) as InternalTask[]);
    setSteps((s.data ?? []) as ApprovalStep[]);
    setPendingEvidence(e.count ?? 0);
    const w = await db.from('workforce_plans').select('*').eq('work_date', dayjs().format('YYYY-MM-DD')).order('start_time');
    setToday((w.data ?? []) as WorkforcePlan[]);
  }, [db]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data fetch
    load();
  }, [load]);

  const active = projects.filter((p) => !['completed', 'cancelled'].includes(p.status));
  const attention = active.filter((p) => p.attention.length > 0 || p.health === 'red');
  const overdue = tasks.filter((t) => isOverdue(t.due_date, t.status));
  const upcoming = tasks.filter((t) => !isOverdue(t.due_date, t.status) && dayjs(t.due_date).diff(dayjs(), 'day') <= 7).sort((a, b) => a.due_date.localeCompare(b.due_date));
  const myApprovals = steps.filter((s) => (s.approver_id ? s.approver_id === me?.id : me?.roles.includes(s.approver_role as never)));
  const projectCode = (id: string) => projects.find((p) => p.id === id)?.project_code ?? '';
  const count = (s: string) => projects.filter((p) => p.status === s).length;
  const sum = (k: 'open_bugs' | 'critical_bugs' | 'fix_overdue' | 'retest_pending' | 'retest_overdue' | 'evidence_missing') => active.reduce((a, p) => a + (p[k] ?? 0), 0);

  const workload = useMemo(() => {
    const m = new Map<string, { open: number; overdue: number }>();
    tasks.forEach((t) => {
      const w = m.get(t.owner_id) ?? { open: 0, overdue: 0 };
      if (isOverdue(t.due_date, t.status)) w.overdue++;
      else w.open++;
      m.set(t.owner_id, w);
    });
    return [...m.entries()].map(([id, w]) => ({ id, ...w, total: w.open + w.overdue })).sort((a, b) => b.total - a.total);
  }, [tasks]);
  const maxLoad = Math.max(1, ...workload.map((w) => w.total));

  const runScan = async () => {
    const { data, error } = await db.rpc('trigger_notification_scan');
    if (error) return notify(errMsg(error), 'error');
    notify(`Scan done: ${data.due_tomorrow} due-tomorrow, ${data.overdue} overdue reminders, ${data.activities_delayed} activities marked delayed`, 'info');
    dispatchEmails();
    refreshUnread();
    load();
  };

  const stats = [
    { l: 'Total Project', v: projects.length, c: '#0073ea', q: '' },
    { l: 'Working on it', v: count('in_progress'), c: '#fdab3d', q: '?status=in_progress' },
    { l: 'Planning / Waiting', v: count('planning') + count('waiting') + count('on_hold'), c: '#a25ddc', q: '?status=active' },
    { l: 'Delayed', v: count('delayed'), c: '#e2445c', q: '?status=delayed' },
    { l: 'At Risk', v: count('at_risk'), c: '#ff642e', q: '?status=at_risk' },
    { l: 'Done', v: count('completed'), c: '#00c875', q: '?status=completed' },
  ];

  return (
    <>
      <PageHeader
        title="Internal Dashboard"
        subtitle={`System Service · ${dayjs().format('dddd DD MMMM YYYY')}`}
        actions={<Tip title="Runs hourly automatically (scheduler). Run now to send due / overdue reminders."><Button variant="outline" onClick={runScan}><RefreshCw /> Run Notification Scan</Button></Tip>}
      />

      {myApprovals.length > 0 && (
        <Alert className="mb-4 border-[#fdab3d] bg-[#fff6e5]">
          <TriangleAlert />
          <AlertDescription className="flex items-center gap-3">
            <span>You have <b>{myApprovals.length}</b> request(s) waiting for your approval / review.</span>
            <Button asChild size="sm" variant="outline" className="ml-auto"><Link href="/requests">Open</Link></Button>
          </AlertDescription>
        </Alert>
      )}

      <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {stats.map((s) => <StatCard key={s.l} label={s.l} value={s.v} color={s.c} onClick={() => router.push(`/projects${s.q}`)} />)}
      </div>
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard label="Overdue Tasks" value={overdue.length} color={OVERDUE_COLOR} hint={`${tasks.length} open tasks`} onClick={() => router.push('/my-tasks?scope=all&filter=overdue')} />
        <StatCard label="Need Attention" value={attention.length} color="#ff642e" onClick={() => router.push('/projects?attention=1')} />
        <StatCard label="Retest Pending" value={sum('retest_pending')} color="#a25ddc" hint={`${sum('retest_overdue')} overdue`} />
        <StatCard label="Evidence Missing" value={sum('evidence_missing')} color="#784bd1" hint={`${pendingEvidence} pending review`} onClick={() => router.push('/projects?attention=1')} />
        <StatCard label="Bugs Open / Critical" value={<>{sum('open_bugs')}<span className="text-lg text-[#bb3354]"> / {sum('critical_bugs')}</span></>} color="#e2445c"
          hint={`${sum('fix_overdue')} fix overdue`} />
      </div>

      <div className="grid grid-cols-12 gap-5">
        <div className="col-span-12 xl:col-span-7">
          <BoardGroup title={<span className="inline-flex items-center gap-1.5"><TriangleAlert className="size-4" /> Projects Need Attention</span>} color="#e2445c" count={attention.length}>
            {attention.length === 0 ? <EmptyState text="All projects on track 🎉" /> : (
              <Table className="board-table">
                <TableBody>
                  {attention.map((p) => (
                    <TableRow key={p.id} className="cursor-pointer" onClick={() => router.push(`/projects/${p.id}`)}>
                      <TableCell className="w-8 text-center"><HealthDot value={p.health} /></TableCell>
                      <TableCell className="whitespace-normal">
                        <div><b>{p.project_code}</b> {p.project_name}</div>
                        <div className="text-xs text-destructive">{p.attention.join(' · ') || 'Health RED'}</div>
                      </TableCell>
                      <TableCell className="w-32 p-1"><StatusChip list={PROJECT_STATUSES} value={p.status} fullWidth /></TableCell>
                      <TableCell className="w-12 text-center"><Person name={p.leader_name} showName={false} /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </BoardGroup>

          <BoardGroup title="Upcoming Due Date (next 7 days) & Overdue" color="#fdab3d" count={Math.min(15, overdue.length + upcoming.length)}>
            {overdue.length + upcoming.length === 0 ? <EmptyState text="Nothing due" /> : (
              <Table className="board-table">
                <TableHeader><TableRow><TableHead className="text-left">Task</TableHead><TableHead>Project</TableHead><TableHead>Owner</TableHead><TableHead>Status</TableHead><TableHead>Due</TableHead></TableRow></TableHeader>
                <TableBody>
                  {[...overdue.sort((a, b) => a.due_date.localeCompare(b.due_date)), ...upcoming].slice(0, 15).map((t) => {
                    const od = isOverdue(t.due_date, t.status);
                    return (
                      <TableRow key={t.id} className={cn('cursor-pointer', od && 'bg-[#fff1f0] hover:bg-[#ffe5e3]')} onClick={() => router.push(`/projects/${t.project_id}?tab=internal&task=${t.id}`)}>
                        <TableCell className="min-w-56 whitespace-normal">{t.name}<span className="ml-1 text-xs text-muted-foreground/70">{t.task_no}</span></TableCell>
                        <TableCell className="text-center">{projectCode(t.project_id)}</TableCell>
                        <TableCell><Person name={profileName(t.owner_id)} /></TableCell>
                        <TableCell className="min-w-32 p-1"><StatusChip list={TASK_STATUSES} value={t.status} fullWidth /></TableCell>
                        <TableCell className={cn('text-center font-semibold', od && 'text-destructive')}>{od && '⚠ '}{fmtDate(t.due_date)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </BoardGroup>
        </div>

        <div className="col-span-12 xl:col-span-5">
          <BoardGroup title="Smart Insights" color="#784bd1" actions={<Link href="/insights" className="text-xs text-primary">View all</Link>}>
            <InsightList limit={6} />
          </BoardGroup>

          <BoardGroup title="Who's where today" color="#66ccff" count={today.length} actions={<Link href="/workforce" className="text-xs text-primary">Workforce plan</Link>}>
            {today.length === 0 ? <EmptyState text="No workforce plan for today" /> : (
              <div className="divide-y divide-grid">
                {today.filter((w, i, arr) => arr.findIndex((x) => x.user_id === w.user_id) === i).map((w) => (
                  <div key={w.id} className="flex items-center gap-2 px-3 py-1.5">
                    <Person name={profileName(w.user_id)} size={24} />
                    <span className="ml-auto rounded px-1.5 py-0.5 text-[11px] text-white" style={{ background: optColor(WORK_TYPES, w.work_type) }}>{optLabel(WORK_TYPES, w.work_type)}</span>
                    <span className="w-36 truncate text-right text-xs text-muted-foreground">{w.location}</span>
                  </div>
                ))}
              </div>
            )}
          </BoardGroup>

          <BoardGroup title="Workload by Member" color="#579bfc" count={workload.length}>
            <div className="p-3">
              <div className="mb-3 flex gap-4 text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5"><span className="size-3 rounded-sm" style={{ background: OPEN_COLOR }} />Open, on time</span>
                <span className="flex items-center gap-1.5"><span className="size-3 rounded-sm" style={{ background: OVERDUE_COLOR }} />⚠ Overdue</span>
              </div>
              {workload.length === 0 ? <EmptyState text="No open tasks" /> : (
                <div className="space-y-2">
                  {workload.map((w) => (
                    <Tip key={w.id} title={`${profileName(w.id)}: ${w.open} open on time, ${w.overdue} overdue`}>
                      <div className="grid grid-cols-[160px_1fr_32px] items-center gap-2">
                        <Person name={profileName(w.id)} size={24} />
                        <div className="flex h-3.5 gap-0.5">
                          {w.open > 0 && <div className={cn('h-full', w.overdue ? 'rounded-l' : 'rounded')} style={{ width: `${(w.open / maxLoad) * 100}%`, background: OPEN_COLOR }} />}
                          {w.overdue > 0 && <div className={cn('h-full', w.open ? 'rounded-r' : 'rounded')} style={{ width: `${(w.overdue / maxLoad) * 100}%`, background: OVERDUE_COLOR }} />}
                        </div>
                        <span className="text-right text-sm font-semibold">{w.total}</span>
                      </div>
                    </Tip>
                  ))}
                </div>
              )}
            </div>
          </BoardGroup>

          <BoardGroup title="Active Projects" color="#00c875" count={active.length}>
            <div className="divide-y divide-grid">
              {active.map((p) => (
                <button key={p.id} type="button" onClick={() => router.push(`/projects/${p.id}`)} className="grid w-full grid-cols-[16px_1fr_60px] items-center gap-2 px-3 py-2 text-left hover:bg-muted">
                  <HealthDot value={p.health} />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold">{p.project_code}</span>
                    <span className="block truncate text-xs text-muted-foreground">{p.project_name}</span>
                  </span>
                  <span className="text-right text-sm font-semibold">{Math.round(p.progress)}%</span>
                </button>
              ))}
              {active.length === 0 && <EmptyState text="No active projects" />}
            </div>
          </BoardGroup>
        </div>
      </div>
    </>
  );
}
