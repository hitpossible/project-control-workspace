'use client';

import { Plus } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { useApp } from '@/components/AppProvider';
import { BoardGroup, EmptyState, PageHeader, Person, PriorityChip, SearchBox, SelectField, StatusChip } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { REQUEST_STATUSES } from '@/lib/constants';
import { fmtDate } from '@/lib/format';
import { supabaseBrowser } from '@/lib/supabase/client';
import type { ApprovalStep, ProjectRequest } from '@/lib/types';
import { cn } from '@/lib/utils';

const GROUPS = [
  { title: 'In approval', color: '#fdab3d', statuses: ['submitted', 'waiting_requestor_approval', 'waiting_system_review', 'need_more_information', 'waiting_authority_approval'] },
  { title: 'Approved — ready to convert', color: '#00c875', statuses: ['approved'] },
  { title: 'Drafts', color: '#579bfc', statuses: ['draft'] },
  { title: 'Converted to project', color: '#037f4c', statuses: ['converted'] },
  { title: 'Closed', color: '#757575', statuses: ['rejected', 'cancelled'] },
];

export default function RequestsPage() {
  const supabase = supabaseBrowser();
  const router = useRouter();
  const { me, isStaff } = useApp();
  const [rows, setRows] = useState<ProjectRequest[]>([]);
  const [steps, setSteps] = useState<ApprovalStep[]>([]);
  const [tab, setTab] = useState<'action' | 'mine' | 'all'>('mine');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');

  useEffect(() => {
    supabase.from('project_requests').select('*').order('created_at', { ascending: false }).then(({ data }) => setRows(data ?? []));
    supabase.from('approval_steps').select('*').eq('status', 'waiting').then(({ data }) => setSteps(data ?? []));
  }, [supabase]);

  const myActionIds = useMemo(() => new Set(
    steps.filter((s) => (s.approver_id ? s.approver_id === me?.id : me?.roles.includes(s.approver_role as never))).map((s) => s.request_id),
  ), [steps, me]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- default tab once data is known
    if (myActionIds.size > 0) setTab('action');
  }, [myActionIds.size]);

  const list = rows.filter((r) => {
    if (tab === 'mine' && r.requestor_id !== me?.id) return false;
    if (tab === 'action' && !myActionIds.has(r.id)) return false;
    if (status && r.status !== status) return false;
    const s = q.toLowerCase();
    return !s || [r.request_no, r.project_name, r.req_full_name, r.req_department].some((x) => x?.toLowerCase().includes(s));
  });

  return (
    <>
      <PageHeader
        title="Project Requests"
        subtitle="Request → Requestor Approval → System Service Review → Authority Approval → Controlled Project"
        actions={<Button asChild><Link href="/requests/new"><Plus /> New Request</Link></Button>}
      />
      <div className="mb-6 flex flex-wrap items-center gap-3 border-b border-grid">
        <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)} className="flex-1">
          <TabsList variant="line">
            <TabsTrigger value="action" className="px-3">
              Waiting My Action
              {myActionIds.size > 0 && <span className="ml-1 rounded-full bg-[#e2445c] px-1.5 text-[11px] font-semibold text-white">{myActionIds.size}</span>}
            </TabsTrigger>
            <TabsTrigger value="mine" className="px-3">My Requests</TabsTrigger>
            {(isStaff || rows.some((r) => r.requestor_id !== me?.id)) && <TabsTrigger value="all" className="px-3">All Visible</TabsTrigger>}
          </TabsList>
        </Tabs>
        <SearchBox value={q} onChange={setQ} className="mb-2 w-56" />
        <SelectField className="mb-2 w-56" value={status} allowEmpty placeholder="All statuses" onChange={setStatus} options={REQUEST_STATUSES} />
      </div>
      {list.length === 0 && <EmptyState text="No requests" />}
      {GROUPS.map((g) => {
        const items = list.filter((r) => g.statuses.includes(r.status));
        if (!items.length) return null;
        return (
          <BoardGroup key={g.title} title={g.title} color={g.color} count={items.length} defaultOpen={g.title !== 'Closed'}>
            <Table className="board-table">
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-72 text-left">Request</TableHead>
                  <TableHead>Requestor</TableHead>
                  <TableHead>Department</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>Submitted</TableHead>
                  <TableHead>Required</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((r) => (
                  <TableRow key={r.id} className={cn('cursor-pointer', myActionIds.has(r.id) && 'bg-[#fff6e5]')} onClick={() => router.push(`/requests/${r.id}`)}>
                    <TableCell>
                      <div>{r.project_name}</div>
                      <div className="text-xs text-muted-foreground">
                        {r.request_no ?? 'Draft'}
                        {myActionIds.has(r.id) && <span className="font-semibold text-[#d97706]"> · waiting for you</span>}
                      </div>
                    </TableCell>
                    <TableCell><Person name={r.req_full_name} /></TableCell>
                    <TableCell className="text-center">{r.req_department}</TableCell>
                    <TableCell className="p-1"><PriorityChip value={r.priority} fullWidth /></TableCell>
                    <TableCell className="text-center">{fmtDate(r.date_submitted)}</TableCell>
                    <TableCell className="text-center">{fmtDate(r.date_required)}</TableCell>
                    <TableCell className="min-w-52 p-1"><StatusChip list={REQUEST_STATUSES} value={r.status} fullWidth /></TableCell>
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
