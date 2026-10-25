'use client';

import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { useApp } from '@/providers/AppProvider';
import { BoardGroup } from '@/components/shared/labels';
import { EmptyState, Section } from '@/components/shared/layout';
import { entityKey } from '@/lib/ids';
import EvidenceChecklist from './EvidenceChecklist';
import EvidencePanel from '@/components/shared/EvidencePanel';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useOptions } from '@/i18n/useOptions';
import { EVIDENCE_TYPES } from '@/lib/constants';
import { fmtDateTime } from '@/lib/format';
import { dbClient } from '@/lib/db/client';
import type { Evidence } from '@/lib/types';
import type { TabProps } from './types';

export default function EvidenceTab({ data, perm, names, reload }: TabProps & { names: Record<string, string> }) {
  const t = useTranslations('project.evidence');
  const { label: optLabel, text: enumText } = useOptions();
  const db = dbClient();
  const { profileName } = useApp();
  const [all, setAll] = useState<Evidence[]>([]);

  const load = useCallback(async () => {
    const or = data.project.request_id ? `project_id.eq.${data.project.id},request_id.eq.${data.project.request_id}` : `project_id.eq.${data.project.id}`;
    const { data: rows } = await db.from('evidence').select('*').or(or).order('uploaded_at', { ascending: false });
    setAll((rows ?? []) as Evidence[]);
  }, [db, data.project.id, data.project.request_id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data fetch
    load();
  }, [load]);

  const open = async (ev: Evidence) => {
    if (ev.url) return window.open(ev.url, '_blank', 'noopener');
    window.open(db.evidenceFileUrl(ev.id), '_blank', 'noopener');
  };

  return (
    <div>
      {perm.internal && <Section title={t('checklist')}>
        <p className="mb-2 text-xs text-muted-foreground">{t('checklistNote')}</p>
        <EvidenceChecklist
          projectId={data.project.id}
          requirements={data.requirements}
          evidence={data.evidence}
          canManage={perm.manage}
          entityOptions={[
            { value: data.project.id, label: t('entity.project'), type: 'project' },
            ...data.activities.map((a) => ({ value: a.id, label: t('entity.activity', { name: a.name }), type: 'activity' as const })),
            ...data.tasks.map((x) => ({ value: x.id, label: t('entity.task', { name: `${x.task_no} ${x.name}` }), type: 'task' as const })),
          ]}
          labelFor={(r) => r.entity_type === 'project' ? enumText('entityType', 'project') : names[entityKey(r.entity_type, r.entity_id)]}
          onChange={async () => { await reload(); load(); }}
        />
      </Section>}
      <Section title={t('projectLevel')}>
        <EvidencePanel entityType="project" entityId={data.project.id} projectId={data.project.id} canAdd={perm.internal} canVerify={perm.manage} allowPublicToggle
          requirements={data.requirements.filter((r) => r.entity_type === 'project')} onChange={async () => { await reload(); load(); }} />
      </Section>
      <p className="mb-3 text-sm text-muted-foreground">{t('boundNote')}</p>
      <BoardGroup title={t('all')} color="#00c875" count={all.length}>
        {all.length === 0 ? <EmptyState text={t('empty')} /> : (
          <Table className="board-table">
            <TableHeader>
              <TableRow><TableHead className="text-left">{t('col.boundTo')}</TableHead><TableHead className="text-left">{t('col.file')}</TableHead><TableHead>{t('col.type')}</TableHead><TableHead>{t('col.uploaded')}</TableHead><TableHead>{t('col.visibility')}</TableHead><TableHead>{t('col.verification')}</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {all.map((ev) => (
                <TableRow key={ev.id}>
                  <TableCell><span className="mr-1 rounded bg-secondary px-1.5 py-0.5 text-xs">{enumText('entityType', ev.entity_type)}</span>{ev.entity_type === 'request' ? data.project.request_no : names[entityKey(ev.entity_type, ev.entity_id)] ?? ''}</TableCell>
                  <TableCell><button type="button" className="font-medium text-primary hover:underline" onClick={() => open(ev)}>{ev.file_name ?? ev.url}</button></TableCell>
                  <TableCell className="text-center">{optLabel(EVIDENCE_TYPES, ev.evidence_type)}</TableCell>
                  <TableCell className="text-center"><div>{profileName(ev.uploaded_by)}</div><div className="text-xs text-muted-foreground">{fmtDateTime(ev.uploaded_at)}</div></TableCell>
                  <TableCell className="text-center">{ev.is_internal ? t('internal') : t('shared')}</TableCell>
                  <TableCell className="text-center">{enumText('verificationStatus', ev.verification_status)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </BoardGroup>
    </div>
  );
}
