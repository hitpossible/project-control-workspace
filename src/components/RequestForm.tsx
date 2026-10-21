'use client';

import { Info } from 'lucide-react';
import { Fragment, useState } from 'react';
import { PRIORITIES, REDUCTION_ROWS } from '@/lib/constants';
import { errMsg, nullify } from '@/lib/format';
import { dbClient } from '@/lib/db/client';
import type { ProjectRequest } from '@/lib/types';
import AiClarifyDialog from './AiClarifyDialog';
import { useApp } from './AppProvider';
import { DateField, Section, SelectField, TextField } from './common';
import { Alert, AlertDescription } from './ui/alert';
import { Button } from './ui/button';

export type RequestDraft = Partial<ProjectRequest>;

export { REDUCTION_ROWS };

export function emptyRequest(documentTypeId: number): RequestDraft {
  return {
    document_type_id: documentTypeId,
    project_name: '',
    description: '',
    reason: '',
    expectation: '',
    priority: 'medium',
    date_required: '',
  };
}

// Requestor Information is not sent or shown: the server stores it from the signed-in user's profile
const EDITABLE: (keyof ProjectRequest)[] = [
  'project_name', 'description', 'reason', 'expectation', 'priority', 'date_required',
  'reduction_time_from', 'reduction_time_to', 'reduction_man_from', 'reduction_man_to', 'reduction_cost_from', 'reduction_cost_to',
];

/** FM-SYS-004 Project Development Request Form */
export default function RequestForm({ initial, onSaved, onSubmit }: {
  initial: RequestDraft;
  onSaved: (r: ProjectRequest) => void;
  onSubmit?: (r: ProjectRequest) => Promise<void>;
}) {
  const db = dbClient();
  const { me, notify } = useApp();
  const [f, setF] = useState<RequestDraft>(initial);
  const [busy, setBusy] = useState(false);
  const [clarify, setClarify] = useState<ProjectRequest | null>(null);
  const set = (k: keyof ProjectRequest) => (v: string | null) => setF((p) => ({ ...p, [k]: v }));
  const txt = (k: keyof ProjectRequest) => ({
    value: (f[k] as string | null) ?? '',
    onChange: (v: string) => set(k)(v),
  });

  const num = (k: keyof ProjectRequest) => ({
    value: (f[k] as number | string | null) ?? '',
    onChange: (v: string) => setF((p) => ({ ...p, [k]: v })),
  });

  const save = async (): Promise<ProjectRequest | null> => {
    if (!f.project_name?.trim()) {
      notify('Project Name is required to save a draft', 'warning');
      return null;
    }
    const payload = nullify(Object.fromEntries(EDITABLE.map((k) => [k, f[k] ?? null])));
    const res = f.id
      ? await db.from('project_requests').update(payload).eq('id', f.id).select().single()
      : await db.from('project_requests').insert({ ...payload, document_type_id: f.document_type_id }).select().single();
    if (res.error) {
      notify(errMsg(res.error), 'error');
      return null;
    }
    setF(res.data);
    return res.data as ProjectRequest;
  };

  return (
    <div>
      {!me?.department && (
        <Alert className="mb-4"><Info /><AlertDescription>Your user profile has no department — ask an administrator to update it before submitting.</AlertDescription></Alert>
      )}

      <Section title="Project Information">
        <div className="grid grid-cols-12 gap-3">
          <TextField className="col-span-12" label="Project Name" required {...txt('project_name')} />
          <TextField className="col-span-12" label="Brief Description of Request" required multiline {...txt('description')} />
          <TextField className="col-span-12 md:col-span-6" label="Reason for Request" required multiline {...txt('reason')} />
          <TextField className="col-span-12 md:col-span-6" label="Expectation for Project Result" multiline {...txt('expectation')} />
          <SelectField className="col-span-12 sm:col-span-4" label="Priority" value={f.priority} onChange={set('priority')} options={PRIORITIES} required />
          <TextField className="col-span-12 sm:col-span-4" label="Date Submitted" value={f.date_submitted ?? 'Set on submit'} disabled />
          <DateField className="col-span-12 sm:col-span-4" label="Date Required" value={f.date_required} onChange={set('date_required')} required />
        </div>
      </Section>

      <Section title="Reduction">
        <div className="grid grid-cols-12 items-center gap-x-3 gap-y-2">
          <div className="col-span-4 hidden sm:block" />
          <div className="col-span-4 hidden text-xs font-medium text-muted-foreground sm:block">From</div>
          <div className="col-span-4 hidden text-xs font-medium text-muted-foreground sm:block">To</div>
          {REDUCTION_ROWS.map((row) => (
            <Fragment key={row.label}>
              <div className="col-span-12 text-sm font-medium sm:col-span-4">{row.label}</div>
              <TextField className="col-span-6 sm:col-span-4" type="number" placeholder="From" {...num(row.from)} />
              <TextField className="col-span-6 sm:col-span-4" type="number" placeholder="To" {...num(row.to)} />
            </Fragment>
          ))}
        </div>
      </Section>

      {!f.id && (
        <Alert className="mb-4"><Info /><AlertDescription>Save the draft first to attach documents (PDF, Excel, Word, screenshot, e-mail, links…).</AlertDescription></Alert>
      )}

      <div className="mb-4 flex justify-end gap-2">
        <Button variant="outline" disabled={busy} onClick={async () => {
          setBusy(true);
          const r = await save();
          setBusy(false);
          if (r) { notify('Draft saved'); onSaved(r); }
        }}>Save Draft</Button>
        {onSubmit && (
          <Button disabled={busy} onClick={async () => {
            setBusy(true);
            const r = await save();
            setBusy(false);
            // the AI asks what is still missing about the project, then the dialog submits
            if (r) setClarify(r);
          }}>Submit for Approval</Button>
        )}
      </div>
      {clarify && onSubmit && <AiClarifyDialog request={clarify} onSubmit={onSubmit} onClose={() => setClarify(null)} />}
    </div>
  );
}
