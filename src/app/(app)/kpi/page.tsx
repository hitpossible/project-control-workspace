'use client';

import { Camera, Download, Info } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useApp } from '@/components/AppProvider';
import { DivergingBarChart, HBarChart, Sparkline, StackBar } from '@/components/charts';
import { BoardGroup, EmptyState, HealthDot, PageHeader, PeriodPicker, Person, ProgressBar, Section, StatCard, StatusChip, Tip, periodFor, type Period } from '@/components/common';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PROJECT_STATUSES } from '@/lib/constants';
import { exportKpiExcel } from '@/lib/exportExcel';
import { errMsg } from '@/lib/format';
import { dbClient } from '@/lib/db/client';
import type { KpiIndividual, KpiProject, KpiSnapshot, KpiTeam } from '@/lib/types';
import { cn } from '@/lib/utils';

const pct = (v: number | null | undefined) => (v == null ? '–' : `${v}%`);
const rateColor = (v: number | null | undefined, good = 80, ok = 60) => (v == null ? '#c4c4c4' : v >= good ? '#00c875' : v >= ok ? '#fdab3d' : '#e2445c');

export default function KpiPage() {
  const db = dbClient();
  const router = useRouter();
  const { hasRole, isStaff, notify } = useApp();
  const [period, setPeriod] = useState<Period>(() => periodFor('last_90'));
  const [team, setTeam] = useState<KpiTeam | null>(null);
  const [projects, setProjects] = useState<KpiProject[]>([]);
  const [people, setPeople] = useState<KpiIndividual[]>([]);
  const [snaps, setSnaps] = useState<KpiSnapshot[]>([]);
  const [excused, setExcused] = useState<string[]>([]);
  const canAll = hasRole('project_leader', 'supervisor', 'manager');
  const canTeam = isStaff || hasRole('management_view');
  const [picked, setTab] = useState('');
  const tab = picked || (canTeam ? 'team' : 'individual');

  const load = useCallback(async () => {
    const [t, p, i, s, e] = await Promise.all([
      canTeam ? db.rpc('kpi_team', { p_from: period.from, p_to: period.to }) : Promise.resolve({ data: null, error: null }),
      db.rpc('kpi_projects'),
      isStaff ? db.rpc('kpi_individual', { p_from: period.from, p_to: period.to }) : Promise.resolve({ data: [], error: null }),
      db.from('project_kpi_snapshots').select('*').order('snapshot_date'),
      db.from('app_settings').select('value').eq('key', 'kpi_excluded_delay_categories').maybeSingle(),
    ]);
    const err = t.error ?? p.error ?? i.error;
    if (err) notify(errMsg(err), 'error');
    setTeam((t.data ?? null) as KpiTeam | null);
    setProjects((p.data ?? []) as KpiProject[]);
    setPeople((i.data ?? []) as KpiIndividual[]);
    setSnaps((s.data ?? []) as KpiSnapshot[]);
    setExcused((e.data?.value as string[]) ?? []);
  }, [db, period.from, period.to, canTeam, isStaff, notify]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data fetch
    load();
  }, [load]);

  const active = projects.filter((p) => !['completed', 'cancelled'].includes(p.status));
  const statusParts = useMemo(() => PROJECT_STATUSES.map((s) => ({ key: s.value, label: s.label, color: s.color!, value: projects.filter((p) => p.status === s.value).length })), [projects]);
  const trend = (id: string, k: 'progress' | 'open_bugs' | 'schedule_variance') => snaps.filter((s) => s.project_id === id).map((s) => Number(s[k] ?? 0));

  return (
    <>
      <PageHeader
        title="KPI"
        subtitle="Calculated from workspace data — no manual collection (PRD §23)"
        actions={<>
          {canAll && <Button variant="outline" onClick={async () => {
            const { data, error } = await db.rpc('trigger_kpi_snapshot');
            if (error) return notify(errMsg(error), 'error');
            notify(`KPI snapshot saved for ${data} project(s) (also runs weekly)`);
            load();
          }}><Camera /> Snapshot</Button>}
          <Button variant="outline" onClick={() => exportKpiExcel({ from: period.from, to: period.to, team, projects, people })}><Download /> Export Excel</Button>
        </>}
      />
      <div className="mb-5 flex flex-wrap items-end gap-4 border-b border-grid pb-4">
        <PeriodPicker value={period} onChange={setPeriod} />
        <Tabs value={tab} onValueChange={setTab} className="ml-auto">
          <TabsList variant="line">
            {canTeam && <TabsTrigger value="team" className="px-3">Team KPI</TabsTrigger>}
            <TabsTrigger value="projects" className="px-3">Project KPI</TabsTrigger>
            {isStaff && <TabsTrigger value="individual" className="px-3">{canAll ? 'Individual KPI' : 'My KPI'}</TabsTrigger>}
          </TabsList>
        </Tabs>
      </div>

      {tab === 'team' && team && (
        <>
          <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
            <StatCard label="Projects in period" value={team.total_projects} hint={`${team.completed_projects} completed`} />
            <StatCard label="On-time completion" value={pct(team.on_time_rate)} color={rateColor(team.on_time_rate)} hint="Completed ≤ first baseline target" />
            <StatCard label="Delayed / At risk" value={`${team.delayed_projects} / ${team.at_risk_projects}`} color="#e2445c" />
            <StatCard label="Avg schedule variance" value={team.avg_schedule_variance == null ? '–' : `${team.avg_schedule_variance > 0 ? '+' : ''}${team.avg_schedule_variance}d`} color={(team.avg_schedule_variance ?? 0) > 0 ? '#e2445c' : '#00c875'} />
            <StatCard label="Avg waiting days" value={team.avg_waiting_days ?? '–'} color="#ffcb00" hint="Activities in Waiting" />
            <StatCard label="Evidence completion" value={pct(team.evidence_completion_rate)} color={rateColor(team.evidence_completion_rate)} />
            {isStaff && <StatCard label="Overdue tasks (now)" value={team.overdue_tasks ?? '–'} color="#e2445c" />}
            {isStaff && <StatCard label="Task on-time rate" value={pct(team.task_on_time_rate)} color={rateColor(team.task_on_time_rate)} hint={`${team.tasks_completed ?? 0} tasks completed`} />}
            <StatCard label="Bugs reported / closed" value={`${team.bugs_reported} / ${team.bugs_closed}`} color="#a25ddc" />
            <StatCard label="Avg bug resolution" value={team.avg_bug_resolution_days == null ? '–' : `${team.avg_bug_resolution_days}d`} color="#784bd1" />
            <StatCard label="Retest pass rate" value={pct(team.retest_pass_rate)} color={rateColor(team.retest_pass_rate)} />
          </div>
          <div className="grid grid-cols-12 gap-4">
            <Section title="Projects by status" className="col-span-12 xl:col-span-6"><StackBar parts={statusParts} /></Section>
            <Section title="Schedule variance (forecast − baseline)" className="col-span-12 xl:col-span-6">
              <DivergingBarChart rows={active.map((p) => ({ key: p.project_id, label: p.project_code, value: p.schedule_variance }))} />
            </Section>
            <Section title="Evidence completion by project" className="col-span-12 xl:col-span-6">
              <HBarChart max={100} suffix="%" rows={active.map((p) => ({ key: p.project_id, label: p.project_code, value: p.evidence_completion, color: rateColor(p.evidence_completion), hint: `${p.evidence_done}/${p.evidence_total} mandatory items` }))} />
            </Section>
            <Section title="Open bugs by project" className="col-span-12 xl:col-span-6">
              <HBarChart rows={active.map((p) => ({ key: p.project_id, label: p.project_code, value: p.open_bugs, color: '#e2445c' }))} />
            </Section>
          </div>
        </>
      )}

      {tab === 'projects' && (
        <BoardGroup title="Project KPI" color="#579bfc" count={projects.length}>
          <Table className="board-table">
            <TableHeader>
              <TableRow>
                <TableHead className="text-left">Project</TableHead><TableHead>Status</TableHead><TableHead>Progress</TableHead>
                <TableHead>Schedule Var.</TableHead><TableHead>Reschedules</TableHead><TableHead>Waiting Days</TableHead>
                {isStaff && <TableHead>Overdue Tasks</TableHead>}{isStaff && <TableHead>Task On-time</TableHead>}
                <TableHead>Evidence</TableHead><TableHead>Open Bugs</TableHead><TableHead>Bug Closure</TableHead><TableHead>Retest Pass</TableHead><TableHead>Trend</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {projects.map((p) => (
                <TableRow key={p.project_id} className="cursor-pointer" onClick={() => router.push(`/projects/${p.project_id}`)}>
                  <TableCell className="min-w-64"><div className="flex items-center gap-2"><HealthDot value={p.health} /><div><div>{p.project_name}</div><div className="text-xs text-muted-foreground">{p.project_code} · {p.leader_name}</div></div></div></TableCell>
                  <TableCell className="min-w-28 p-1"><StatusChip list={PROJECT_STATUSES} value={p.status} fullWidth /></TableCell>
                  <TableCell><ProgressBar value={p.progress} /></TableCell>
                  <TableCell className={cn('text-center font-semibold', (p.schedule_variance ?? 0) > 0 && 'text-destructive')}>{p.schedule_variance == null ? '–' : `${p.schedule_variance > 0 ? '+' : ''}${p.schedule_variance}d`}</TableCell>
                  <TableCell className="text-center">{p.reschedules}</TableCell>
                  <TableCell className="text-center">{p.waiting_days}</TableCell>
                  {isStaff && <TableCell className={cn('text-center', (p.overdue_tasks ?? 0) > 0 && 'font-semibold text-destructive')}>{p.overdue_tasks ?? '–'}</TableCell>}
                  {isStaff && <TableCell className="text-center">{pct(p.tasks_on_time_rate)}</TableCell>}
                  <TableCell className="text-center"><span style={{ color: rateColor(p.evidence_completion) }} className="font-semibold">{pct(p.evidence_completion)}</span><div className="text-[11px] text-muted-foreground">{p.evidence_done}/{p.evidence_total}</div></TableCell>
                  <TableCell className={cn('text-center', p.open_bugs > 0 && 'font-semibold text-destructive')}>{p.open_bugs}</TableCell>
                  <TableCell className="text-center">{pct(p.bug_closure_rate)}</TableCell>
                  <TableCell className="text-center">{pct(p.retest_pass_rate)}</TableCell>
                  <TableCell><Tip title="Progress trend from weekly KPI snapshots"><span><Sparkline values={trend(p.project_id, 'progress')} /></span></Tip></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {projects.length === 0 && <EmptyState text="No projects" />}
        </BoardGroup>
      )}

      {tab === 'individual' && isStaff && (
        <>
          <Alert className="mb-4 border-[#cce5ff] bg-[#f0f7ff]">
            <Info />
            <AlertDescription>
              Fair KPI: late tasks whose delay category is <b>{excused.join(', ') || '—'}</b> are excused (not counted against the person). Configure in Administration → KPI Settings.
              {!canAll && ' You can see your own KPI only.'}
            </AlertDescription>
          </Alert>
          {canAll && people.length > 0 && (
            <Section title="On-time rate by person (completed tasks in period)">
              <HBarChart max={100} suffix="%" rows={people.filter((x) => x.completed_tasks > 0).map((x) => ({
                key: x.user_id, label: <Person name={x.full_name} size={20} />, value: x.on_time_rate, color: rateColor(x.on_time_rate),
                hint: `${x.on_time_tasks} on time · ${x.late_tasks} late · ${x.excused_late} excused`,
              }))} emptyText="No completed tasks in this period" />
            </Section>
          )}
          <BoardGroup title={canAll ? 'Individual KPI' : 'My KPI'} color="#a25ddc" count={people.length}>
            <Table className="board-table">
              <TableHeader>
                <TableRow>
                  <TableHead className="text-left">Person</TableHead><TableHead>Assigned</TableHead><TableHead>Completed</TableHead><TableHead>On-time</TableHead>
                  <TableHead>Late / Excused</TableHead><TableHead>Avg Delay</TableHead><TableHead>Overdue</TableHead><TableHead>Open</TableHead>
                  <TableHead>Bugs Assigned</TableHead><TableHead>Fixes Ready</TableHead><TableHead>Avg Fix</TableHead><TableHead>1st-time Pass</TableHead>
                  <TableHead>Evidence</TableHead><TableHead>Retests</TableHead><TableHead>Retest TAT</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {people.map((x) => (
                  <TableRow key={x.user_id}>
                    <TableCell><Person name={x.full_name} /></TableCell>
                    <TableCell className="text-center">{x.assigned_tasks}</TableCell>
                    <TableCell className="text-center">{x.completed_tasks}</TableCell>
                    <TableCell className="text-center font-semibold" style={{ color: rateColor(x.on_time_rate) }}>{pct(x.on_time_rate)}</TableCell>
                    <TableCell className="text-center">{x.late_tasks} / <span className="text-muted-foreground">{x.excused_late}</span></TableCell>
                    <TableCell className="text-center">{x.avg_delay_days == null ? '–' : `${x.avg_delay_days}d`}</TableCell>
                    <TableCell className={cn('text-center', x.overdue_tasks > 0 && 'font-semibold text-destructive')}>{x.overdue_tasks}</TableCell>
                    <TableCell className="text-center">{x.open_tasks}</TableCell>
                    <TableCell className="text-center">{x.bugs_assigned}</TableCell>
                    <TableCell className="text-center">{x.fixes_ready}</TableCell>
                    <TableCell className="text-center">{x.avg_fix_days == null ? '–' : `${x.avg_fix_days}d`}</TableCell>
                    <TableCell className="text-center">{pct(x.fix_first_time_pass_rate)}</TableCell>
                    <TableCell className="text-center">{pct(x.evidence_completion)}</TableCell>
                    <TableCell className="text-center">{x.retests_done}</TableCell>
                    <TableCell className="text-center">{x.avg_retest_turnaround_days == null ? '–' : `${x.avg_retest_turnaround_days}d`}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {people.length === 0 && <EmptyState text="No data" />}
          </BoardGroup>
        </>
      )}
    </>
  );
}
