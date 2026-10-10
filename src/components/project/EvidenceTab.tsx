'use client';

import { useCallback, useEffect, useState } from 'react';
import { useApp } from '@/components/AppProvider';
import { BoardGroup, EmptyState, Section } from '@/components/common';
import EvidenceChecklist from '@/components/EvidenceChecklist';
import EvidencePanel from '@/components/EvidencePanel';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { EVIDENCE_TYPES, optLabel } from '@/lib/constants';
import { errMsg, fmtDateTime } from '@/lib/format';
import { supabaseBrowser } from '@/lib/supabase/client';
import type { Evidence } from '@/lib/types';
import type { TabProps } from './types';

const ENTITY_LABEL: Record<string, string> = { project: 'Project', activity: 'Activity', task: 'Task', request: 'Request', test_round: 'Test Round', bug: 'Bug', fix: 'Fix', retest: 'Retest' };

export default function EvidenceTab({ data, perm, names, reload }: TabProps & { names: Record<string, string> }) {
  const supabase = supabaseBrowser();
  const { profileName, notify } = useApp();
  const [all, setAll] = useState<Evidence[]>([]);

  const load = useCallback(async () => {
    const or = data.project.request_id ? `project_id.eq.${data.project.id},request_id.eq.${data.project.request_id}` : `project_id.eq.${data.project.id}`;
    const { data: rows } = await supabase.from('evidence').select('*').or(or).order('uploaded_at', { ascending: false });
    setAll((rows ?? []) as Evidence[]);
  }, [supabase, data.project.id, data.project.request_id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data fetch
    load();
  }, [load]);

  const open = async (ev: Evidence) => {
    if (ev.url) return window.open(ev.url, '_blank', 'noopener');
    const { data: s, error } = await supabase.storage.from('evidence').createSignedUrl(ev.storage_path!, 300);
    if (error) return notify(errMsg(error), 'error');
    window.open(s.signedUrl, '_blank', 'noopener');
  };

  return (
    <div>
      {perm.internal && <Section title="Evidence Checklist">
        <p className="mb-2 text-xs text-muted-foreground">Mandatory items must have evidence before the Activity / Task / Project can be completed. Attach evidence from each item&apos;s Evidence tab.</p>
        <EvidenceChecklist
          projectId={data.project.id}
          requirements={data.requirements}
          evidence={data.evidence}
          canManage={perm.manage}
          entityOptions={[
            { value: data.project.id, label: 'Project (closure)', type: 'project' },
            ...data.activities.map((a) => ({ value: a.id, label: `Activity: ${a.name}`, type: 'activity' as const })),
            ...data.tasks.map((t) => ({ value: t.id, label: `Task: ${t.task_no} ${t.name}`, type: 'task' as const })),
          ]}
          labelFor={(r) => r.entity_type === 'project' ? 'Project' : names[r.entity_id]}
          onChange={async () => { await reload(); load(); }}
        />
      </Section>}
      <Section title="Project-level Evidence">
        <EvidencePanel entityType="project" entityId={data.project.id} projectId={data.project.id} canAdd={perm.internal} canVerify={perm.manage} allowPublicToggle
          requirements={data.requirements.filter((r) => r.entity_type === 'project')} onChange={async () => { await reload(); load(); }} />
      </Section>
      <p className="mb-3 text-sm text-muted-foreground">Evidence is bound directly to the Request, Activity or Task it proves. Add evidence from the item itself.</p>
      <BoardGroup title="All Evidence in this Project" color="#00c875" count={all.length}>
        {all.length === 0 ? <EmptyState text="No evidence yet" /> : (
          <Table className="board-table">
            <TableHeader>
              <TableRow><TableHead className="text-left">Bound to</TableHead><TableHead className="text-left">File / Link</TableHead><TableHead>Type</TableHead><TableHead>Uploaded</TableHead><TableHead>Visibility</TableHead><TableHead>Verification</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {all.map((ev) => (
                <TableRow key={ev.id}>
                  <TableCell><span className="mr-1 rounded bg-secondary px-1.5 py-0.5 text-xs">{ENTITY_LABEL[ev.entity_type]}</span>{ev.entity_type === 'request' ? data.project.request_no : names[ev.entity_id] ?? ''}</TableCell>
                  <TableCell><button type="button" className="font-medium text-primary hover:underline" onClick={() => open(ev)}>{ev.file_name ?? ev.url}</button></TableCell>
                  <TableCell className="text-center">{optLabel(EVIDENCE_TYPES, ev.evidence_type)}</TableCell>
                  <TableCell className="text-center"><div>{profileName(ev.uploaded_by)}</div><div className="text-xs text-muted-foreground">{fmtDateTime(ev.uploaded_at)}</div></TableCell>
                  <TableCell className="text-center">{ev.is_internal ? 'Internal' : 'Shared'}</TableCell>
                  <TableCell className="text-center capitalize">{ev.verification_status}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </BoardGroup>
    </div>
  );
}
