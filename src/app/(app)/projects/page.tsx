'use client';

import dayjs from 'dayjs';
import { Download, TriangleAlert } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { BoardGroup, EmptyState, HealthDot, PageHeader, Person, PriorityChip, ProgressBar, SearchBox, SelectField, StatusChip, TimelinePill, Tip } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { PROJECT_STATUSES } from '@/lib/constants';
import { exportProjectListExcel } from '@/lib/exportExcel';
import { fmtDate } from '@/lib/format';
import { supabaseBrowser } from '@/lib/supabase/client';
import type { ProjectView } from '@/lib/types';
import { cn } from '@/lib/utils';

const GROUPS = [
  { key: 'active', title: 'Active', color: '#579bfc', statuses: ['in_progress', 'waiting', 'on_hold', 'at_risk', 'delayed'] },
  { key: 'planning', title: 'Planning', color: '#a25ddc', statuses: ['draft', 'planning'] },
  { key: 'done', title: 'Done', color: '#00c875', statuses: ['completed'] },
  { key: 'cancelled', title: 'Cancelled', color: '#757575', statuses: ['cancelled'] },
];

function ProjectList() {
  const supabase = supabaseBrowser();
  const router = useRouter();
  const params = useSearchParams();
  const [rows, setRows] = useState<ProjectView[]>([]);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState(params.get('status') ?? '');
  const [health, setHealth] = useState(params.get('health') ?? '');
  const [attention, setAttention] = useState(params.get('attention') === '1');

  useEffect(() => {
    supabase.from('v_projects').select('*').order('project_code', { ascending: false }).then(({ data }) => setRows((data ?? []) as ProjectView[]));
  }, [supabase]);

  const list = rows.filter((p) => {
    if (status === 'active' ? ['completed', 'cancelled'].includes(p.status) : status && p.status !== status) return false;
    if (health && p.health !== health) return false;
    if (attention && p.attention.length === 0) return false;
    const s = q.toLowerCase();
    return !s || [p.project_code, p.project_name, p.leader_name, p.requestor_department].some((x) => x?.toLowerCase().includes(s));
  });

  return (
    <>
      <PageHeader
        title="Projects"
        subtitle="Controlled Projects — one project, one control workspace"
        actions={<Button variant="outline" onClick={() => exportProjectListExcel(list, `Project_Status_${dayjs().format('YYYYMMDD')}.xlsx`)}><Download /> Export</Button>}
      />
      <div className="mb-6 flex flex-wrap items-center gap-3 border-b border-grid pb-4">
        <SearchBox value={q} onChange={setQ} className="w-60" />
        <SelectField className="w-44" value={status} allowEmpty placeholder="Status: All" onChange={setStatus}
          options={[{ value: 'active', label: 'Active (not closed)' }, ...PROJECT_STATUSES]} />
        <SelectField className="w-36" value={health} allowEmpty placeholder="Health: All" onChange={setHealth}
          options={[{ value: 'green', label: 'Green' }, { value: 'yellow', label: 'Yellow' }, { value: 'red', label: 'Red' }]} />
        <label className="flex items-center gap-2 text-sm"><Checkbox checked={attention} onCheckedChange={(c) => setAttention(!!c)} /> Need attention only</label>
      </div>

      {list.length === 0 && <EmptyState text="No projects" />}
      {GROUPS.map((g) => {
        const items = list.filter((p) => g.statuses.includes(p.status));
        if (!items.length) return null;
        return (
          <BoardGroup key={g.key} title={g.title} color={g.color} count={items.length} defaultOpen={g.key !== 'cancelled'}>
            <Table className="board-table">
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-80 text-left">Project</TableHead>
                  <TableHead>Leader</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>Timeline</TableHead>
                  <TableHead>Forecast</TableHead>
                  <TableHead>Variance</TableHead>
                  <TableHead>Progress</TableHead>
                  <TableHead className="min-w-52">Next Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((p) => (
                  <TableRow key={p.id} className="cursor-pointer" onClick={() => router.push(`/projects/${p.id}`)}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <HealthDot value={p.health} />
                        <div className="min-w-0">
                          <div className="truncate">{p.project_name}</div>
                          <div className="text-xs text-muted-foreground">{p.project_code} · {p.project_type_name} · {p.requestor_department ?? p.department}</div>
                        </div>
                        {p.attention.length > 0 && <Tip title={p.attention.join(' · ')}><TriangleAlert className="ml-auto size-4 shrink-0 text-[#fdab3d]" /></Tip>}
                      </div>
                    </TableCell>
                    <TableCell className="text-center"><Person name={p.leader_name} showName={false} /></TableCell>
                    <TableCell className="min-w-32 p-1"><StatusChip list={PROJECT_STATUSES} value={p.status} fullWidth /></TableCell>
                    <TableCell className="p-1"><PriorityChip value={p.priority} fullWidth /></TableCell>
                    <TableCell><TimelinePill start={p.start_date} end={p.target_date} color={g.color} /></TableCell>
                    <TableCell className={cn('text-center', p.forecast_date && p.target_date && p.forecast_date > p.target_date && 'text-destructive')}>{fmtDate(p.forecast_date)}</TableCell>
                    <TableCell className={cn('text-center font-semibold', (p.schedule_variance ?? 0) > 0 ? 'text-destructive' : 'text-muted-foreground')}>
                      {p.schedule_variance == null ? '–' : `${p.schedule_variance > 0 ? '+' : ''}${p.schedule_variance}d`}
                    </TableCell>
                    <TableCell><ProgressBar value={p.progress} /></TableCell>
                    <TableCell className="whitespace-normal">{p.next_action}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </BoardGroup>
        );
      })}
    </>
  );
}

export default function ProjectsPage() {
  return (
    <Suspense>
      <ProjectList />
    </Suspense>
  );
}
