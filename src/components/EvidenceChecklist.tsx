'use client';

import { CircleCheck, CircleDashed, Plus, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { errMsg } from '@/lib/format';
import { dbClient } from '@/lib/db/client';
import type { Evidence, EvidenceRequirement } from '@/lib/types';
import { cn } from '@/lib/utils';
import { useApp } from './AppProvider';
import { EmptyState, SelectField, TextField, Tip } from './common';
import EvidencePanel from './EvidencePanel';
import { Button } from './ui/button';
import { Checkbox } from './ui/checkbox';

export function isSatisfied(r: EvidenceRequirement, evidence: Evidence[]) {
  return evidence.some((e) => e.requirement_id === r.id && e.verification_status !== 'rejected');
}

/** Evidence checklist (PRD §18): mandatory items block completion until evidence is attached */
export default function EvidenceChecklist({ projectId, requirements, evidence, canManage, entityOptions, fixedEntity, onChange, labelFor }: {
  projectId: string;
  requirements: EvidenceRequirement[];
  evidence: Evidence[];
  canManage: boolean;
  /** where a new item can be bound (project / activities / tasks) */
  entityOptions?: { value: string; label: string; type: 'project' | 'activity' | 'task' }[];
  fixedEntity?: { type: 'project' | 'activity' | 'task'; id: string };
  onChange: () => void;
  labelFor?: (r: EvidenceRequirement) => string | undefined;
}) {
  const db = dbClient();
  const { notify } = useApp();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [target, setTarget] = useState(fixedEntity ? `${fixedEntity.type}:${fixedEntity.id}` : `project:${projectId}`);
  const [mandatory, setMandatory] = useState(true);

  const done = requirements.filter((r) => isSatisfied(r, evidence)).length;
  const mandatoryMissing = requirements.filter((r) => r.is_mandatory && !isSatisfied(r, evidence)).length;

  const add = async () => {
    const [type, id] = target.split(':');
    const { error } = await db.from('evidence_requirements').insert({ project_id: projectId, entity_type: type, entity_id: id, name: name.trim(), is_mandatory: mandatory, source: 'manual' });
    if (error) return notify(errMsg(error), 'error');
    setName('');
    setAdding(false);
    onChange();
  };

  const remove = async (r: EvidenceRequirement) => {
    if (!confirm(`Remove checklist item "${r.name}"?`)) return;
    const { error } = await db.from('evidence_requirements').delete().eq('id', r.id);
    if (error) return notify(errMsg(error), 'error');
    onChange();
  };

  return (
    <div>
      <div className="mb-2 flex items-center gap-3">
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-grid">
          <div className="h-full bg-[#00c875]" style={{ width: `${requirements.length ? (done / requirements.length) * 100 : 0}%` }} />
        </div>
        <span className="text-xs text-muted-foreground">{done}/{requirements.length} provided</span>
        {mandatoryMissing > 0 && <span className="rounded bg-[#e2445c] px-1.5 py-0.5 text-[11px] font-medium text-white">{mandatoryMissing} mandatory missing</span>}
        {canManage && !adding && <Button variant="ghost" size="sm" className="no-print" onClick={() => setAdding(true)}><Plus /> Add item</Button>}
      </div>
      {requirements.length === 0 && !adding && <EmptyState text="No checklist items" />}
      <ul className="divide-y divide-grid">
        {requirements.map((r) => {
          const ok = isSatisfied(r, evidence);
          const count = evidence.filter((e) => e.requirement_id === r.id && e.verification_status !== 'rejected').length;
          return (
            <li key={r.id} className="flex items-center gap-2 py-1.5">
              {ok ? <CircleCheck className="size-4 text-[#00c875]" /> : <CircleDashed className={cn('size-4', r.is_mandatory ? 'text-[#e2445c]' : 'text-muted-foreground')} />}
              <span className={cn('text-sm', !ok && r.is_mandatory && 'font-medium')}>{r.name}</span>
              {r.is_mandatory ? <span className="rounded bg-secondary px-1.5 text-[10px]">Mandatory</span> : <span className="text-[10px] text-muted-foreground">Optional</span>}
              {labelFor?.(r) && <span className="text-xs text-muted-foreground">· {labelFor(r)}</span>}
              <span className="ml-auto text-xs text-muted-foreground">{count ? `${count} file(s)` : 'missing'}</span>
              {canManage && (
                <Tip title="Remove item"><Button variant="ghost" size="icon-xs" className="no-print" onClick={() => remove(r)}><Trash2 /></Button></Tip>
              )}
            </li>
          );
        })}
      </ul>
      {adding && (
        <div className="mt-2 grid grid-cols-12 items-end gap-2 rounded-md bg-muted p-2">
          <TextField className="col-span-12 sm:col-span-5" label="Checklist item" value={name} onChange={setName} placeholder="e.g. UAT Sign-off" />
          {!fixedEntity && entityOptions && (
            <SelectField className="col-span-12 sm:col-span-4" label="Required for" value={target} onChange={setTarget}
              options={entityOptions.map((o) => ({ value: `${o.type}:${o.value}`, label: o.label }))} />
          )}
          <label className="col-span-6 flex h-9 items-center gap-1.5 text-sm sm:col-span-1"><Checkbox checked={mandatory} onCheckedChange={(c) => setMandatory(!!c)} /> ★</label>
          <div className="col-span-6 flex justify-end gap-1 sm:col-span-2">
            <Button variant="ghost" size="sm" onClick={() => setAdding(false)}>Cancel</Button>
            <Button size="sm" disabled={!name.trim()} onClick={add}>Add</Button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Checklist + evidence files of one activity / task (used in item dialogs) */
export function EntityEvidence({ projectId, entityType, entityId, canAdd, canManage, allowPublicToggle, onChange }: {
  projectId: string; entityType: 'activity' | 'task'; entityId: string; canAdd: boolean; canManage: boolean; allowPublicToggle?: boolean; onChange?: () => void;
}) {
  const db = dbClient();
  const [reqs, setReqs] = useState<EvidenceRequirement[]>([]);
  const [evidence, setEvidence] = useState<Evidence[]>([]);
  const [key, setKey] = useState(0);

  const load = useCallback(async () => {
    const [r, e] = await Promise.all([
      db.from('evidence_requirements').select('*').eq('entity_type', entityType).eq('entity_id', entityId).order('created_at'),
      db.from('evidence').select('*').eq('entity_type', entityType).eq('entity_id', entityId),
    ]);
    setReqs((r.data ?? []) as EvidenceRequirement[]);
    setEvidence((e.data ?? []) as Evidence[]);
  }, [db, entityType, entityId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data fetch
    load();
  }, [load, key]);

  const changed = () => { setKey((k) => k + 1); onChange?.(); };

  return (
    <div className="space-y-4">
      <div>
        <h4 className="mb-1 text-sm font-semibold">Evidence Checklist</h4>
        <EvidenceChecklist projectId={projectId} requirements={reqs} evidence={evidence} canManage={canManage}
          fixedEntity={{ type: entityType, id: entityId }} onChange={changed} />
      </div>
      <div>
        <h4 className="mb-1 text-sm font-semibold">Files & Links</h4>
        <EvidencePanel entityType={entityType} entityId={entityId} projectId={projectId} canAdd={canAdd} canVerify={canManage}
          allowPublicToggle={allowPublicToggle} requirements={reqs} reloadKey={key} onChange={changed} />
      </div>
    </div>
  );
}
