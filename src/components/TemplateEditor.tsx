'use client';

import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Copy, Flag, ListChecks, Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useOptions } from '@/i18n/useOptions';
import { FormField, SelectField, TextField } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { TASK_TYPES } from '@/lib/constants';
import type { ProjectTemplate, ProjectType, TemplateActivity } from '@/lib/types';
import { cn } from '@/lib/utils';

// Editor state: template JSON plus a local key per row (React keys; stripped on save)
type TaskRow = { key: number; name: string; task_type: string; duration_days: number };
type ActivityRow = { key: number; name: string; pic_label: string; duration_days: number; is_milestone: boolean; tasks: TaskRow[]; open: boolean };
type EvidenceRow = { key: number; name: string; activity: string; mandatory: boolean };
export type TemplateDraft = Partial<Omit<ProjectTemplate, 'default_activities' | 'evidence_checklist'>> & { activities: ActivityRow[]; evidence: EvidenceRow[] };

/** stored values; labels: enums.picLabel.<value> */
const PIC_VALUES = ['System', 'User', 'Vendor'];
const PROJECT_LEVEL = '__project__';
let nextKey = 1;
const key = () => nextKey++;

const newTask = (): TaskRow => ({ key: key(), name: '', task_type: 'dev', duration_days: 1 });
const newActivity = (): ActivityRow => ({ key: key(), name: '', pic_label: 'System', duration_days: 5, is_milestone: false, tasks: [], open: true });
const newEvidence = (): EvidenceRow => ({ key: key(), name: '', activity: '', mandatory: true });

export function toDraft(t?: ProjectTemplate): TemplateDraft {
  if (!t) return { code: '', name: '', is_active: true, activities: [newActivity()], evidence: [] };
  return {
    ...t,
    activities: (t.default_activities ?? []).map((a) => ({
      key: key(), name: a.name ?? '', pic_label: a.pic_label ?? 'System', duration_days: a.duration_days ?? 1, is_milestone: !!a.is_milestone, open: false,
      tasks: (a.tasks ?? []).map((x) => ({ key: key(), name: x.name ?? '', task_type: x.task_type ?? 'dev', duration_days: x.duration_days ?? 1 })),
    })),
    // item: "name" (project level, mandatory) or {"name","activity","mandatory"} — see applyTemplateChecklist
    evidence: (t.evidence_checklist ?? []).map((e) => {
      const o = typeof e === 'object' && e !== null ? (e as { name?: string; activity?: string; mandatory?: boolean }) : null;
      return { key: key(), name: o ? o.name ?? '' : String(e), activity: o?.activity ?? '', mandatory: o?.mandatory ?? true };
    }),
  };
}

type TemplateT = ReturnType<typeof useTranslations<'template'>>;

/** Problems that block saving (in the UI language); empty when valid */
export function draftProblems(d: TemplateDraft, t: TemplateT): string[] {
  const out: string[] = [];
  if (!d.code?.trim()) out.push(t('problem.code'));
  if (!d.name?.trim()) out.push(t('problem.name'));
  if (!d.activities.length) out.push(t('problem.noActivity'));
  d.activities.forEach((a, i) => !a.name.trim() && out.push(t('problem.activityName', { no: i + 1 })));
  return out;
}

export function fromDraft(d: TemplateDraft) {
  const default_activities: TemplateActivity[] = d.activities.map((a) => ({
    name: a.name.trim(), pic_label: a.pic_label, duration_days: Math.max(1, a.duration_days || 1),
    ...(a.is_milestone ? { is_milestone: true } : {}),
    tasks: a.tasks.filter((x) => x.name.trim()).map((x) => ({ name: x.name.trim(), task_type: x.task_type, duration_days: Math.max(1, x.duration_days || 1) })),
  }));
  const evidence_checklist = d.evidence.filter((e) => e.name.trim()).map((e) =>
    !e.activity && e.mandatory ? e.name.trim() : { name: e.name.trim(), ...(e.activity ? { activity: e.activity } : {}), mandatory: e.mandatory });
  return {
    code: d.code?.trim(), name: d.name?.trim(), description: d.description || null, project_type_id: d.project_type_id ?? null,
    default_activities, evidence_checklist, is_active: d.is_active ?? true,
  };
}

function move<T>(list: T[], i: number, dir: -1 | 1) {
  const j = i + dir;
  if (j < 0 || j >= list.length) return list;
  const next = [...list];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

function DaysInput({ value, onChange, className }: { value: number; onChange: (v: number) => void; className?: string }) {
  const t = useTranslations('template');
  return (
    <div className={cn('flex items-center gap-1', className)}>
      <Input type="number" min={1} value={value || ''} onChange={(e) => onChange(Math.max(0, Math.floor(Number(e.target.value))))}
        className="h-8 w-16 bg-white text-right" />
      <span className="text-xs text-muted-foreground">{t('days')}</span>
    </div>
  );
}

function IconBtn({ title, className, ...props }: React.ComponentProps<typeof Button> & { title: string }) {
  return <Button type="button" size="icon" variant="ghost" title={title} aria-label={title} className={cn('size-8', className)} {...props} />;
}

export function TemplateEditor({ draft, onChange, types }: { draft: TemplateDraft; onChange: (d: TemplateDraft) => void; types: ProjectType[] }) {
  // `t` is the task index in this component
  const tt = useTranslations('template');
  const { options, text: enumText } = useOptions();
  const picOpts = PIC_VALUES.map((v) => ({ value: v, label: enumText('picLabel', v) }));
  const set = (patch: Partial<TemplateDraft>) => onChange({ ...draft, ...patch });
  const acts = draft.activities;
  const setActs = (activities: ActivityRow[]) => set({ activities });
  const updAct = (i: number, patch: Partial<ActivityRow>) => setActs(acts.map((a, j) => (j === i ? { ...a, ...patch } : a)));
  const updTask = (i: number, t: number, patch: Partial<TaskRow>) => updAct(i, { tasks: acts[i].tasks.map((x, j) => (j === t ? { ...x, ...patch } : x)) });
  const setEvid = (evidence: EvidenceRow[]) => set({ evidence });
  const updEvid = (i: number, patch: Partial<EvidenceRow>) => setEvid(draft.evidence.map((e, j) => (j === i ? { ...e, ...patch } : e)));

  const total = acts.reduce((s, a) => s + Math.max(1, a.duration_days || 1), 0);
  const allOpen = acts.length > 0 && acts.every((a) => a.open);
  const actNames = [...new Set(acts.map((a) => a.name.trim()).filter(Boolean))];

  return (
    <div className="flex flex-col gap-6">
      {/* Details */}
      <section className="grid grid-cols-12 gap-3">
        <TextField className="col-span-12 sm:col-span-3" label={tt('code')} required value={draft.code} onChange={(v) => set({ code: v.toUpperCase() })} placeholder={tt('codePlaceholder')} />
        <TextField className="col-span-12 sm:col-span-6" label={tt('name')} required value={draft.name} onChange={(v) => set({ name: v })} placeholder={tt('namePlaceholder')} />
        <SelectField className="col-span-12 sm:col-span-3" label={tt('projectType')} allowEmpty value={draft.project_type_id?.toString()}
          onChange={(v) => set({ project_type_id: v ? Number(v) : null })} options={types.map((x) => ({ value: x.id.toString(), label: x.name }))} />
        <TextField className="col-span-12 sm:col-span-9" label={tt('description')} value={draft.description} onChange={(v) => set({ description: v })} />
        <FormField className="col-span-12 sm:col-span-3" label={tt('status')}>
          <label className="flex h-9 items-center gap-2 text-sm"><Switch checked={!!draft.is_active} onCheckedChange={(c) => set({ is_active: c })} /> {draft.is_active ? tt('active') : tt('inactive')}</label>
        </FormField>
      </section>

      {/* Activities */}
      <section>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <h4 className="font-semibold">{tt('activities')}</h4>
          <span className="text-sm text-muted-foreground">
            {tt('summary', { activities: acts.length, days: total, milestones: acts.filter((a) => a.is_milestone).length })}
          </span>
          <div className="flex-1" />
          {acts.length > 0 && (
            <Button type="button" size="sm" variant="ghost" onClick={() => setActs(acts.map((a) => ({ ...a, open: !allOpen })))}>
              {allOpen ? tt('collapseAll') : tt('expandAll')}
            </Button>
          )}
        </div>
        <p className="mb-2 text-xs text-muted-foreground">
          {tt('activitiesNote')}
        </p>
        <ol className="flex flex-col gap-2">
          {acts.map((a, i) => {
            const taskDays = a.tasks.reduce((s, x) => s + Math.max(1, x.duration_days || 1), 0);
            const over = a.tasks.length > 0 && taskDays > Math.max(1, a.duration_days || 1);
            return (
              <li key={a.key} className={cn('rounded-md border bg-white', a.is_milestone ? 'border-l-4 border-l-amber-500' : 'border-l-4 border-l-[#579bfc]')}>
                <div className="flex flex-wrap items-center gap-2 p-2">
                  <IconBtn title={a.open ? tt('hideTasks') : tt('showTasks')} onClick={() => updAct(i, { open: !a.open })}>{a.open ? <ChevronDown /> : <ChevronRight />}</IconBtn>
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-semibold">{i + 1}</span>
                  <Input value={a.name} onChange={(e) => updAct(i, { name: e.target.value })} placeholder={tt('activityName')}
                    className={cn('h-8 min-w-40 flex-1 bg-white', !a.name.trim() && 'border-destructive/60')} />
                  <SelectField className="w-28" value={a.pic_label} onChange={(v) => updAct(i, { pic_label: v || 'System' })} options={picOpts} />
                  <DaysInput value={a.duration_days} onChange={(v) => updAct(i, { duration_days: v })} />
                  <Button type="button" size="sm" variant={a.is_milestone ? 'default' : 'outline'} title={tt('milestone')}
                    className={cn('h-8', a.is_milestone && 'bg-amber-500 hover:bg-amber-600')} onClick={() => updAct(i, { is_milestone: !a.is_milestone })}>
                    <Flag /> {tt('milestone')}
                  </Button>
                  <button type="button" onClick={() => updAct(i, { open: !a.open })}
                    className="flex h-8 items-center gap-1 rounded px-2 text-xs text-muted-foreground hover:bg-muted">
                    <ListChecks className="size-4" /> {tt('taskCount', { count: a.tasks.length })}
                  </button>
                  <div className="flex shrink-0">
                    <IconBtn title={tt('moveUp')} disabled={i === 0} onClick={() => setActs(move(acts, i, -1))}><ArrowUp /></IconBtn>
                    <IconBtn title={tt('moveDown')} disabled={i === acts.length - 1} onClick={() => setActs(move(acts, i, 1))}><ArrowDown /></IconBtn>
                    <IconBtn title={tt('duplicate')} onClick={() => setActs([...acts.slice(0, i + 1), { ...a, key: key(), name: tt('copyName', { name: a.name }), tasks: a.tasks.map((x) => ({ ...x, key: key() })) }, ...acts.slice(i + 1)])}><Copy /></IconBtn>
                    <IconBtn title={tt('deleteActivity')} className="text-destructive" onClick={() => setActs(acts.filter((_, j) => j !== i))}><Trash2 /></IconBtn>
                  </div>
                </div>
                {a.open && (
                  <div className="border-t bg-muted/30 py-2 pr-2 pl-12">
                    {a.tasks.length === 0 && <p className="py-1 text-xs text-muted-foreground">{tt('noTasks')}</p>}
                    <ul className="flex flex-col gap-1.5">
                      {a.tasks.map((x, t) => (
                        <li key={x.key} className="flex flex-wrap items-center gap-2">
                          <span className="w-5 text-right text-xs text-muted-foreground">{i + 1}.{t + 1}</span>
                          <Input value={x.name} onChange={(e) => updTask(i, t, { name: e.target.value })} placeholder={tt('taskName')} className="h-8 min-w-40 flex-1 bg-white" />
                          <SelectField className="w-32" value={x.task_type} onChange={(v) => updTask(i, t, { task_type: v || 'dev' })} options={options(TASK_TYPES)} />
                          <DaysInput value={x.duration_days} onChange={(v) => updTask(i, t, { duration_days: v })} />
                          <div className="flex shrink-0">
                            <IconBtn title={tt('moveUp')} disabled={t === 0} onClick={() => updAct(i, { tasks: move(a.tasks, t, -1) })}><ArrowUp /></IconBtn>
                            <IconBtn title={tt('moveDown')} disabled={t === a.tasks.length - 1} onClick={() => updAct(i, { tasks: move(a.tasks, t, 1) })}><ArrowDown /></IconBtn>
                            <IconBtn title={tt('deleteTask')} className="text-destructive" onClick={() => updAct(i, { tasks: a.tasks.filter((_, j) => j !== t) })}><Trash2 /></IconBtn>
                          </div>
                        </li>
                      ))}
                    </ul>
                    <div className="mt-1.5 flex flex-wrap items-center gap-3">
                      <Button type="button" size="sm" variant="ghost" className="h-7" onClick={() => updAct(i, { tasks: [...a.tasks, newTask()] })}><Plus /> {tt('addTask')}</Button>
                      {over && <span className="text-xs text-amber-700">{tt('overrun', { taskDays, activityDays: a.duration_days || 1 })}</span>}
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
        <Button type="button" variant="outline" size="sm" className="mt-2 w-full border-dashed" onClick={() => setActs([...acts.map((a) => ({ ...a, open: false })), newActivity()])}>
          <Plus /> {tt('addActivity')}
        </Button>
      </section>

      {/* Timeline preview */}
      {acts.length > 0 && (
        <section>
          <h4 className="mb-2 font-semibold">{tt('timeline')} <span className="text-sm font-normal text-muted-foreground">{tt('timelineNote')}</span></h4>
          <div className="rounded-md border bg-white p-3">
            {(() => {
              let offset = 0;
              return acts.map((a, i) => {
                const d = Math.max(1, a.duration_days || 1);
                const start = offset;
                offset += d;
                return (
                  <div key={a.key} className="flex items-center gap-2 py-0.5 text-xs">
                    <span className="w-40 shrink-0 truncate" title={a.name}>{i + 1}. {a.name || <span className="text-muted-foreground italic">{tt('unnamed')}</span>}</span>
                    <div className="relative h-4 flex-1 rounded-sm bg-muted/50">
                      <div className={cn('absolute inset-y-0 rounded-sm', a.is_milestone ? 'bg-amber-500' : 'bg-[#579bfc]')}
                        style={{ left: `${(start / total) * 100}%`, width: `${(d / total) * 100}%` }} />
                    </div>
                    <span className="w-24 shrink-0 text-right text-muted-foreground">{tt('dayRange', { range: `${start + 1}${d > 1 ? `–${start + d}` : ''}` })}</span>
                  </div>
                );
              });
            })()}
          </div>
        </section>
      )}

      {/* Evidence checklist */}
      <section>
        <div className="mb-2 flex items-center gap-2">
          <h4 className="font-semibold">{tt('evidence')}</h4>
          <span className="text-sm text-muted-foreground">{tt('evidenceCount', { count: draft.evidence.length })}</span>
        </div>
        <p className="mb-2 text-xs text-muted-foreground">{tt('evidenceNote')}</p>
        {draft.evidence.length > 0 && (
          <ul className="flex flex-col gap-1.5">
            {draft.evidence.map((e, i) => (
              <li key={e.key} className="flex flex-wrap items-center gap-2">
                <Input value={e.name} onChange={(ev) => updEvid(i, { name: ev.target.value })} placeholder={tt('evidencePlaceholder')} className="h-8 min-w-48 flex-1 bg-white" />
                <SelectField className="w-52" value={e.activity || PROJECT_LEVEL} onChange={(v) => updEvid(i, { activity: v === PROJECT_LEVEL ? '' : v })}
                  options={[{ value: PROJECT_LEVEL, label: tt('wholeProject') }, ...actNames.map((n) => ({ value: n, label: n })),
                    ...(e.activity && !actNames.includes(e.activity) ? [{ value: e.activity, label: tt('notInTemplate', { name: e.activity }) }] : [])]} />
                <label className="flex items-center gap-1.5 text-sm"><Checkbox checked={e.mandatory} onCheckedChange={(c) => updEvid(i, { mandatory: c === true })} /> {tt('required')}</label>
                <IconBtn title={tt('deleteItem')} className="text-destructive" onClick={() => setEvid(draft.evidence.filter((_, j) => j !== i))}><Trash2 /></IconBtn>
              </li>
            ))}
          </ul>
        )}
        <Button type="button" variant="outline" size="sm" className="mt-2 w-full border-dashed" onClick={() => setEvid([...draft.evidence, newEvidence()])}>
          <Plus /> {tt('addEvidence')}
        </Button>
      </section>
    </div>
  );
}
