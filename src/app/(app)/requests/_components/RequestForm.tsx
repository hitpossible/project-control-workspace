'use client';

import { Info, Sparkles } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Fragment, useEffect, useState } from 'react';
import { useOptions } from '@/i18n/useOptions';
import { PRIORITIES, REDUCTION_ROWS } from '@/lib/constants';
import { errMsg, nullify } from '@/lib/format';
import { dbClient } from '@/lib/db/client';
import type { ProjectRequest } from '@/lib/types';
import AiClarifyDialog from './AiClarifyDialog';
import { useApp } from '@/providers/AppProvider';
import { DateField, SelectField, TextField } from '@/components/shared/form';
import { Section } from '@/components/shared/layout';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

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

/** Form fields the AI filled in during an intake chat; `seq` changes with every new batch */
export type AiPatch = { values: RequestDraft; seq: number };

/**
 * FM-SYS-004 Project Development Request Form.
 * Intake (written with the AI): `aiPatch` fills fields as the chat goes — only fields that are empty or still the AI's own,
 * never what the requestor typed — and marks them for review until edited; `extra` adds the transcript to the saved draft.
 */
export default function RequestForm({ initial, onSaved, onSubmit, aiPatch, onChange, extra, onBeforeSave }: {
  initial: RequestDraft;
  onSaved: (r: ProjectRequest) => void;
  onSubmit?: (r: ProjectRequest) => Promise<void>;
  aiPatch?: AiPatch;
  /** the form as edited so far (unsaved) */
  onChange?: (f: RequestDraft) => void;
  /** more columns for the saved draft, e.g. the intake chat */
  extra?: () => Partial<ProjectRequest>;
  /** right before saving, e.g. to stop the intake chat */
  onBeforeSave?: () => void;
}) {
  const t = useTranslations('requestForm');
  const te = useTranslations('enums');
  const { options } = useOptions();
  const db = dbClient();
  const { me, notify } = useApp();
  const [f, setF] = useState<RequestDraft>(initial);
  const [busy, setBusy] = useState(false);
  const [clarify, setClarify] = useState<ProjectRequest | null>(null);
  // fields the AI filled that the requestor has not touched since
  const [aiKeys, setAiKeys] = useState<Set<string>>(new Set());
  const [patchSeq, setPatchSeq] = useState(0);
  if (aiPatch && aiPatch.seq !== patchSeq) {
    // a new batch from the AI (state adjusted while rendering, before children see the old values)
    setPatchSeq(aiPatch.seq);
    const take = Object.entries(aiPatch.values).filter(([k, v]) => v != null && v !== '' && (aiKeys.has(k) || f[k as keyof RequestDraft] == null || f[k as keyof RequestDraft] === ''));
    if (take.length) {
      setF((p) => ({ ...p, ...Object.fromEntries(take) }));
      setAiKeys((s) => new Set([...s, ...take.map(([k]) => k)]));
    }
  }
  useEffect(() => {
    onChange?.(f);
  }, [f, onChange]);

  const edited = (k: keyof ProjectRequest) => aiKeys.has(k) && setAiKeys((s) => { const n = new Set(s); n.delete(k); return n; });
  const set = (k: keyof ProjectRequest) => (v: string | null) => { edited(k); setF((p) => ({ ...p, [k]: v })); };
  const aiHelp = (k: keyof ProjectRequest) => (aiKeys.has(k) ? <span className="flex items-center gap-1 text-[#784bd1]"><Sparkles className="size-3" />{t('aiFilled')}</span> : undefined);
  const txt = (k: keyof ProjectRequest) => ({
    value: (f[k] as string | null) ?? '',
    onChange: (v: string) => set(k)(v),
    helperText: aiHelp(k),
  });

  const num = (k: keyof ProjectRequest) => ({
    value: (f[k] as number | string | null) ?? '',
    onChange: (v: string) => set(k)(v),
    helperText: aiHelp(k),
  });

  const save = async (): Promise<ProjectRequest | null> => {
    onBeforeSave?.();
    if (!f.project_name?.trim()) {
      notify(t('nameRequired'), 'warning');
      return null;
    }
    const payload = { ...nullify(Object.fromEntries(EDITABLE.map((k) => [k, f[k] ?? null]))), ...extra?.() };
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
        <Alert className="mb-4"><Info /><AlertDescription>{t('noDepartment')}</AlertDescription></Alert>
      )}

      <Section title={t('section.info')}>
        <div className="grid grid-cols-12 gap-3">
          <TextField className="col-span-12" label={t('field.projectName')} required {...txt('project_name')} />
          <TextField className="col-span-12" label={t('field.description')} required multiline {...txt('description')} />
          <TextField className="col-span-12 md:col-span-6" label={t('field.reason')} required multiline {...txt('reason')} />
          <TextField className="col-span-12 md:col-span-6" label={t('field.expectation')} multiline {...txt('expectation')} />
          <SelectField className="col-span-12 sm:col-span-4" label={t('field.priority')} value={f.priority} onChange={set('priority')} options={options(PRIORITIES)} required />
          <TextField className="col-span-12 sm:col-span-4" label={t('field.dateSubmitted')} value={f.date_submitted ?? t('setOnSubmit')} disabled />
          <DateField className="col-span-12 sm:col-span-4" label={t('field.dateRequired')} value={f.date_required} onChange={set('date_required')} required />
        </div>
      </Section>

      <Section title={t('section.reduction')}>
        <div className="grid grid-cols-12 items-center gap-x-3 gap-y-2">
          <div className="col-span-4 hidden sm:block" />
          <div className="col-span-4 hidden text-xs font-medium text-muted-foreground sm:block">{t('from')}</div>
          <div className="col-span-4 hidden text-xs font-medium text-muted-foreground sm:block">{t('to')}</div>
          {REDUCTION_ROWS.map((row) => (
            <Fragment key={row.key}>
              <div className="col-span-12 text-sm font-medium sm:col-span-4">{te(`reduction.${row.key}`)}</div>
              <TextField className="col-span-6 sm:col-span-4" type="number" placeholder={t('from')} {...num(row.from)} />
              <TextField className="col-span-6 sm:col-span-4" type="number" placeholder={t('to')} {...num(row.to)} />
            </Fragment>
          ))}
        </div>
      </Section>

      {!f.id && (
        <Alert className="mb-4"><Info /><AlertDescription>{t('saveFirst')}</AlertDescription></Alert>
      )}

      <div className="mb-4 flex justify-end gap-2">
        <Button variant="outline" disabled={busy} onClick={async () => {
          setBusy(true);
          const r = await save();
          setBusy(false);
          if (r) { notify(t('draftSaved')); onSaved(r); }
        }}>{t('saveDraft')}</Button>
        {onSubmit && (
          <Button disabled={busy} onClick={async () => {
            setBusy(true);
            const r = await save();
            setBusy(false);
            // the AI asks what is still missing about the project, then the dialog submits
            if (r) setClarify(r);
          }}>{t('submit')}</Button>
        )}
      </div>
      {clarify && onSubmit && <AiClarifyDialog request={clarify} onSubmit={onSubmit} onClose={() => setClarify(null)} />}
    </div>
  );
}
