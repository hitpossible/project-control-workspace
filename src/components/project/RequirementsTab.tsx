'use client';

import { Pencil, Sparkles } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { useApp } from '@/components/AppProvider';
import { confirmDialog } from '@/components/ConfirmDialog';
import { EmptyState, FormField } from '@/components/common';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { dbClient } from '@/lib/db/client';
import { errMsg, fmtDate } from '@/lib/format';
import { featureRef, isEmptySummary, normalizeSummary, type RequirementSummary, SUMMARY_SECTIONS } from '@/lib/requirements';
import { cn } from '@/lib/utils';
import type { TabProps } from './types';

type Saved = { id: number; content: RequirementSummary; ai_generated: boolean; updated_by: number | null; updated_at: string };
/** editor text per section: lists as one item per line */
type Draft = Record<string, string>;

const toDraft = (s: RequirementSummary): Draft =>
  Object.fromEntries(SUMMARY_SECTIONS.map((x) => {
    const v = s[x.key as keyof RequirementSummary];
    return [x.key, Array.isArray(v) ? v.join('\n') : v];
  }));

/** Working requirement summary of the project — AI drafts, the leader / Supervisor / Manager edits and saves */
export default function RequirementsTab({ data, perm }: Pick<TabProps, 'data' | 'perm'>) {
  const t = useTranslations('requirements');
  const db = dbClient();
  const { profileName, hasRole, notify } = useApp();
  const pid = data.project.id;
  const [saved, setSaved] = useState<Saved | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  /** the editor holds an unsaved AI draft; untouched = not edited since */
  const [ai, setAi] = useState<{ untouched: boolean } | null>(null);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const canPlan = perm.manage || hasRole('supervisor', 'manager');

  const load = useCallback(async () => {
    const s = await db.from('project_requirement_summaries').select('*').eq('project_id', pid).maybeSingle();
    setSaved((s.data ?? null) as Saved | null);
    setLoaded(true);
  }, [db, pid]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data fetch
    load();
  }, [load]);

  const summary = saved ? normalizeSummary(saved.content) : null;
  const hasSummary = !!summary && !isEmptySummary(summary);

  const generate = async () => {
    setBusy(true);
    try {
      const j = await fetch(`/api/projects/${pid}/requirement-summary`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes, update: hasSummary }),
      }).then((r) => r.json());
      if (j.error) return notify(j.error.message, 'error');
      if (j.data?.off) return notify(t('off'), 'warning');
      setDraft(toDraft(j.data as RequirementSummary));
      setAi({ untouched: true });
    } catch {
      notify(t('failed'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!draft) return;
    const content = normalizeSummary(draft);
    const values = { project_id: pid, content, ai_generated: !!ai?.untouched };
    const { error } = saved
      ? await db.from('project_requirement_summaries').update(values).eq('id', saved.id)
      : await db.from('project_requirement_summaries').insert(values);
    if (error) return notify(errMsg(error), 'error');
    notify(t('saved'));
    setDraft(null);
    setAi(null);
    setNotes('');
    load();
  };

  const cancel = async () => {
    if (ai && !(await confirmDialog({ title: t('discard.title'), description: t('discard.description'), confirmText: t('discard.confirm'), destructive: true }))) return;
    setDraft(null);
    setAi(null);
  };

  if (!loaded) return null;

  return (
    <div className="max-w-5xl">
      <p className="mb-4 text-sm text-muted-foreground">{t('intro')}</p>

      {canPlan && !draft && (
        <div className="no-print mb-5 rounded-md border border-grid bg-white p-3">
          <FormField label={t('notes')} helperText={hasSummary ? t('updateHelp') : !data.project.request_id ? t('noRequest') : undefined}>
            <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t('notesPlaceholder')} className="min-h-0 bg-white" />
          </FormField>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button disabled={busy} onClick={generate}>
              <Sparkles className={cn(busy && 'animate-pulse')} /> {hasSummary ? t('regenerate') : t('generate')}
            </Button>
            {hasSummary && <Button variant="outline" disabled={busy} onClick={() => setDraft(toDraft(summary!))}><Pencil /> {t('edit')}</Button>}
            {busy && <span className="text-xs text-muted-foreground">{t('generating')}</span>}
          </div>
        </div>
      )}

      {draft ? (
        <>
          {ai && <Alert className="mb-4 border-[#a25ddc]/40 bg-[#a25ddc]/5"><Sparkles className="text-[#a25ddc]" /><AlertDescription>{t('aiDraft')}</AlertDescription></Alert>}
          <div className="flex flex-col gap-4">
            {SUMMARY_SECTIONS.map((s) => (
              <FormField key={s.key} label={t(`section.${s.key}`)} helperText={t(`hint.${s.key}`)}>
                <Textarea
                  rows={s.kind === 'list' ? Math.min(14, Math.max(3, draft[s.key].split('\n').length + 1)) : 3}
                  value={draft[s.key]}
                  onChange={(e) => { setDraft({ ...draft, [s.key]: e.target.value }); if (ai) setAi({ untouched: false }); }}
                  className="min-h-0 bg-white"
                />
              </FormField>
            ))}
          </div>
          <div className="sticky bottom-0 mt-4 flex justify-end gap-2 border-t border-grid bg-background py-3">
            <Button variant="outline" onClick={cancel}>{t('cancel')}</Button>
            <Button onClick={save}>{t('save')}</Button>
          </div>
        </>
      ) : !hasSummary ? (
        <EmptyState text={canPlan ? t('emptyPlan') : t('empty')} />
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>{t('updated', { name: profileName(saved!.updated_by), date: fmtDate(saved!.updated_at) })}</span>
            {saved!.ai_generated && <span className="rounded bg-[#a25ddc]/10 px-1.5 py-0.5 text-[#7a3db0]">{t('aiUnedited')}</span>}
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {SUMMARY_SECTIONS.map((s) => {
              const v = summary![s.key as keyof RequirementSummary];
              if (!v.length) return null;
              const wide = s.key === 'features' || s.key === 'objective';
              return (
                <section key={s.key} className={cn('rounded-md border border-grid bg-white p-4', wide && 'md:col-span-2', s.key === 'open_questions' && 'border-[#fdab3d]/60')}>
                  <h3 className="mb-2 text-sm font-semibold">{t(`section.${s.key}`)}</h3>
                  {Array.isArray(v) ? (
                    <ul className="flex flex-col gap-1 text-sm">
                      {v.map((it, i) => (
                        <li key={i} className="flex gap-2">
                          <span className="w-7 shrink-0 text-xs leading-5 text-muted-foreground">{s.key === 'features' ? featureRef(i) : '•'}</span>
                          <span>{it}</span>
                        </li>
                      ))}
                    </ul>
                  ) : <p className="whitespace-pre-line text-sm">{v}</p>}
                </section>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
