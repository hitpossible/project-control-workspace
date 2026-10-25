'use client';

import { ArrowDown, ArrowUp, ChevronDown, Pencil, Plus, Sparkles, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { useApp } from '@/components/AppProvider';
import { confirmDialog } from '@/components/ConfirmDialog';
import { EmptyState, FormField, ProgressBar, SelectField } from '@/components/common';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { dbClient } from '@/lib/db/client';
import {
  completeness, DEFINITION_GROUPS, DEFINITION_SECTIONS, type Feature, featureRef, isEmptyDefinition, isFilled, normalizeDefinition, PRIORITIES, type ProjectDefinition,
  type SectionKey,
} from '@/lib/definition';
import { errMsg, fmtDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { TabProps } from './types';

type Saved = { id: number; content: ProjectDefinition; ai_generated: boolean; updated_by: number | null; updated_at: string };
/** editor state: text and list sections as plain text (lists one item per line), features as rows */
type Draft = { [section: string]: string | Feature[]; features: Feature[] };

const PRIORITY_COLORS: Record<string, string> = { must: '#e2445c', should: '#fdab3d', could: '#579bfc' };

function toDraft(d: ProjectDefinition): Draft {
  const out: Record<string, unknown> = { features: d.features.map((f) => ({ ...f })) };
  for (const g of DEFINITION_GROUPS) for (const s of g.sections) {
    if (s.kind === 'features') continue;
    const v = d[s.key];
    out[s.key] = Array.isArray(v) ? v.join('\n') : v;
  }
  return out as Draft;
}

/** Project definition — AI drafts what the request covers, the leader / Supervisor / Manager fills in the rest */
export default function DefinitionTab({ data, perm }: Pick<TabProps, 'data' | 'perm'>) {
  const t = useTranslations('definition');
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
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const canPlan = perm.manage || hasRole('supervisor', 'manager');

  const load = useCallback(async () => {
    const s = await db.from('project_definitions').select('*').eq('project_id', pid).maybeSingle();
    setSaved((s.data ?? null) as Saved | null);
    setLoaded(true);
  }, [db, pid]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data fetch
    load();
  }, [load]);

  const def = saved ? normalizeDefinition(saved.content) : null;
  const hasDef = !!def && !isEmptyDefinition(def);
  const edit = (patch: Record<string, string | Feature[]>) => {
    setDraft((d) => (d ? { ...d, ...patch } as Draft : d));
    if (ai) setAi({ untouched: false });
  };
  const toggle = (g: string) => setClosed((c) => {
    const n = new Set(c);
    if (n.has(g)) n.delete(g); else n.add(g);
    return n;
  });

  const generate = async () => {
    setBusy(true);
    try {
      const j = await fetch(`/api/projects/${pid}/definition-draft`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes, update: hasDef }),
      }).then((r) => r.json());
      if (j.error) return notify(j.error.message, 'error');
      if (j.data?.off) return notify(t('off'), 'warning');
      setDraft(toDraft(j.data as ProjectDefinition));
      setAi({ untouched: true });
    } catch {
      notify(t('failed'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!draft) return;
    const values = { project_id: pid, content: normalizeDefinition(draft), ai_generated: !!ai?.untouched };
    const { error } = saved
      ? await db.from('project_definitions').update(values).eq('id', saved.id)
      : await db.from('project_definitions').insert(values);
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
  const shown = draft ? normalizeDefinition(draft) : def;
  const done = shown ? completeness(shown) : null;

  const groupHeader = (g: (typeof DEFINITION_GROUPS)[number]) => {
    const filled = shown ? g.sections.filter((s) => isFilled(shown, s.key)).length : 0;
    return (
      <button type="button" onClick={() => toggle(g.key)} aria-expanded={!closed.has(g.key)} className="mb-2 flex w-full items-center gap-2 text-left">
        <ChevronDown className={cn('size-4 text-muted-foreground transition-transform', closed.has(g.key) && '-rotate-90')} />
        <h3 className="text-[17px] font-semibold">{t(`group.${g.key}`)}</h3>
        <span className={cn('rounded px-1.5 py-0.5 text-xs', filled === g.sections.length ? 'bg-[#00c875]/15 text-[#007a48]' : 'bg-muted text-muted-foreground')}>
          {t('groupFilled', { filled, total: g.sections.length })}
        </span>
      </button>
    );
  };
  const teamBadge = (key: SectionKey) => {
    const s = DEFINITION_SECTIONS.find((x) => x.key === key);
    return s && !s.ai ? <span className="ml-1.5 rounded bg-[#579bfc]/10 px-1.5 py-0.5 text-[10px] font-normal text-[#2b6bc4]">{t('teamFills')}</span> : null;
  };

  return (
    <div className="max-w-6xl">
      <p className="mb-4 text-sm text-muted-foreground">{t('intro')}</p>

      {canPlan && !draft && (
        <div className="no-print mb-5 rounded-md border border-grid bg-white p-3">
          <FormField label={t('notes')} helperText={hasDef ? t('updateHelp') : !data.project.request_id ? t('noRequest') : undefined}>
            <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t('notesPlaceholder')} className="min-h-0 bg-white" />
          </FormField>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button disabled={busy} onClick={generate}>
              <Sparkles className={cn(busy && 'animate-pulse')} /> {hasDef ? t('regenerate') : t('generate')}
            </Button>
            <Button variant="outline" disabled={busy} onClick={() => setDraft(toDraft(def ?? normalizeDefinition({})))}><Pencil /> {t('edit')}</Button>
            {busy && <span className="text-xs text-muted-foreground">{t('generating')}</span>}
          </div>
        </div>
      )}

      {done && (hasDef || draft) && (
        <div className="mb-5 flex flex-wrap items-center gap-3">
          <ProgressBar className="w-64" value={(100 * done.filled) / done.total} />
          <span className="text-sm text-muted-foreground">{t('filled', done)}</span>
          {!draft && saved && <span className="text-xs text-muted-foreground">· {t('updated', { name: profileName(saved.updated_by), date: fmtDate(saved.updated_at) })}</span>}
          {!draft && saved?.ai_generated && <span className="rounded bg-[#a25ddc]/10 px-1.5 py-0.5 text-xs text-[#7a3db0]">{t('aiUnedited')}</span>}
        </div>
      )}

      {draft ? (
        <>
          {ai && <Alert className="mb-4 border-[#a25ddc]/40 bg-[#a25ddc]/5"><Sparkles className="text-[#a25ddc]" /><AlertDescription>{t('aiDraft')}</AlertDescription></Alert>}
          {DEFINITION_GROUPS.map((g) => (
            <section key={g.key} className="mb-6">
              {groupHeader(g)}
              {!closed.has(g.key) && (
                <div className="flex flex-col gap-4 rounded-md border border-grid bg-white p-4">
                  {g.sections.map((s) => (
                    s.kind === 'features' ? (
                      <div key={s.key}>
                        <div className="mb-1.5 text-xs font-medium text-muted-foreground">{t(`section.${s.key}`)}</div>
                        <FeatureEditor features={draft.features} onChange={(features) => edit({ features })} />
                      </div>
                    ) : (
                      <FormField key={s.key} label={undefined} helperText={t(`hint.${s.key}`)}>
                        <span className="text-xs font-medium text-muted-foreground">{t(`section.${s.key}`)}{teamBadge(s.key)}</span>
                        <Textarea
                          rows={s.kind === 'list' ? Math.min(12, Math.max(2, String(draft[s.key]).split('\n').length + 1)) : 3}
                          value={String(draft[s.key])}
                          onChange={(e) => edit({ [s.key]: e.target.value })}
                          className="min-h-0 bg-white"
                        />
                      </FormField>
                    )
                  ))}
                </div>
              )}
            </section>
          ))}
          <div className="sticky bottom-0 z-10 mt-4 flex justify-end gap-2 border-t border-grid bg-background py-3">
            <Button variant="outline" onClick={cancel}>{t('cancel')}</Button>
            <Button onClick={save}>{t('save')}</Button>
          </div>
        </>
      ) : !hasDef ? (
        <EmptyState text={canPlan ? t('emptyPlan') : t('empty')} />
      ) : (
        DEFINITION_GROUPS.map((g) => {
          const filled = g.sections.filter((s) => isFilled(def!, s.key));
          const empty = g.sections.filter((s) => !isFilled(def!, s.key));
          return (
            <section key={g.key} className="mb-6">
              {groupHeader(g)}
              {!closed.has(g.key) && (
                <>
                  <div className="grid gap-3 md:grid-cols-2">
                    {filled.map((s) => {
                      const wide = s.kind === 'features' || s.kind === 'text';
                      return (
                        <section key={s.key} className={cn('rounded-md border border-grid bg-white p-4', wide && 'md:col-span-2', s.key === 'open_questions' && 'border-[#fdab3d]/60')}>
                          <h4 className="mb-2 text-sm font-semibold">{t(`section.${s.key}`)}</h4>
                          {s.kind === 'features' ? <FeatureTable features={def!.features} /> : s.kind === 'list' ? (
                            <ul className="flex flex-col gap-1 text-sm">
                              {def![s.key].map((it, i) => <li key={i} className="flex gap-2"><span className="text-muted-foreground">•</span><span>{it}</span></li>)}
                            </ul>
                          ) : <p className="whitespace-pre-line text-sm">{def![s.key]}</p>}
                        </section>
                      );
                    })}
                  </div>
                  {empty.length > 0 && (
                    <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                      <span>{t('notFilled')}:</span>
                      {empty.map((s) => <span key={s.key} className="rounded border border-dashed border-grid px-1.5 py-0.5">{t(`section.${s.key}`)}{teamBadge(s.key)}</span>)}
                    </div>
                  )}
                </>
              )}
            </section>
          );
        })
      )}
    </div>
  );
}

function PriorityChip({ value }: { value: string }) {
  const t = useTranslations('definition');
  return <span className="inline-block rounded px-1.5 py-0.5 text-[11px] font-medium text-white" style={{ background: PRIORITY_COLORS[value] }}>{t(`priority.${value as 'must'}`)}</span>;
}

function FeatureTable({ features }: { features: Feature[] }) {
  const t = useTranslations('definition.feature');
  return (
    <Table className="board-table">
      <TableHeader>
        <TableRow>
          <TableHead className="w-12" /><TableHead className="text-left">{t('title')}</TableHead><TableHead className="w-24">{t('priority')}</TableHead>
          <TableHead className="text-left">{t('acceptance')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {features.map((f, i) => (
          <TableRow key={i}>
            <TableCell className="text-center text-xs text-muted-foreground">{featureRef(i)}</TableCell>
            <TableCell className="whitespace-normal">
              <div className="text-sm font-medium">{f.title}</div>
              {f.detail && <div className="text-xs text-muted-foreground">{f.detail}</div>}
            </TableCell>
            <TableCell className="text-center"><PriorityChip value={f.priority} /></TableCell>
            <TableCell className="whitespace-normal text-xs">{f.acceptance || <span className="text-muted-foreground/60">–</span>}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function FeatureEditor({ features, onChange }: { features: Feature[]; onChange: (f: Feature[]) => void }) {
  const t = useTranslations('definition');
  const set = (i: number, patch: Partial<Feature>) => onChange(features.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  const move = (i: number, d: number) => {
    const next = [...features];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    onChange(next);
  };
  const priorities = PRIORITIES.map((p) => ({ value: p, label: t(`priority.${p}`) }));
  return (
    <div className="flex flex-col gap-2">
      {features.map((f, i) => (
        <div key={i} className="rounded-md border border-grid p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="w-8 text-xs font-medium text-muted-foreground">{featureRef(i)}</span>
            <Input className="h-9 min-w-56 flex-1 bg-white" value={f.title} placeholder={t('feature.title')} onChange={(e) => set(i, { title: e.target.value })} />
            <SelectField className="w-28" value={f.priority} options={priorities} onChange={(v) => set(i, { priority: v as Feature['priority'] })} />
            <Button variant="ghost" size="icon-sm" disabled={i === 0} aria-label={t('feature.up')} onClick={() => move(i, -1)}><ArrowUp /></Button>
            <Button variant="ghost" size="icon-sm" disabled={i === features.length - 1} aria-label={t('feature.down')} onClick={() => move(i, 1)}><ArrowDown /></Button>
            <Button variant="ghost" size="icon-sm" aria-label={t('feature.remove')} onClick={() => onChange(features.filter((_, j) => j !== i))}><Trash2 /></Button>
          </div>
          <div className="mt-2 grid gap-2 pl-10 md:grid-cols-2">
            <Textarea rows={2} className="min-h-0 bg-white text-xs" placeholder={t('feature.detail')} value={f.detail} onChange={(e) => set(i, { detail: e.target.value })} />
            <Textarea rows={2} className="min-h-0 bg-white text-xs" placeholder={t('feature.acceptance')} value={f.acceptance} onChange={(e) => set(i, { acceptance: e.target.value })} />
          </div>
        </div>
      ))}
      <Button variant="outline" size="sm" className="self-start" onClick={() => onChange([...features, { title: '', detail: '', priority: 'must', acceptance: '' }])}>
        <Plus /> {t('feature.add')}
      </Button>
    </div>
  );
}
