'use client';

import { Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { fmtDateTime } from '@/lib/format';
import { supabaseBrowser } from '@/lib/supabase/client';
import type { AuditLog } from '@/lib/types';
import { useApp } from './AppProvider';
import { EmptyState } from './common';
import { Input } from './ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';

const TABLE_LABEL: Record<string, string> = {
  projects: 'Project', activities: 'Activity', internal_tasks: 'Task', project_members: 'Team',
  evidence: 'Evidence', project_baselines: 'Baseline', project_requests: 'Request',
  test_rounds: 'Test Round', bugs: 'Bug', bug_fixes: 'Fix', retests: 'Retest', evidence_requirements: 'Checklist', baseline_revisions: 'Re-plan',
};

const USER_FIELDS = new Set(['leader_id', 'pic_user_id', 'owner_id', 'reviewer_id', 'requestor_approver_id', 'authority_approver_id', 'proposed_leader_id', 'assigned_dev_id', 'tester_id', 'fix_owner_id', 'recovery_owner_id', 'recovery_reviewed_by', 'decided_by']);

export default function AuditHistory({ projectId, requestId, entityId, names }: {
  projectId?: string; requestId?: string; entityId?: string; names?: Record<string, string>;
}) {
  const supabase = supabaseBrowser();
  const { profileName } = useApp();
  const [rows, setRows] = useState<AuditLog[] | null>(null);
  const [q, setQ] = useState('');

  useEffect(() => {
    let query = supabase.from('audit_logs').select('*').order('created_at', { ascending: false }).limit(500);
    if (entityId) query = query.eq('entity_id', entityId);
    else if (projectId) query = query.eq('project_id', projectId);
    else if (requestId) query = query.eq('request_id', requestId);
    query.then(({ data }) => setRows((data ?? []) as AuditLog[]));
    return () => setRows(null);
  }, [supabase, projectId, requestId, entityId]);

  const val = (field: string | null, v: string | null) => {
    if (v == null || v === '') return '∅';
    if (field && USER_FIELDS.has(field)) return profileName(v);
    return v;
  };

  const filtered = useMemo(() => {
    const s = q.toLowerCase();
    return (rows ?? []).filter((r) => !s || [r.field, r.old_value, r.new_value, TABLE_LABEL[r.table_name], names?.[r.entity_id ?? ''], profileName(r.user_id)]
      .some((x) => x?.toLowerCase().includes(s)));
  }, [rows, q, names, profileName]);

  return (
    <div>
      {!entityId && (
        <div className="relative mb-3 max-w-80">
          <Search className="absolute top-2.5 left-2.5 size-4 text-muted-foreground" />
          <Input placeholder="Filter history…" value={q} onChange={(e) => setQ(e.target.value)} className="h-9 pl-8" />
        </div>
      )}
      {rows === null ? <EmptyState text="Loading…" /> : filtered.length === 0 ? <EmptyState text="No history" /> : (
        <Table className="board-table">
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>Who</TableHead>
              <TableHead>Item</TableHead>
              <TableHead>Field</TableHead>
              <TableHead>From</TableHead>
              <TableHead>To</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="whitespace-nowrap">{fmtDateTime(r.created_at)}</TableCell>
                <TableCell className="whitespace-nowrap">{r.user_id ? profileName(r.user_id) : 'System'}</TableCell>
                <TableCell className="whitespace-normal">
                  <span className="mr-1 rounded bg-secondary px-1.5 py-0.5 text-xs">{TABLE_LABEL[r.table_name] ?? r.table_name}</span>
                  <span className="text-xs">{names?.[r.entity_id ?? ''] ?? ''}</span>
                </TableCell>
                <TableCell>{r.action === 'update' ? r.field : <span className="rounded border px-1.5 text-xs">{r.action}</span>}</TableCell>
                <TableCell className="max-w-64 whitespace-normal break-words text-muted-foreground">{r.action === 'update' ? val(r.field, r.old_value) : r.old_value}</TableCell>
                <TableCell className="max-w-64 whitespace-normal break-words font-medium">{r.action === 'update' ? val(r.field, r.new_value) : r.new_value}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
