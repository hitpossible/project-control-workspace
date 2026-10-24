'use client';

import { Search } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';
import { useOptions } from '@/i18n/useOptions';
import { fmtDateTime } from '@/lib/format';
import { dbClient } from '@/lib/db/client';
import type { AuditLog } from '@/lib/types';
import { useApp } from './AppProvider';
import { EmptyState, entityKey } from './common';
import { Input } from './ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';

// table labels: enums.auditTable.<table_name>
const USER_FIELDS = new Set(['leader_id', 'pic_user_id', 'owner_id', 'reviewer_id', 'requestor_approver_id', 'authority_approver_id', 'proposed_leader_id', 'assigned_dev_id', 'tester_id', 'fix_owner_id', 'recovery_owner_id', 'recovery_reviewed_by', 'decided_by']);

/** audit_logs.table_name → entity type used by entityKey() */
const TABLE_ENTITY: Record<string, string> = {
  activities: 'activity', internal_tasks: 'task', bugs: 'bug', test_rounds: 'test_round', projects: 'project', project_requests: 'request',
};

/** History of a project, a request, or one row (`entity` — ids are per table, so the table is required) */
export default function AuditHistory({ projectId, requestId, entity, names }: {
  projectId?: number; requestId?: number; entity?: { table: string; id: number }; names?: Record<string, string>;
}) {
  const t = useTranslations('audit');
  const { text: enumText } = useOptions();
  const db = dbClient();
  const { profileName } = useApp();
  const [rows, setRows] = useState<AuditLog[] | null>(null);
  const [q, setQ] = useState('');

  const entityTable = entity?.table;
  const entityId = entity?.id;
  useEffect(() => {
    let query = db.from('audit_logs').select('*').order('created_at', { ascending: false }).limit(500);
    if (entityTable && entityId) query = query.eq('table_name', entityTable).eq('entity_id', entityId);
    else if (projectId) query = query.eq('project_id', projectId);
    else if (requestId) query = query.eq('request_id', requestId);
    query.then(({ data }) => setRows((data ?? []) as AuditLog[]));
    return () => setRows(null);
  }, [db, projectId, requestId, entityTable, entityId]);

  const val = (field: string | null, v: string | null) => {
    if (v == null || v === '') return '∅';
    if (field && USER_FIELDS.has(field)) return profileName(Number(v));
    return v;
  };

  const filtered = useMemo(() => {
    const s = q.toLowerCase();
    return (rows ?? []).filter((r) => !s || [r.field, r.old_value, r.new_value, enumText('auditTable', r.table_name), names?.[entityKey(TABLE_ENTITY[r.table_name] ?? r.table_name, r.entity_id)], profileName(r.user_id)]
      .some((x) => x?.toLowerCase().includes(s)));
  }, [rows, q, names, profileName, enumText]);

  return (
    <div>
      {!entity && (
        <div className="relative mb-3 max-w-80">
          <Search className="absolute top-2.5 left-2.5 size-4 text-muted-foreground" />
          <Input placeholder={t('filter')} value={q} onChange={(e) => setQ(e.target.value)} className="h-9 pl-8" />
        </div>
      )}
      {rows === null ? <EmptyState text={t('loading')} /> : filtered.length === 0 ? <EmptyState text={t('empty')} /> : (
        <Table className="board-table">
          <TableHeader>
            <TableRow>
              <TableHead>{t('col.when')}</TableHead>
              <TableHead>{t('col.who')}</TableHead>
              <TableHead>{t('col.item')}</TableHead>
              <TableHead>{t('col.field')}</TableHead>
              <TableHead>{t('col.from')}</TableHead>
              <TableHead>{t('col.to')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="whitespace-nowrap">{fmtDateTime(r.created_at)}</TableCell>
                <TableCell className="whitespace-nowrap">{r.user_id ? profileName(r.user_id) : t('system')}</TableCell>
                <TableCell className="whitespace-normal">
                  <span className="mr-1 rounded bg-secondary px-1.5 py-0.5 text-xs">{enumText('auditTable', r.table_name)}</span>
                  <span className="text-xs">{names?.[entityKey(TABLE_ENTITY[r.table_name] ?? r.table_name, r.entity_id)] ?? ''}</span>
                </TableCell>
                <TableCell>{r.action === 'update' ? r.field : <span className="rounded border px-1.5 text-xs">{enumText('auditAction', r.action)}</span>}</TableCell>
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
