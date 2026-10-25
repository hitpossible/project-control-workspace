'use client';

import { ChevronDown, RefreshCw, Sparkles, Trash2, UserPlus } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { dispatchEmails, useApp } from '@/components/AppProvider';
import { BoardGroup, EmptyState, Person, SelectField, Tip } from '@/components/common';
import { LevelBadge } from '@/components/skills';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { dbClient } from '@/lib/db/client';
import { errMsg, fmtDate } from '@/lib/format';
import type { SkillSuggestion, SkillSuggestions } from '@/lib/definition';
import { type MemberRecommendations, SCORE_WEIGHTS, SKILL_LEVELS } from '@/lib/skills';
import type { ProjectSkillRequirement, Skill } from '@/lib/types';
import { cn } from '@/lib/utils';
import type { TabProps } from './types';

const levelOpts = SKILL_LEVELS.map((l) => ({ value: String(l), label: String(l) }));
const scoreColor = (v: number) => (v >= 75 ? '#00c875' : v >= 50 ? '#fdab3d' : '#e2445c');

/** Team tab: what skills the project needs (leader edits) and the developers who fit best */
export default function SkillFitPanel({ data, perm, reload }: Pick<TabProps, 'data' | 'perm' | 'reload'>) {
  const t = useTranslations('skills.fit');
  const ts = useTranslations('skills');
  const tr = useTranslations('definition');
  const db = dbClient();
  const { profileName, hasRole, notify } = useApp();
  const pid = data.project.id;
  const [skills, setSkills] = useState<Skill[]>([]);
  const [reqs, setReqs] = useState<ProjectSkillRequirement[]>([]);
  const [rec, setRec] = useState<MemberRecommendations | null>(null);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState({ skill: '', level: '3', weight: '3', mandatory: false });
  const [showAll, setShowAll] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  /** AI skill suggestions: null = dialog closed */
  const [suggest, setSuggest] = useState<AiState | null>(null);
  const canPlan = perm.manage || hasRole('supervisor', 'manager');

  const recommend = useCallback(async () => {
    if (!canPlan) return;
    setBusy(true);
    const { data: r, error } = await db.rpc<MemberRecommendations>('recommend_members', { p_project_id: pid });
    setBusy(false);
    if (error) return notify(errMsg(error), 'error');
    setRec(r);
  }, [db, pid, canPlan, notify]);

  const load = useCallback(async () => {
    const [s, r] = await Promise.all([
      db.from('skills').select('*').order('category').order('name'),
      db.from('project_skill_requirements').select('*').eq('project_id', pid).order('weight', { ascending: false }),
    ]);
    setSkills((s.data ?? []) as Skill[]);
    setReqs((r.data ?? []) as ProjectSkillRequirement[]);
    await recommend();
  }, [db, pid, recommend]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data fetch
    load();
  }, [load]);

  const skillName = (id: number) => skills.find((s) => s.id === id)?.name ?? '?';
  const run = async (p: PromiseLike<{ error: unknown }>) => {
    const { error } = await p;
    if (error) return notify(errMsg(error), 'error');
    await load();
  };
  // one request per click — the dialog only shows the result
  const askAi = async () => {
    setSuggest({ state: 'loading' });
    try {
      const j = await fetch(`/api/projects/${pid}/skill-suggestions`, { method: 'POST' }).then((r) => r.json());
      if (j.error) { notify(j.error.message, 'error'); return setSuggest({ state: 'failed' }); }
      if (j.data?.off) { notify(tr('off'), 'warning'); return setSuggest(null); }
      setSuggest(j.data?.no_summary ? { state: 'no_summary' } : { state: 'ready', result: j.data as SkillSuggestions });
    } catch {
      notify(tr('failed'), 'error');
      setSuggest({ state: 'failed' });
    }
  };

  const addReq = async () => {
    if (!draft.skill) return;
    await run(db.from('project_skill_requirements').insert({
      project_id: pid, skill_id: Number(draft.skill), required_level: Number(draft.level), weight: Number(draft.weight), is_mandatory: draft.mandatory,
    }));
    setDraft({ skill: '', level: '3', weight: '3', mandatory: false });
  };
  const addMember = async (uid: number) => {
    const { error } = await db.from('project_members').insert({ project_id: pid, user_id: uid, member_role: 'developer' });
    if (error) return notify(errMsg(error), 'error');
    notify(t('added', { name: profileName(uid) }));
    dispatchEmails();
    await reload();
    await recommend();
  };

  const free = skills.filter((s) => s.is_active && !reqs.some((r) => r.skill_id === s.id));
  const list = rec?.candidates ?? [];
  const shown = showAll ? list : list.slice(0, 5);

  return (
    <>
      <BoardGroup
        title={t('requirements')}
        color="#579bfc"
        count={reqs.length}
        actions={canPlan && <Button variant="outline" size="sm" disabled={suggest?.state === 'loading'} onClick={askAi}><Sparkles className="text-[#a25ddc]" /> {t('aiSuggest')}</Button>}
      >
        <div className="p-3">
        <p className="text-sm text-muted-foreground">{t('requirementsIntro')}</p>
        {canPlan && (
          <div className="no-print mt-3 grid grid-cols-12 items-end gap-3">
            <SelectField className="col-span-12 sm:col-span-4" label={t('skill')} value={draft.skill} onChange={(v) => setDraft({ ...draft, skill: v })}
              options={free.map((s) => ({ value: String(s.id), label: s.name }))} />
            <SelectField className="col-span-4 sm:col-span-2" label={t('requiredLevel')} value={draft.level} onChange={(v) => setDraft({ ...draft, level: v })} options={levelOpts} />
            <SelectField className="col-span-4 sm:col-span-2" label={t('weight')} value={draft.weight} onChange={(v) => setDraft({ ...draft, weight: v })} options={levelOpts} />
            <label className="col-span-4 flex h-9 items-center gap-2 text-sm sm:col-span-2">
              <Checkbox checked={draft.mandatory} onCheckedChange={(c) => setDraft({ ...draft, mandatory: !!c })} /> {t('mandatory')}
            </label>
            <Button className="col-span-12 h-9 sm:col-span-2" disabled={!draft.skill} onClick={addReq}>{t('addRequirement')}</Button>
          </div>
        )}
        </div>
        {reqs.length ? (
          <Table className="board-table">
            <TableHeader>
              <TableRow>
                <TableHead className="text-left">{t('skill')}</TableHead><TableHead>{t('requiredLevel')}</TableHead>
                <TableHead><Tip title={t('weightHelp')}><span>{t('weight')}</span></Tip></TableHead><TableHead>{t('mandatory')}</TableHead>{canPlan && <TableHead />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {reqs.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>{skillName(r.skill_id)}</TableCell>
                  <TableCell className="w-36 text-center">
                    {canPlan
                      ? <SelectField value={String(r.required_level)} options={levelOpts} onChange={(v) => run(db.from('project_skill_requirements').update({ required_level: Number(v) }).eq('id', r.id))} />
                      : <LevelBadge level={r.required_level} />}
                  </TableCell>
                  <TableCell className="w-36 text-center">
                    {canPlan
                      ? <SelectField value={String(r.weight)} options={levelOpts} onChange={(v) => run(db.from('project_skill_requirements').update({ weight: Number(v) }).eq('id', r.id))} />
                      : r.weight}
                  </TableCell>
                  <TableCell className="w-28 text-center">
                    <Checkbox checked={r.is_mandatory} disabled={!canPlan} onCheckedChange={(c) => run(db.from('project_skill_requirements').update({ is_mandatory: !!c }).eq('id', r.id))} />
                  </TableCell>
                  {canPlan && (
                    <TableCell className="w-11 text-center">
                      <Button variant="ghost" size="icon-sm" aria-label={t('removeRequirement')} onClick={() => run(db.from('project_skill_requirements').delete().eq('id', r.id))}><Trash2 /></Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : <EmptyState text={canPlan ? t('noRequirementsManage') : t('noRequirements')} />}
      </BoardGroup>

      {canPlan && (
        <BoardGroup
          title={t('recommended')}
          color="#00c875"
          actions={reqs.length > 0 && <Button variant="outline" size="sm" disabled={busy} onClick={recommend}><RefreshCw className={cn(busy && 'animate-spin')} /> {t('recalculate')}</Button>}
        >
          {!reqs.length ? <EmptyState text={t('needRequirements')} /> : !rec ? null : (
            <div className="p-3">
              <p className="mb-3 text-sm text-muted-foreground">
                {t('windowNote', { from: fmtDate(rec.window.from), to: fmtDate(rec.window.to), days: rec.window.workdays })}{' '}
                {t('formula', { skill: SCORE_WEIGHTS.skill * 100, availability: SCORE_WEIGHTS.availability * 100, track: SCORE_WEIGHTS.track * 100, domain: SCORE_WEIGHTS.domain * 100 })}
                {!rec.hasProjectType && ` ${t('noType')}`}
              </p>
              {!list.length ? <EmptyState text={t('noDevelopers')} /> : (
                <div className="flex flex-col gap-2">
                  {shown.map((c, i) => (
                    <div key={c.user_id} className={cn('rounded-md border border-grid bg-white', !c.eligible && 'opacity-70')}>
                      <div className="flex flex-wrap items-center gap-3 p-3">
                        <span className="w-6 text-center text-sm font-semibold text-muted-foreground">{i + 1}</span>
                        <div className="w-52 min-w-0"><Person name={profileName(c.user_id)} /></div>
                        <div className="flex w-20 flex-col items-center">
                          <span className="text-xl font-semibold tabular-nums" style={{ color: scoreColor(c.score) }}>{c.score}</span>
                          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{t('score')}</span>
                        </div>
                        <div className="grid min-w-56 flex-1 grid-cols-4 gap-2 text-center text-xs">
                          {(['skill', 'availability', 'track', 'domain'] as const).map((k) => (
                            <div key={k}>
                              <div className="text-muted-foreground">{t(`part.${k}`)}</div>
                              <div className="font-medium tabular-nums">{c.parts[k] ?? '–'}</div>
                            </div>
                          ))}
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {c.fit.map((f) => (
                            <Tip key={f.skill_id} title={`${skillName(f.skill_id)}: ${f.level || '–'} / ${f.required}${f.verified ? '' : ` (${ts('legend.self')})`}${f.stale ? ` · ${ts('legend.stale')}` : ''}`}>
                              <span className={cn('rounded px-1.5 py-0.5 text-[11px]', f.met ? 'bg-[#00c875]/15 text-[#007a48]' : 'bg-[#e2445c]/10 text-[#b3243a]')}>
                                {skillName(f.skill_id)} {f.level || '–'}/{f.required}
                              </span>
                            </Tip>
                          ))}
                        </div>
                        <div className="ml-auto flex items-center gap-2">
                          {!c.eligible && <span className="rounded bg-[#e2445c]/10 px-1.5 py-0.5 text-[11px] text-[#b3243a]">{t('missingMandatory')}</span>}
                          {c.is_member
                            ? <span className="rounded bg-muted px-2 py-1 text-xs text-muted-foreground">{t('inTeam')}</span>
                            : perm.manage && <Button size="sm" variant="outline" onClick={() => addMember(c.user_id)}><UserPlus /> {t('addToTeam')}</Button>}
                          <Button variant="ghost" size="icon-sm" aria-label={t('whyLabel')} aria-expanded={open === c.user_id} onClick={() => setOpen(open === c.user_id ? null : c.user_id)}>
                            <ChevronDown className={cn('transition-transform', open === c.user_id && 'rotate-180')} />
                          </Button>
                        </div>
                      </div>
                      {open === c.user_id && (
                        <ul className="grid gap-1 border-t border-grid px-12 py-2 text-xs text-muted-foreground sm:grid-cols-2">
                          <li>{t('why.skill', { value: c.parts.skill })}</li>
                          <li>{t('why.leave', { leave: c.load.leaveDays, days: c.load.workdays })}</li>
                          <li>{t('why.load', { projects: c.load.activeProjects, items: c.load.openItems })}</li>
                          <li>{t('why.track', { onTime: c.load.onTimeTasks, done: c.load.doneTasks })}</li>
                          {c.parts.domain !== null && <li>{t('why.domain', { count: c.load.sameTypeProjects })}</li>}
                        </ul>
                      )}
                    </div>
                  ))}
                  {list.length > 5 && (
                    <Button variant="ghost" size="sm" className="self-start" onClick={() => setShowAll(!showAll)}>
                      {showAll ? t('showTop') : t('showAll', { count: list.length })}
                    </Button>
                  )}
                </div>
              )}
              <p className="mt-3 text-xs text-muted-foreground">{t('disclaimer')}</p>
            </div>
          )}
        </BoardGroup>
      )}
      {canPlan && suggest && <SuggestDialog key={suggest.state} ai={suggest} projectId={pid} skills={skills} onClose={() => setSuggest(null)} onAdded={load} />}
    </>
  );
}

type Choice = SkillSuggestion & { on: boolean };
type AiState = { state: 'loading' | 'no_summary' | 'failed' } | { state: 'ready'; result: SkillSuggestions };

/** AI skill suggestions from the requirement summary — the planner ticks and adjusts, then adds them */
function SuggestDialog({ ai, projectId, skills, onClose, onAdded }: {
  ai: AiState; projectId: number; skills: Skill[]; onClose: () => void; onAdded: () => Promise<void>;
}) {
  const t = useTranslations('skills.fit');
  const tc = useTranslations('common');
  const tr = useTranslations('definition');
  const db = dbClient();
  const { notify } = useApp();
  const state = ai.state;
  // keyed by state, so a new result starts from fresh picks
  const [picks, setPicks] = useState<Choice[]>(() => (ai.state === 'ready' ? ai.result.suggestions.map((x) => ({ ...x, on: true })) : []));
  const missing = ai.state === 'ready' ? ai.result.missing : [];
  const [saving, setSaving] = useState(false);

  const set = (i: number, patch: Partial<Choice>) => setPicks(picks.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const chosen = picks.filter((p) => p.on);
  const add = async () => {
    setSaving(true);
    const { error } = await db.from('project_skill_requirements').insert(chosen.map((p) => ({
      project_id: projectId, skill_id: p.skill_id, required_level: p.required_level, weight: p.weight, is_mandatory: p.is_mandatory,
    })));
    setSaving(false);
    if (error) return notify(errMsg(error), 'error');
    notify(t('aiAdded', { count: chosen.length }));
    await onAdded();
    onClose();
  };
  const name = (id: number) => skills.find((s) => s.id === id)?.name ?? '?';

  return (
    <Dialog open onOpenChange={(o) => !o && !saving && onClose()}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Sparkles className="size-4 text-[#a25ddc]" /> {t('aiTitle')}</DialogTitle>
          {state === 'ready' && <DialogDescription>{t('aiIntro')}</DialogDescription>}
        </DialogHeader>
        {state === 'loading' && <p className="flex items-center gap-2 py-8 text-sm text-muted-foreground"><RefreshCw className="size-4 animate-spin" /> {t('aiThinking')}</p>}
        {state === 'failed' && <EmptyState text={tr('failed')} />}
        {state === 'no_summary' && (
          <div className="flex flex-col items-center gap-3 py-6 text-sm text-muted-foreground">
            <p>{t('aiNoSummary')}</p>
            <Button asChild variant="outline"><Link href={`/projects/${projectId}?tab=definition`} onClick={onClose}>{t('aiOpenSummary')}</Link></Button>
          </div>
        )}
        {state === 'ready' && (
          <div className="max-h-[60vh] overflow-y-auto">
            {!picks.length ? <EmptyState text={t('aiNone')} /> : (
              <div className="flex flex-col gap-2">
                {picks.map((p, i) => (
                  <div key={p.skill_id} className={cn('flex flex-wrap items-start gap-3 rounded-md border border-grid p-3', !p.on && 'opacity-50')}>
                    <Checkbox className="mt-0.5" checked={p.on} onCheckedChange={(c) => set(i, { on: !!c })} aria-label={name(p.skill_id)} />
                    <div className="min-w-48 flex-1">
                      <div className="text-sm font-medium">{name(p.skill_id)}</div>
                      <div className="text-xs text-muted-foreground">
                        {p.reason}{p.refs.length > 0 && <span className="ml-1 text-[#7a3db0]">({t('from')} {p.refs.join(', ')})</span>}
                      </div>
                    </div>
                    <div className="flex items-end gap-2">
                      <SelectField className="w-24" label={t('requiredLevel')} value={String(p.required_level)} options={levelOpts} onChange={(v) => set(i, { required_level: Number(v) })} />
                      <SelectField className="w-24" label={t('weight')} value={String(p.weight)} options={levelOpts} onChange={(v) => set(i, { weight: Number(v) })} />
                      <label className="flex h-9 items-center gap-1.5 text-xs">
                        <Checkbox checked={p.is_mandatory} onCheckedChange={(c) => set(i, { is_mandatory: !!c })} /> {t('mandatory')}
                      </label>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {missing.length > 0 && (
              <div className="mt-4 rounded-md border border-[#fdab3d]/60 bg-[#fdab3d]/5 p-3 text-sm">
                <div className="font-medium">{t('aiMissing')}</div>
                <ul className="mt-1 list-disc pl-5 text-xs text-muted-foreground">
                  {missing.map((m) => <li key={m.name}><b className="text-foreground">{m.name}</b>{m.reason && ` — ${m.reason}`}</li>)}
                </ul>
                <p className="mt-1 text-xs text-muted-foreground">{t('aiMissingHelp')}</p>
              </div>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" disabled={saving} onClick={onClose}>{tc('close')}</Button>
          {state === 'ready' && picks.length > 0 && <Button disabled={!chosen.length || saving} onClick={add}>{t('aiAdd', { count: chosen.length })}</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
