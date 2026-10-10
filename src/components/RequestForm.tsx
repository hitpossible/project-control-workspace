'use client';

import { Info } from 'lucide-react';
import { useState } from 'react';
import { PRIORITIES } from '@/lib/constants';
import { errMsg, nullify } from '@/lib/format';
import { supabaseBrowser } from '@/lib/supabase/client';
import type { Profile, ProjectRequest } from '@/lib/types';
import { useApp } from './AppProvider';
import { DateField, Section, SelectField, TextField, UserSelect } from './common';
import { Alert, AlertDescription } from './ui/alert';
import { Button } from './ui/button';

export type RequestDraft = Partial<ProjectRequest>;

export function emptyRequest(me: Profile | null): RequestDraft {
  return {
    req_employee_id: me?.employee_id ?? '',
    req_full_name: me?.full_name ?? '',
    req_department: me?.department ?? '',
    req_section: me?.section ?? '',
    req_email: me?.email ?? '',
    req_telephone: me?.telephone ?? '',
    req_extension: me?.extension ?? '',
    project_name: '',
    description: '',
    reason: '',
    expectation: '',
    priority: 'medium',
    date_required: '',
    benefit: '',
    requestor_approver_id: null,
  };
}

const EDITABLE: (keyof ProjectRequest)[] = [
  'req_employee_id', 'req_full_name', 'req_department', 'req_section', 'req_email', 'req_telephone', 'req_extension',
  'project_name', 'description', 'reason', 'expectation', 'priority', 'date_required', 'benefit', 'requestor_approver_id',
];

/** FM-SYS-004 Project Development Request Form */
export default function RequestForm({ initial, onSaved, onSubmit }: {
  initial: RequestDraft;
  onSaved: (r: ProjectRequest) => void;
  onSubmit?: (r: ProjectRequest) => Promise<void>;
}) {
  const supabase = supabaseBrowser();
  const { notify } = useApp();
  const [f, setF] = useState<RequestDraft>(initial);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof ProjectRequest) => (v: string | null) => setF((p) => ({ ...p, [k]: v }));
  const txt = (k: keyof ProjectRequest) => ({
    value: (f[k] as string | null) ?? '',
    onChange: (v: string) => set(k)(v),
  });

  const save = async (): Promise<ProjectRequest | null> => {
    if (!f.project_name?.trim()) {
      notify('Project Name is required to save a draft', 'warning');
      return null;
    }
    const payload = nullify(Object.fromEntries(EDITABLE.map((k) => [k, f[k] ?? null])));
    const res = f.id
      ? await supabase.from('project_requests').update(payload).eq('id', f.id).select().single()
      : await supabase.from('project_requests').insert(payload).select().single();
    if (res.error) {
      notify(errMsg(res.error), 'error');
      return null;
    }
    setF(res.data);
    return res.data as ProjectRequest;
  };

  return (
    <div>
      <Section title="Requestor Information">
        <div className="grid grid-cols-12 gap-3">
          <TextField className="col-span-12 sm:col-span-4" label="Employee ID" {...txt('req_employee_id')} />
          <TextField className="col-span-12 sm:col-span-8" label="Full Name" required {...txt('req_full_name')} />
          <TextField className="col-span-12 sm:col-span-6" label="Department" required {...txt('req_department')} />
          <TextField className="col-span-12 sm:col-span-6" label="Section" {...txt('req_section')} />
          <TextField className="col-span-12 sm:col-span-6" label="Email" type="email" {...txt('req_email')} />
          <TextField className="col-span-8 sm:col-span-4" label="Telephone" {...txt('req_telephone')} />
          <TextField className="col-span-4 sm:col-span-2" label="Ext." {...txt('req_extension')} />
        </div>
      </Section>

      <Section title="Project Information">
        <div className="grid grid-cols-12 gap-3">
          <TextField className="col-span-12" label="Project Name" required {...txt('project_name')} />
          <TextField className="col-span-12" label="Brief Description of Request" required multiline {...txt('description')} />
          <TextField className="col-span-12 md:col-span-6" label="Reason for Request" required multiline {...txt('reason')} />
          <TextField className="col-span-12 md:col-span-6" label="Expectation for Project Result" multiline {...txt('expectation')} />
          <SelectField className="col-span-12 sm:col-span-4" label="Priority" value={f.priority} onChange={set('priority')} options={PRIORITIES} required />
          <TextField className="col-span-12 sm:col-span-4" label="Date Submitted" value={f.date_submitted ?? 'Set on submit'} disabled />
          <DateField className="col-span-12 sm:col-span-4" label="Date Required" value={f.date_required} onChange={set('date_required')} required />
          <TextField className="col-span-12" label="Reduction / Benefit Details" multiline rows={2} {...txt('benefit')} />
        </div>
      </Section>

      <Section title="Approval Route">
        <div className="grid grid-cols-12 items-end gap-3">
          <UserSelect className="col-span-12 md:col-span-6" label="Requestor Approver (your manager)" value={f.requestor_approver_id} onChange={set('requestor_approver_id')} roles={['requestor_approver']} required />
          <p className="col-span-12 text-sm text-muted-foreground md:col-span-6">
            Route: Requestor Approval → System Service Review → Authority Approval → Convert to Controlled Project
          </p>
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
            if (r) await onSubmit(r);
            setBusy(false);
          }}>Submit for Approval</Button>
        )}
      </div>
    </div>
  );
}
