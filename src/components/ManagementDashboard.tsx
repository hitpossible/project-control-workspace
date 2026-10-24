'use client';

import dayjs from 'dayjs';
import { Download, TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { PROJECT_STATUSES } from '@/lib/constants';
import { exportProjectListExcel } from '@/lib/exportExcel';
import { fmtDate } from '@/lib/format';
import { dbClient } from '@/lib/db/client';
import type { ProjectView } from '@/lib/types';
import { cn } from '@/lib/utils';
import InsightList from './InsightList';
import { BoardSkeleton, StatCardsSkeleton } from './motion';
import { BoardGroup, EmptyState, HealthDot, PageHeader, Person, ProgressBar, SelectField, StatCard, StatusChip } from './common';
import { Button } from './ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';

/** Management / User View — project-level data only (no internal technical detail) */
export default function ManagementDashboard() {
  const t = useTranslations('management');
  const tf = useTranslations('fields');
  const tc = useTranslations('common');
  const db = dbClient();
  const router = useRouter();
  const [rows, setRows] = useState<ProjectView[] | null>(null);
  const [dept, setDept] = useState('');

  useEffect(() => {
    // Explicit column list: Management view never reads internal fields
    db.from('v_projects')
      .select('id,project_code,project_name,leader_name,requestor_department,department,target_date,forecast_date,baseline_finish,schedule_variance,status,progress,health,next_action,remark,attention,project_type_name,priority')
      .order('project_code').then(({ data }) => setRows((data ?? []) as ProjectView[]));
  }, [db]);

  const all = rows ?? [];
  const depts = [...new Set(all.map((r) => r.requestor_department ?? r.department).filter(Boolean))] as string[];
  const list = all.filter((r) => !dept || (r.requestor_department ?? r.department) === dept);
  const active = list.filter((p) => !['completed', 'cancelled'].includes(p.status));
  const attention = active.filter((p) => p.attention.length > 0 || p.health === 'red');
  const count = (s: string) => list.filter((p) => p.status === s).length;

  return (
    <>
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        actions={<>
          <SelectField className="w-56" value={dept} allowEmpty placeholder={t('allDepartments')} onChange={setDept}
            options={depts.map((d) => ({ value: d, label: d }))} />
          <Button variant="outline" className="h-9" onClick={() => exportProjectListExcel(list, `Management_Report_${dayjs().format('YYYYMMDD')}.xlsx`)}><Download /> {tc('export')}</Button>
        </>}
      />
      {!rows ? (
        <>
          <StatCardsSkeleton className="mb-5 md:grid-cols-6" />
          <BoardSkeleton groups={2} rows={5} cols={6} />
        </>
      ) : <>
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-6">
        <StatCard label={t('stat.total')} value={list.length} />
        <StatCard label={t('stat.inProgress')} value={count('in_progress')} color="#fdab3d" />
        <StatCard label={t('stat.planningWaiting')} value={count('planning') + count('waiting') + count('on_hold')} color="#a25ddc" />
        <StatCard label={t('stat.delayedAtRisk')} value={count('delayed') + count('at_risk')} color="#e2445c" />
        <StatCard label={t('stat.done')} value={count('completed')} color="#00c875" />
        <StatCard label={t('stat.needAttention')} value={attention.length} color="#ff642e" />
      </div>

      {attention.length > 0 && (
        <BoardGroup title={<span className="inline-flex items-center gap-1.5"><TriangleAlert className="size-4" /> {t('attention')}</span>} color="#e2445c" count={attention.length}>
          <div className="divide-y divide-grid">
            {attention.map((p) => (
              <button key={p.id} type="button" onClick={() => router.push(`/projects/${p.id}`)} className="flex w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-muted active:bg-selected/60">
                <HealthDot value={p.health} />
                <span className="text-sm font-semibold">{p.project_code}</span>
                <span className="text-sm">{p.project_name}</span>
                <span className="ml-auto text-xs text-destructive">{p.attention.join(' · ') || t('healthRed')}</span>
              </button>
            ))}
          </div>
        </BoardGroup>
      )}

      <BoardGroup title={t('insights')} color="#784bd1">
        <InsightList limit={8} />
      </BoardGroup>

      <BoardGroup title={t('allProjects')} color="#579bfc" count={list.length}>
        <Table className="board-table">
          <TableHeader>
            <TableRow>
              <TableHead className="text-left">{tf('project')}</TableHead><TableHead>{tf('projectLeader')}</TableHead><TableHead>{tf('status')}</TableHead>
              <TableHead>{tf('requestorDept')}</TableHead><TableHead>{tf('targetDate')}</TableHead><TableHead>{tf('forecastDate')}</TableHead>
              <TableHead>{tf('progress')}</TableHead><TableHead>{tf('nextAction')}</TableHead>
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
        {list.length === 0 && <EmptyState text={t('empty')} />}
      </BoardGroup>
      </>}
    </>
  );
}
