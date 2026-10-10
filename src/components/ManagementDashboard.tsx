'use client';

import dayjs from 'dayjs';
import { Download, TriangleAlert } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { PROJECT_STATUSES } from '@/lib/constants';
import { exportProjectListExcel } from '@/lib/exportExcel';
import { fmtDate } from '@/lib/format';
import { supabaseBrowser } from '@/lib/supabase/client';
import type { ProjectView } from '@/lib/types';
import { cn } from '@/lib/utils';
import InsightList from './InsightList';
import { BoardGroup, EmptyState, HealthDot, PageHeader, Person, ProgressBar, SelectField, StatCard, StatusChip } from './common';
import { Button } from './ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';

/** Management / User View — project-level data only (no internal technical detail) */
export default function ManagementDashboard() {
  const supabase = supabaseBrowser();
  const router = useRouter();
  const [rows, setRows] = useState<ProjectView[]>([]);
  const [dept, setDept] = useState('');

  useEffect(() => {
    // Explicit column list: Management view never reads internal fields
    supabase.from('v_projects')
      .select('id,project_code,project_name,leader_name,requestor_department,department,target_date,forecast_date,baseline_finish,schedule_variance,status,progress,health,next_action,remark,attention,project_type_name,priority')
      .order('project_code').then(({ data }) => setRows((data ?? []) as ProjectView[]));
  }, [supabase]);

  const depts = [...new Set(rows.map((r) => r.requestor_department ?? r.department).filter(Boolean))] as string[];
  const list = rows.filter((r) => !dept || (r.requestor_department ?? r.department) === dept);
  const active = list.filter((p) => !['completed', 'cancelled'].includes(p.status));
  const attention = active.filter((p) => p.attention.length > 0 || p.health === 'red');
  const count = (s: string) => list.filter((p) => p.status === s).length;

  return (
    <>
      <PageHeader
        title="Management Dashboard"
        subtitle="Project status overview — high-level information for Management / User"
        actions={<>
          <SelectField className="w-56" value={dept} allowEmpty placeholder="All departments" onChange={setDept}
            options={depts.map((d) => ({ value: d, label: d }))} />
          <Button variant="outline" className="h-9" onClick={() => exportProjectListExcel(list, `Management_Report_${dayjs().format('YYYYMMDD')}.xlsx`)}><Download /> Export</Button>
        </>}
      />
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-6">
        <StatCard label="Total Projects" value={list.length} />
        <StatCard label="Working on it" value={count('in_progress')} color="#fdab3d" />
        <StatCard label="Planning / Waiting" value={count('planning') + count('waiting') + count('on_hold')} color="#a25ddc" />
        <StatCard label="Delayed / At Risk" value={count('delayed') + count('at_risk')} color="#e2445c" />
        <StatCard label="Done" value={count('completed')} color="#00c875" />
        <StatCard label="Need Attention" value={attention.length} color="#ff642e" />
      </div>

      {attention.length > 0 && (
        <BoardGroup title={<span className="inline-flex items-center gap-1.5"><TriangleAlert className="size-4" /> Projects Need Attention</span>} color="#e2445c" count={attention.length}>
          <div className="divide-y divide-grid">
            {attention.map((p) => (
              <button key={p.id} type="button" onClick={() => router.push(`/projects/${p.id}`)} className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-muted">
                <HealthDot value={p.health} />
                <span className="text-sm font-semibold">{p.project_code}</span>
                <span className="text-sm">{p.project_name}</span>
                <span className="ml-auto text-xs text-destructive">{p.attention.join(' · ') || 'Health RED'}</span>
              </button>
            ))}
          </div>
        </BoardGroup>
      )}

      <BoardGroup title="Smart Insights" color="#784bd1">
        <InsightList limit={8} />
      </BoardGroup>

      <BoardGroup title="All Projects" color="#579bfc" count={list.length}>
        <Table className="board-table">
          <TableHeader>
            <TableRow>
              <TableHead className="text-left">Project</TableHead><TableHead>Project Leader</TableHead><TableHead>Status</TableHead>
              <TableHead>Requestor Dept.</TableHead><TableHead>Target Date</TableHead><TableHead>Forecast Date</TableHead>
              <TableHead>Progress</TableHead><TableHead>Next Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.map((p) => {
              const late = p.forecast_date && p.target_date && p.forecast_date > p.target_date;
              return (
                <TableRow key={p.id} className="cursor-pointer" onClick={() => router.push(`/projects/${p.id}`)}>
                  <TableCell className="min-w-72 whitespace-normal">
                    <div className="flex items-center gap-2">
                      <HealthDot value={p.health} />
                      <div>
                        <div>{p.project_name}</div>
                        <div className="text-xs text-muted-foreground">{p.project_code}{p.remark && ` · ${p.remark}`}</div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell><Person name={p.leader_name} /></TableCell>
                  <TableCell className="min-w-32 p-1"><StatusChip list={PROJECT_STATUSES} value={p.status} fullWidth /></TableCell>
                  <TableCell className="text-center">{p.requestor_department ?? p.department}</TableCell>
                  <TableCell className="text-center">{fmtDate(p.target_date)}</TableCell>
                  <TableCell className={cn('text-center', late && 'font-semibold text-destructive')}>{fmtDate(p.forecast_date)}</TableCell>
                  <TableCell><ProgressBar value={p.progress} /></TableCell>
                  <TableCell className="min-w-56 whitespace-normal">{p.next_action}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        {list.length === 0 && <EmptyState text="No projects" />}
      </BoardGroup>
    </>
  );
}
