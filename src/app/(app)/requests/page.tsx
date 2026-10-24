'use client';

import { Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { useApp } from '@/components/AppProvider';
import { BoardGroup, EmptyState, PageHeader, Person, PriorityChip, SearchBox, SelectField, StatusChip } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useDocumentTypes } from '@/components/useDocumentTypes';
import { canActOnStep, canConvertRequest } from '@/lib/approval';
import { useOptions } from '@/i18n/useOptions';
import { REQUEST_STATUSES } from '@/lib/constants';
import { fmtDate } from '@/lib/format';
import { dbClient } from '@/lib/db/client';
import type { ApprovalStep, ProjectRequest } from '@/lib/types';
import { cn } from '@/lib/utils';

/** titles: requests.group.<key> */
const GROUPS = [
  { key: 'inApproval', color: '#fdab3d', statuses: ['submitted', 'waiting_requestor_approval', 'waiting_system_review', 'need_more_information', 'waiting_authority_approval'] },
  { key: 'approved', color: '#00c875', statuses: ['approved'] },
  { key: 'drafts', color: '#579bfc', statuses: ['draft'] },
  { key: 'converted', color: '#037f4c', statuses: ['converted'] },
  { key: 'closed', color: '#757575', statuses: ['rejected', 'cancelled'] },
] as const;

export default function RequestsPage() {
  const t = useTranslations('requests');
  const tf = useTranslations('fields');
  const { options } = useOptions();
  const db = dbClient();
  const router = useRouter();
  const { me, isStaff } = useApp();
  const [rows, setRows] = useState<ProjectRequest[]>([]);
  const [steps, setSteps] = useState<ApprovalStep[]>([]);
  const [tab, setTab] = useState<'action' | 'mine' | 'all'>('mine');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [docType, setDocType] = useState('');
  const docTypes = useDocumentTypes();
  const docName = (id: number) => docTypes.find((d) => d.id === id)?.name ?? '';

  useEffect(() => {
    db.from('project_requests').select('*').order('created_at', { ascending: false }).then(({ data }) => setRows(data ?? []));
    db.from('approval_steps').select('*').eq('status', 'waiting').then(({ data }) => setSteps(data ?? []));
  }, [db]);

  const myActionIds = useMemo(() => {
    const requestor = new Map(rows.map((r) => [r.id, r.requestor_id]));
    // approval steps I can act on + approved requests I can convert to a Controlled Project
    return new Set([
      ...steps.filter((s) => canActOnStep(s, me, requestor.get(s.request_id))).map((s) => s.request_id),
      ...rows.filter((r) => canConvertRequest(r, me)).map((r) => r.id),
    ]);
  }, [rows, steps, me]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- default tab once data is known
    if (myActionIds.size > 0) setTab('action');
  }, [myActionIds.size]);

  const list = rows.filter((r) => {
    if (tab === 'mine' && r.requestor_id !== me?.id) return false;
    if (tab === 'action' && !myActionIds.has(r.id)) return false;
    if (status && r.status !== status) return false;
    if (docType && String(r.document_type_id) !== docType) return false;
    const s = q.toLowerCase();
    return !s || [r.request_no, r.project_name, r.req_full_name, r.req_department].some((x) => x?.toLowerCase().includes(s));
  });

  return (
    <>
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        actions={<Button asChild><Link href="/requests/new"><Plus /> {t('new')}</Link></Button>}
      />
      <div className="mb-6 flex flex-wrap items-center gap-3 border-b border-grid">
        <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)} className="flex-1">
          <TabsList variant="line">
            <TabsTrigger value="action" className="px-3">
              {t('tab.action')}
              {myActionIds.size > 0 && <span className="ml-1 rounded-full bg-[#e2445c] px-1.5 text-[11px] font-semibold text-white">{myActionIds.size}</span>}
            </TabsTrigger>
            <TabsTrigger value="mine" className="px-3">{t('tab.mine')}</TabsTrigger>
            {(isStaff || rows.some((r) => r.requestor_id !== me?.id)) && <TabsTrigger value="all" className="px-3">{t('tab.all')}</TabsTrigger>}
          </TabsList>
        </Tabs>
        <SearchBox value={q} onChange={setQ} className="mb-2 w-56" />
        {docTypes.length > 1 && (
          <SelectField className="mb-2 w-48" value={docType} allowEmpty placeholder={t('allDocTypes')} onChange={setDocType}
            options={docTypes.map((d) => ({ value: String(d.id), label: d.name }))} />
        )}
        <SelectField className="mb-2 w-56" value={status} allowEmpty placeholder={t('allStatuses')} onChange={setStatus} options={options(REQUEST_STATUSES)} />
      </div>
      {list.length === 0 && <EmptyState text={t('empty')} />}
      {GROUPS.map((g) => {
        const items = list.filter((r) => (g.statuses as readonly string[]).includes(r.status));
        if (!items.length) return null;
        return (
          <BoardGroup key={g.key} title={t(`group.${g.key}`)} color={g.color} count={items.length} defaultOpen={g.key !== 'closed'}>
            <Table className="board-table">
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-72 text-left">{tf('request')}</TableHead>
                  <TableHead>{tf('document')}</TableHead>
                  <TableHead>{tf('requestor')}</TableHead>
                  <TableHead>{tf('department')}</TableHead>
                  <TableHead>{tf('priority')}</TableHead>
                  <TableHead>{tf('submitted')}</TableHead>
                  <TableHead>{tf('required')}</TableHead>
                  <TableHead>{tf('status')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((r) => (
                  <TableRow key={r.id} className={cn('cursor-pointer', myActionIds.has(r.id) && 'bg-[#fff6e5]')} onClick={() => router.push(`/requests/${r.id}`)}>
                    <TableCell>
                      <div>{r.project_name}</div>
                      <div className="text-xs text-muted-foreground">
                        {r.request_no ?? t('draft')}
                        {myActionIds.has(r.id) && <span className="font-semibold text-[#d97706]"> · {r.status === 'approved' ? t('readyToConvert') : t('waitingForYou')}</span>}
                      </div>
                    </TableCell>
                    <TableCell className="text-center">{docName(r.document_type_id)}</TableCell>
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
