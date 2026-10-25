'use client';

import { Plus, Settings2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { useApp } from '@/providers/AppProvider';
import { EmptyState, PageHeader, SearchBox } from '@/components/shared/layout';
import { FormField, SelectField, TextField } from '@/components/shared/form';
import { Person } from '@/components/shared/labels';
import { LevelBadge, LevelLegend, LevelPicker } from '@/components/shared/skills';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useOptions } from '@/i18n/useOptions';
import { SKILL_CATEGORIES } from '@/lib/constants';
import { dbClient } from '@/lib/db/client';
import { day, errMsg, fmtDate } from '@/lib/format';
import { recordedLevel, SKILL_LEVELS } from '@/lib/skills';
import type { Profile, ProfileSkill, Skill } from '@/lib/types';

type Edit = { person: Profile; skill: Skill; row: ProfileSkill | null; self: number | null; verified: number | null; note: string };

export default function SkillMatrixPage() {
  const t = useTranslations('skills');
  const tc = useTranslations('common');
  const { label, options } = useOptions();
  const db = dbClient();
  const { me, profiles, profileName, hasRole, notify } = useApp();
  const [skills, setSkills] = useState<Skill[]>([]);
  const [levels, setLevels] = useState<ProfileSkill[]>([]);
  const [category, setCategory] = useState('');
  const [section, setSection] = useState('');
  const [search, setSearch] = useState('');
  const [edit, setEdit] = useState<Edit | null>(null);
  const [manage, setManage] = useState(false);
  const assessor = hasRole('supervisor', 'manager');
  const seeAll = assessor || hasRole('project_leader');
  const today = day().format('YYYY-MM-DD');

  const load = useCallback(async () => {
    const [s, l] = await Promise.all([
      db.from('skills').select('*').order('category').order('name'),
      db.from('profile_skills').select('*'),
    ]);
    setSkills((s.data ?? []) as Skill[]);
    setLevels((l.data ?? []) as ProfileSkill[]);
  }, [db]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data fetch
    load();
  }, [load]);

  const developers = useMemo(() => profiles.filter((p) => p.is_active && p.roles.includes('developer')), [profiles]);
  const sections = [...new Set(developers.map((p) => p.section).filter(Boolean))] as string[];
  const people = (seeAll ? developers : developers.filter((p) => p.id === me?.id).concat(me && !developers.some((p) => p.id === me.id) ? [me] : []))
    .filter((p) => (!section || p.section === section) && (!search || p.full_name.toLowerCase().includes(search.toLowerCase())));
  const cols = skills.filter((s) => s.is_active && (!category || s.category === category));
  const groups = SKILL_CATEGORIES.map((c) => ({ c, list: cols.filter((s) => s.category === c.value) })).filter((g) => g.list.length);
  const cell = (uid: number, sid: number) => levels.find((l) => l.user_id === uid && l.skill_id === sid) ?? null;

  const open = (person: Profile, skill: Skill) => {
    const own = person.id === me?.id;
    if (!own && !assessor) return;
    const row = cell(person.id, skill.id);
    setEdit({ person, skill, row, self: row?.self_level ?? null, verified: row?.verified_level ?? null, note: row?.note ?? '' });
  };

  const save = async () => {
    if (!edit) return;
    const own = edit.person.id === me?.id;
    const patch: Record<string, unknown> = { note: edit.note.trim() || null };
    if (own) patch.self_level = edit.self;
    if (assessor) patch.verified_level = edit.verified;
    const empty = (own ? edit.self : edit.row?.self_level ?? null) === null && (assessor ? edit.verified : edit.row?.verified_level ?? null) === null;
    const res = edit.row
      ? empty ? await db.from('profile_skills').delete().eq('id', edit.row.id) : await db.from('profile_skills').update(patch).eq('id', edit.row.id)
      : empty ? { error: null } : await db.from('profile_skills').insert({ user_id: edit.person.id, skill_id: edit.skill.id, ...patch });
    if (res.error) return notify(errMsg(res.error), 'error');
    notify(t('saved'));
    setEdit(null);
    load();
  };

  return (
    <>
      <PageHeader
        title={t('title')}
        subtitle={seeAll ? t('subtitle') : t('subtitleOwn')}
        actions={assessor && <Button variant="outline" onClick={() => setManage(true)}><Settings2 /> {t('manageSkills')}</Button>}
      />
      <div className="mb-4 flex flex-wrap items-end gap-3 border-b border-grid pb-4">
        <SelectField className="w-48" label={t('category')} value={category} onChange={setCategory} allowEmpty placeholder={t('allCategories')} options={options(SKILL_CATEGORIES)} />
        {seeAll && <SelectField className="w-48" label={t('section')} value={section} onChange={setSection} allowEmpty placeholder={t('allSections')} options={sections.map((s) => ({ value: s, label: s }))} />}
        {seeAll && <SearchBox className="w-56" value={search} onChange={setSearch} placeholder={t('searchPerson')} />}
        <div className="flex-1" />
        <LevelLegend />
      </div>

      {!people.length || !cols.length ? <EmptyState text={cols.length ? t('noPeople') : t('noSkills')} /> : (
        <div className="overflow-x-auto rounded-md border border-grid">
          <Table className="board-table">
            <TableHeader>
              <TableRow>
                <TableHead rowSpan={2} className="sticky left-0 z-10 min-w-52 bg-background text-left">{t('person')}</TableHead>
                {groups.map((g) => (
                  <TableHead key={g.c.value} colSpan={g.list.length} className="border-l border-grid text-center text-xs" style={{ color: g.c.color }}>
                    {label(SKILL_CATEGORIES, g.c.value)}
                  </TableHead>
                ))}
              </TableRow>
              <TableRow>
                {groups.map((g) => g.list.map((s, i) => (
                  <TableHead key={s.id} title={s.description ?? s.name} className={i === 0 ? 'border-l border-grid' : ''}>
                    <span className="block max-w-24 truncate text-[11px] font-medium">{s.name}</span>
                  </TableHead>
                )))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {people.map((p) => {
                const editable = p.id === me?.id || assessor;
                return (
                  <TableRow key={p.id}>
                    <TableCell className="sticky left-0 z-10 bg-background">
                      <Person name={p.full_name} />
                      {p.section && <div className="pl-9 text-[11px] text-muted-foreground">{p.section}</div>}
                    </TableCell>
                    {groups.map((g) => g.list.map((s, i) => {
                      const row = cell(p.id, s.id);
                      const rec = recordedLevel(row ?? undefined, today);
                      const tip = row ? [
                        row.self_level && t('tip.self', { level: row.self_level }),
                        row.verified_level && t('tip.verified', { level: row.verified_level, by: profileName(row.verified_by), date: fmtDate(row.verified_at) }),
                        rec.stale && t('legend.stale'),
                        row.note,
                      ].filter(Boolean).join('\n') : undefined;
                      return (
                        <TableCell key={s.id} className={i === 0 ? 'border-l border-grid text-center' : 'text-center'}>
                          <button type="button" disabled={!editable} title={tip} onClick={() => open(p, s)}
                            className="rounded p-0.5 enabled:hover:bg-muted disabled:cursor-default">
                            <LevelBadge level={rec.level || null} verified={rec.verified} stale={rec.stale} />
                          </button>
                        </TableCell>
                      );
                    }))}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>{edit?.skill.name} — {edit?.person.full_name}</DialogTitle></DialogHeader>
          {edit && (
            <div className="flex flex-col gap-4">
              <FormField label={t('selfLevel')} helperText={edit.person.id === me?.id ? t('selfHelp') : t('selfOnlyOwner')}>
                <LevelPicker value={edit.self} onChange={(v) => setEdit({ ...edit, self: v })} disabled={edit.person.id !== me?.id} />
              </FormField>
              <FormField label={t('verifiedLevel')} helperText={assessor ? t('verifiedHelp') : t('verifiedOnlyAssessor')}>
                <LevelPicker value={edit.verified} onChange={(v) => setEdit({ ...edit, verified: v })} disabled={!assessor} />
              </FormField>
              <ul className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
                {SKILL_LEVELS.map((l) => <li key={l}><b>{l} · {t(`level.${l}.name`)}</b> — {t(`level.${l}.hint`)}</li>)}
              </ul>
              <TextField label={t('note')} value={edit.note} onChange={(v) => setEdit({ ...edit, note: v })} placeholder={t('notePlaceholder')} />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEdit(null)}>{tc('cancel')}</Button>
            <Button onClick={save}>{tc('save')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {assessor && <ManageSkillsDialog open={manage} onClose={() => setManage(false)} skills={skills} reload={load} />}
    </>
  );
}

function ManageSkillsDialog({ open, onClose, skills, reload }: { open: boolean; onClose: () => void; skills: Skill[]; reload: () => Promise<void> }) {
  const t = useTranslations('skills');
  const tc = useTranslations('common');
  const { label, options } = useOptions();
  const db = dbClient();
  const { notify } = useApp();
  const [draft, setDraft] = useState({ name: '', category: 'backend', description: '' });

  const add = async () => {
    if (!draft.name.trim()) return;
    const { error } = await db.from('skills').insert({ name: draft.name.trim(), category: draft.category, description: draft.description.trim() || null });
    if (error) return notify(errMsg(error), 'error');
    setDraft({ ...draft, name: '', description: '' });
    reload();
  };
  const toggle = async (s: Skill, active: boolean) => {
    const { error } = await db.from('skills').update({ is_active: active }).eq('id', s.id);
    if (error) return notify(errMsg(error), 'error');
    reload();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader><DialogTitle>{t('manageSkills')}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-12 items-end gap-2">
          <TextField className="col-span-12 sm:col-span-4" label={t('skillName')} value={draft.name} onChange={(v) => setDraft({ ...draft, name: v })} />
          <SelectField className="col-span-6 sm:col-span-3" label={t('category')} value={draft.category} onChange={(v) => setDraft({ ...draft, category: v })} options={options(SKILL_CATEGORIES)} />
          <TextField className="col-span-6 sm:col-span-3" label={t('description')} value={draft.description} onChange={(v) => setDraft({ ...draft, description: v })} />
          <Button className="col-span-12 h-9 sm:col-span-2" disabled={!draft.name.trim()} onClick={add}><Plus /> {t('add')}</Button>
        </div>
        <p className="text-xs text-muted-foreground">{t('deactivateHelp')}</p>
        <div className="max-h-[50vh] overflow-y-auto rounded-md border border-grid">
          <Table>
            <TableBody>
              {SKILL_CATEGORIES.map((c) => {
                const list = skills.filter((s) => s.category === c.value);
                return list.length ? (
                  <Fragment key={c.value}>
                    <TableRow><TableCell colSpan={3} className="bg-muted/40 text-xs font-semibold" style={{ color: c.color }}>{label(SKILL_CATEGORIES, c.value)}</TableCell></TableRow>
                    {list.map((s) => (
                      <TableRow key={s.id} className={s.is_active ? '' : 'opacity-50'}>
                        <TableCell className="text-sm">{s.name}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{s.description}</TableCell>
                        <TableCell className="w-16 text-center"><Switch checked={s.is_active} onCheckedChange={(v) => toggle(s, v)} aria-label={t('active')} /></TableCell>
                      </TableRow>
                    ))}
                  </Fragment>
                ) : null;
              })}
            </TableBody>
          </Table>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>{tc('close')}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
