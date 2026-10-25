'use client';

import dayjs from 'dayjs';
import { RefreshCw, TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { dispatchEmails, useApp } from '@/providers/AppProvider';
import { BoardGroup, HealthDot, Person, StatusChip } from '@/components/shared/labels';
import { EmptyState, PageHeader, StatCard } from '@/components/shared/layout';
import { Tip } from '@/components/shared/Tip';
import InsightList from '@/components/shared/InsightList';
import ManagementDashboard from '@/components/shared/ManagementDashboard';
import { BoardSkeleton, StatCardsSkeleton } from '@/components/shared/motion';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { canActOnStep } from '@/lib/approval';
import { useOptions } from '@/i18n/useOptions';
import { PROJECT_STATUSES, TASK_STATUSES, WORK_TYPES, optColor } from '@/lib/constants';
import { day, errMsg, fmtDate, isOverdue } from '@/lib/format';
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
  const t = useTranslations('home');
  const { label } = useOptions();
  const db = dbClient();
  const router = useRouter();
  const { me, profileName, notify, refreshUnread } = useApp();
  const [projects, setProjects] = useState<ProjectView[]>([]);
  const [tasks, setTasks] = useState<InternalTask[]>([]);
  const [steps, setSteps] = useState<ApprovalStep[]>([]);
  const [myRequests, setMyRequests] = useState<Set<number>>(new Set());
  const [pendingEvidence, setPendingEvidence] = useState(0);
  const [today, setToday] = useState<WorkforcePlan[]>([]);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    const [p, t, s, e, mine] = await Promise.all([
      db.from('v_projects').select('*').order('project_code'),
      db.from('internal_tasks').select('*').not('status', 'in', '(completed,cancelled)'),
      db.from('approval_steps').select('*').eq('status', 'waiting'),
      db.from('evidence').select('id', { count: 'exact', head: true }).eq('verification_status', 'pending').not('project_id', 'is', null),
      db.from('project_requests').select('id').eq('requestor_id', me?.id ?? 0),
    ]);
    setMyRequests(new Set(((mine.data ?? []) as { id: number }[]).map((r) => r.id)));
    setProjects((p.data ?? []) as ProjectView[]);
    setTasks((t.data ?? []) as InternalTask[]);
    setSteps((s.data ?? []) as ApprovalStep[]);
    setPendingEvidence(e.count ?? 0);
    setLoaded(true);
    const w = await db.from('workforce_plans').select('*').eq('work_date', dayjs().format('YYYY-MM-DD')).order('start_time');
    setToday((w.data ?? []) as WorkforcePlan[]);
  }, [db, me?.id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data fetch
    load();
  }, [load]);

  const active = projects.filter((p) => !['completed', 'cancelled'].includes(p.status));
  const attention = active.filter((p) => p.attention.length > 0 || p.health === 'red');
  const overdue = tasks.filter((x) => isOverdue(x.due_date, x.status));
  const upcoming = tasks.filter((x) => !isOverdue(x.due_date, x.status) && dayjs(x.due_date).diff(dayjs(), 'day') <= 7).sort((a, b) => a.due_date.localeCompare(b.due_date));
  const myApprovals = steps.filter((s) => !myRequests.has(s.request_id) && canActOnStep(s, me));
  const projectCode = (id: number) => projects.find((p) => p.id === id)?.project_code ?? '';
  const count = (s: string) => projects.filter((p) => p.status === s).length;
  const sum = (k: 'open_bugs' | 'critical_bugs' | 'fix_overdue' | 'retest_pending' | 'retest_overdue' | 'evidence_missing') => active.reduce((a, p) => a + (p[k] ?? 0), 0);

  const workload = useMemo(() => {
    const m = new Map<number, { open: number; overdue: number }>();
    tasks.forEach((x) => {
      const w = m.get(x.owner_id) ?? { open: 0, overdue: 0 };
      if (isOverdue(x.due_date, x.status)) w.overdue++;
      else w.open++;
      m.set(x.owner_id, w);
    });
    return [...m.entries()].map(([id, w]) => ({ id, ...w, total: w.open + w.overdue })).sort((a, b) => b.total - a.total);
  }, [tasks]);
  const maxLoad = Math.max(1, ...workload.map((w) => w.total));

  const runScan = async () => {
    const { data, error } = await db.rpc('trigger_notification_scan');
    if (error) return notify(errMsg(error), 'error');
    notify(t('scanDone', { dueTomorrow: data.due_tomorrow, overdue: data.overdue, delayed: data.activities_delayed }), 'info');
    dispatchEmails();
    refreshUnread();
    load();
  };

  const stats = [
    { l: t('stat.total'), v: projects.length, c: '#0073ea', q: '' },
    { l: t('stat.inProgress'), v: count('in_progress'), c: '#fdab3d', q: '?status=in_progress' },
    { l: t('stat.planningWaiting'), v: count('planning') + count('waiting') + count('on_hold'), c: '#a25ddc', q: '?status=active' },
    { l: t('stat.delayed'), v: count('delayed'), c: '#e2445c', q: '?status=delayed' },
    { l: t('stat.atRisk'), v: count('at_risk'), c: '#ff642e', q: '?status=at_risk' },
    { l: t('stat.done'), v: count('completed'), c: '#00c875', q: '?status=completed' },
  ];

  return (
    <>
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle', { date: day().format('dddd DD MMMM YYYY') })}
        actions={<Tip title={t('scanTip')}><Button variant="outline" onClick={runScan}><RefreshCw /> {t('scan')}</Button></Tip>}
      />

      {myApprovals.length > 0 && (
        <Alert className="mb-4 border-[#fdab3d] bg-[#fff6e5]">
          <TriangleAlert />
          <AlertDescription className="flex items-center gap-3">
            <span>{t.rich('approvalsWaiting', { count: myApprovals.length, b: (c) => <b>{c}</b> })}</span>
            <Button asChild size="sm" variant="outline" className="ml-auto"><Link href="/requests">{t('open')}</Link></Button>
          </AlertDescription>
        </Alert>
      )}

      {!loaded ? (
        <>
          <StatCardsSkeleton className="mb-3" />
          <StatCardsSkeleton count={5} className="mb-6 lg:grid-cols-5" />
          <div className="grid grid-cols-12 gap-5">
            <div className="col-span-12 xl:col-span-7"><BoardSkeleton groups={2} rows={4} /></div>
            <div className="col-span-12 xl:col-span-5"><BoardSkeleton groups={2} rows={4} cols={2} /></div>
          </div>
        </>
      ) : <>
      <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {stats.map((s) => <StatCard key={s.l} label={s.l} value={s.v} color={s.c} onClick={() => router.push(`/projects${s.q}`)} />)}
      </div>
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard label={t('stat.overdueTasks')} value={overdue.length} color={OVERDUE_COLOR} hint={t('stat.openTasks', { count: tasks.length })} onClick={() => router.push('/my-tasks?scope=all&filter=overdue')} />
        <StatCard label={t('stat.needAttention')} value={attention.length} color="#ff642e" onClick={() => router.push('/projects?attention=1')} />
        <StatCard label={t('stat.retestPending')} value={sum('retest_pending')} color="#a25ddc" hint={t('stat.overdue', { count: sum('retest_overdue') })} />
        <StatCard label={t('stat.evidenceMissing')} value={sum('evidence_missing')} color="#784bd1" hint={t('stat.pendingReview', { count: pendingEvidence })} onClick={() => router.push('/projects?attention=1')} />
        <StatCard label={t('stat.bugs')} value={<>{sum('open_bugs')}<span className="text-lg text-[#bb3354]"> / {sum('critical_bugs')}</span></>} color="#e2445c"
          hint={t('stat.fixOverdue', { count: sum('fix_overdue') })} />
      </div>

      <div className="grid grid-cols-12 gap-5">
        <div className="col-span-12 xl:col-span-7">
          <BoardGroup title={<span className="inline-flex items-center gap-1.5"><TriangleAlert className="size-4" /> {t('attention.title')}</span>} color="#e2445c" count={attention.length}>
            {attention.length === 0 ? <EmptyState done text={t('attention.empty')} /> : (
              <Table className="board-table">
                <TableBody>
                  {attention.map((p) => (
                    <TableRow key={p.id} className="cursor-pointer" onClick={() => router.push(`/projects/${p.id}`)}>
                      <TableCell className="w-8 text-center"><HealthDot value={p.health} /></TableCell>
                      <TableCell className="whitespace-normal">
                        <div><b>{p.project_code}</b> {p.project_name}</div>
                        <div className="text-xs text-destructive">{p.attention.join(' · ') || t('attention.healthRed')}</div>
                      </TableCell>
                      <TableCell className="w-32 p-1"><StatusChip list={PROJECT_STATUSES} value={p.status} fullWidth /></TableCell>
                      <TableCell className="w-12 text-center"><Person name={p.leader_name} showName={false} /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </BoardGroup>

          <BoardGroup title={t('due.title')} color="#fdab3d" count={Math.min(15, overdue.length + upcoming.length)}>
            {overdue.length + upcoming.length === 0 ? <EmptyState done text={t('due.empty')} /> : (
              <Table className="board-table">
                <TableHeader><TableRow><TableHead className="text-left">{t('due.task')}</TableHead><TableHead>{t('due.project')}</TableHead><TableHead>{t('due.owner')}</TableHead><TableHead>{t('due.status')}</TableHead><TableHead>{t('due.due')}</TableHead></TableRow></TableHeader>
                <TableBody>
                  {[...overdue.sort((a, b) => a.due_date.localeCompare(b.due_date)), ...upcoming].slice(0, 15).map((x) => {
                    const od = isOverdue(x.due_date, x.status);
                    return (
                      <TableRow key={x.id} className={cn('cursor-pointer', od && 'bg-[#fff1f0] hover:bg-[#ffe5e3]')} onClick={() => router.push(`/projects/${x.project_id}?tab=internal&task=${x.id}`)}>
                        <TableCell className="min-w-56 whitespace-normal">{x.name}<span className="ml-1 text-xs text-muted-foreground/70">{x.task_no}</span></TableCell>
                        <TableCell className="text-center">{projectCode(x.project_id)}</TableCell>
                        <TableCell><Person name={profileName(x.owner_id)} /></TableCell>
                        <TableCell className="min-w-32 p-1"><StatusChip list={TASK_STATUSES} value={x.status} fullWidth /></TableCell>
                        <TableCell className={cn('text-center font-semibold', od && 'text-destructive')}>{od && '⚠ '}{fmtDate(x.due_date)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </BoardGroup>
        </div>

        <div className="col-span-12 xl:col-span-5">
          <BoardGroup title={t('insights')} color="#784bd1" actions={<Link href="/insights" className="text-xs text-primary">{t('viewAll')}</Link>}>
            <InsightList limit={6} />
          </BoardGroup>

          <BoardGroup title={t('today.title')} color="#66ccff" count={today.length} actions={<Link href="/workforce" className="text-xs text-primary">{t('today.link')}</Link>}>
            {today.length === 0 ? <EmptyState text={t('today.empty')} /> : (
              <div className="divide-y divide-grid">
                {today.filter((w, i, arr) => arr.findIndex((x) => x.user_id === w.user_id) === i).map((w) => (
                  <div key={w.id} className="flex items-center gap-2 px-3 py-1.5">
                    <Person name={profileName(w.user_id)} size={24} />
                    <span className="ml-auto rounded px-1.5 py-0.5 text-[11px] text-white" style={{ background: optColor(WORK_TYPES, w.work_type) }}>{label(WORK_TYPES, w.work_type)}</span>
                    <span className="w-36 truncate text-right text-xs text-muted-foreground">{w.location}</span>
                  </div>
                ))}
              </div>
            )}
          </BoardGroup>

          <BoardGroup title={t('workload.title')} color="#579bfc" count={workload.length}>
            <div className="p-3">
              <div className="mb-3 flex gap-4 text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5"><span className="size-3 rounded-sm" style={{ background: OPEN_COLOR }} />{t('workload.open')}</span>
                <span className="flex items-center gap-1.5"><span className="size-3 rounded-sm" style={{ background: OVERDUE_COLOR }} />⚠ {t('workload.overdue')}</span>
              </div>
              {workload.length === 0 ? <EmptyState text={t('workload.empty')} /> : (
                <div className="space-y-2">
                  {workload.map((w, i) => (
                    <Tip key={w.id} title={t('workload.tip', { name: profileName(w.id), open: w.open, overdue: w.overdue })}>
                      <div className="grid grid-cols-[160px_1fr_32px] items-center gap-2">
                        <Person name={profileName(w.id)} size={24} />
                        <div className="motion-grow-x flex h-3.5 origin-left gap-0.5" style={{ animationDelay: `${Math.min(i, 12) * 40}ms` }}>
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

          <BoardGroup title={t('active.title')} color="#00c875" count={active.length}>
            <div className="divide-y divide-grid">
              {active.map((p) => (
                <button key={p.id} type="button" onClick={() => router.push(`/projects/${p.id}`)} className="group/row grid w-full grid-cols-[16px_1fr_60px] items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-muted active:bg-selected/60">
                  <HealthDot value={p.health} />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold">{p.project_code}</span>
                    <span className="block truncate text-xs text-muted-foreground">{p.project_name}</span>
                  </span>
                  <span className="text-right text-sm font-semibold transition-transform group-hover/row:-translate-x-0.5">{Math.round(p.progress)}%</span>
                </button>
              ))}
              {active.length === 0 && <EmptyState text={t('active.empty')} />}
            </div>
          </BoardGroup>
        </div>
      </div>
      </>}
    </>
  );
}
