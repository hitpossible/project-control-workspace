'use client';

import dayjs, { type Dayjs } from 'dayjs';
import { ChevronLeft, ChevronRight, Download, Plus } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useApp } from '@/components/AppProvider';
import { StackBar } from '@/components/charts';
import { DateField, EmptyState, FormField, PageHeader, Person, SelectField, TextField, Tip, UserSelect } from '@/components/common';
import { ViewToggle } from '@/components/project/PlanTab';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { WORK_TYPES } from '@/lib/constants';
import { exportWorkforceExcel } from '@/lib/exportExcel';
import { errMsg, nullify } from '@/lib/format';
import { dbClient } from '@/lib/db/client';
import type { Project, WorkforcePlan } from '@/lib/types';
import { cn } from '@/lib/utils';

type View = 'day' | 'week' | 'month' | 'team';
type Load = { owner_id: string; due_date: string; kind: 'task' | 'bug' };

const STAFF = ['developer', 'qa', 'project_leader', 'supervisor', 'support', 'system_reviewer'];
const wt = (v: string) => WORK_TYPES.find((w) => w.value === v)!;

function Chip({ p, projectCode, onClick, compact }: { p: WorkforcePlan; projectCode: (id: string | null) => string; onClick?: () => void; compact?: boolean }) {
  const t = wt(p.work_type);
  const time = p.start_time ? `${p.start_time.slice(0, 5)}–${p.end_time?.slice(0, 5) ?? ''}` : '';
  return (
    <Tip title={[t.label, time, p.location, p.project_id && projectCode(p.project_id), p.remark].filter(Boolean).join(' · ')}>
      <button type="button" onClick={(e) => { e.stopPropagation(); onClick?.(); }}
        className="mb-0.5 flex w-full items-center gap-1 rounded px-1.5 py-0.5 text-left text-[11px] text-white" style={{ background: t.color }}>
        <span className="truncate font-medium">{t.label}</span>
        {!compact && p.location && <span className="truncate opacity-80">· {p.location}</span>}
      </button>
    </Tip>
  );
}

export default function WorkforcePage() {
  const db = dbClient();
  const { me, profiles, hasRole, notify } = useApp();
  const [view, setView] = useState<View>('week');
  const [anchor, setAnchor] = useState<Dayjs>(() => dayjs());
  const [plans, setPlans] = useState<WorkforcePlan[]>([]);
  const [loads, setLoads] = useState<Load[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [section, setSection] = useState('');
  const [edit, setEdit] = useState<Partial<WorkforcePlan> & { to?: string; skipWeekend?: boolean } | null>(null);
  const canAll = hasRole('supervisor', 'manager');

  const range = useMemo(() => {
    if (view === 'day') return { from: anchor.startOf('day'), to: anchor.startOf('day') };
    if (view === 'month') return { from: anchor.startOf('month'), to: anchor.endOf('month') };
    const mon = anchor.subtract((anchor.day() + 6) % 7, 'day').startOf('day');
    return { from: mon, to: mon.add(6, 'day') };
  }, [view, anchor]);
  const days = useMemo(() => {
    const out: Dayjs[] = [];
    for (let d = range.from; !d.isAfter(range.to, 'day'); d = d.add(1, 'day')) out.push(d);
    return out;
  }, [range]);
  const fromS = range.from.format('YYYY-MM-DD');
  const toS = range.to.format('YYYY-MM-DD');

  const load = useCallback(async () => {
    const [w, t, b, p] = await Promise.all([
      db.from('workforce_plans').select('*').gte('work_date', fromS).lte('work_date', toS).order('start_time'),
      db.from('internal_tasks').select('owner_id, due_date').not('status', 'in', '(completed,cancelled)').gte('due_date', fromS).lte('due_date', toS),
      db.from('bugs').select('assigned_dev_id, due_date').in('status', ['assigned', 'in_progress', 'reopened']).gte('due_date', fromS).lte('due_date', toS),
      db.from('projects').select('*').not('status', 'in', '(completed,cancelled)').order('project_code'),
    ]);
    setPlans((w.data ?? []) as WorkforcePlan[]);
    setLoads([
      ...((t.data ?? []) as { owner_id: string; due_date: string }[]).map((x) => ({ ...x, kind: 'task' as const })),
      ...((b.data ?? []) as { assigned_dev_id: string; due_date: string }[]).filter((x) => x.assigned_dev_id).map((x) => ({ owner_id: x.assigned_dev_id, due_date: x.due_date, kind: 'bug' as const })),
    ]);
    setProjects((p.data ?? []) as Project[]);
  }, [db, fromS, toS]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data fetch
    load();
  }, [load]);

  const people = profiles.filter((p) => p.is_active && p.roles.some((r) => STAFF.includes(r)) && (!section || p.section === section));
  const sections = [...new Set(profiles.filter((p) => p.roles.some((r) => STAFF.includes(r))).map((p) => p.section).filter(Boolean))] as string[];
  const projectCode = (id: string | null) => projects.find((p) => p.id === id)?.project_code ?? '';
  const cell = (uid: string, d: Dayjs) => plans.filter((p) => p.user_id === uid && p.work_date === d.format('YYYY-MM-DD'));
  const dueOn = (uid: string | null, d: Dayjs) => loads.filter((l) => (!uid || l.owner_id === uid) && l.due_date === d.format('YYYY-MM-DD'));
  const canEdit = (uid: string) => canAll || uid === me?.id;
  const step = (n: number) => setAnchor(anchor.add(n, view === 'month' ? 'month' : view === 'day' ? 'day' : 'week'));

  const openNew = (uid?: string, d?: Dayjs) => {
    if (uid && !canEdit(uid)) return;
    const date = (d ?? dayjs()).format('YYYY-MM-DD');
    setEdit({ user_id: uid ?? me?.id, work_date: date, to: date, work_type: 'office', start_time: '08:00', end_time: '17:00', location: 'HQ Building 1', skipWeekend: true });
  };

  const save = async () => {
    if (!edit?.user_id || !edit.work_date || !edit.work_type) return notify('Member, date and work type are required', 'warning');
    const base = nullify({
      user_id: edit.user_id, work_type: edit.work_type, start_time: edit.work_type === 'leave' ? null : edit.start_time ?? null,
      end_time: edit.work_type === 'leave' ? null : edit.end_time ?? null, location: edit.location ?? null, project_id: edit.project_id ?? null, remark: edit.remark ?? null,
    });
    let res;
    if (edit.id) {
      res = await db.from('workforce_plans').update({ ...base, work_date: edit.work_date }).eq('id', edit.id);
    } else {
      const rows = [];
      for (let d = dayjs(edit.work_date); !d.isAfter(edit.to ?? edit.work_date, 'day'); d = d.add(1, 'day')) {
        if (edit.skipWeekend && (d.day() === 0 || d.day() === 6)) continue;
        rows.push({ ...base, work_date: d.format('YYYY-MM-DD') });
      }
      if (!rows.length) return notify('No working day in the selected range', 'warning');
      res = await db.from('workforce_plans').insert(rows);
    }
    if (res.error) return notify(errMsg(res.error), 'error');
    notify('Workforce plan saved');
    setEdit(null);
    load();
  };

  const title = view === 'day' ? range.from.format('dddd DD MMMM YYYY')
    : view === 'month' ? range.from.format('MMMM YYYY') : `${range.from.format('DD MMM')} – ${range.to.format('DD MMM YYYY')}`;

  return (
    <>
      <PageHeader
        title="Workforce Plan"
        subtitle="Where each System Service member works and their availability, with task / bug workload (PRD §24)"
        actions={<>
          <Button variant="outline" onClick={() => exportWorkforceExcel({ from: fromS, to: toS, plans, people: people.map((p) => ({ id: p.id, full_name: p.full_name })), projectCode })}><Download /> Export Excel</Button>
          <Button onClick={() => openNew()}><Plus /> Add Plan</Button>
        </>}
      />
      <div className="mb-5 flex flex-wrap items-end gap-3 border-b border-grid pb-4">
        <ViewToggle value={view} onChange={(v) => setView(v as View)} options={[['day', 'Daily'], ['week', 'Weekly'], ['month', 'Monthly'], ['team', 'Team View']]} />
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" className="size-9" onClick={() => step(-1)}><ChevronLeft /></Button>
          <Button variant="outline" className="h-9" onClick={() => setAnchor(dayjs())}>Today</Button>
          <Button variant="outline" size="icon" className="size-9" onClick={() => step(1)}><ChevronRight /></Button>
        </div>
        <span className="pb-2 font-heading text-lg font-semibold">{title}</span>
        <div className="flex-1" />
        <SelectField className="w-48" label="Section" value={section} allowEmpty placeholder="All sections" onChange={setSection} options={sections.map((s) => ({ value: s, label: s }))} />
      </div>
      <div className="mb-4 flex flex-wrap gap-3 text-xs text-muted-foreground">
        {WORK_TYPES.map((t) => <span key={t.value} className="flex items-center gap-1"><span className="size-3 rounded-sm" style={{ background: t.color }} />{t.label}</span>)}
        <span className="flex items-center gap-1"><span className="rounded bg-[#fff1f0] px-1 text-[#e2445c]">3</span>tasks / bugs due</span>
      </div>

      {view === 'day' && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          {WORK_TYPES.map((t) => {
            const items = plans.filter((p) => p.work_type === t.value && people.some((x) => x.id === p.user_id));
            return (
              <div key={t.value} className="rounded-lg border" style={{ borderTop: `4px solid ${t.color}` }}>
                <div className="flex items-center justify-between px-3 py-2"><span className="font-semibold" style={{ color: t.color }}>{t.label}</span><span className="text-sm text-muted-foreground">{items.length}</span></div>
                <div className="divide-y divide-grid">
                  {items.map((p) => (
                    <button key={p.id} type="button" className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted" onClick={() => canEdit(p.user_id) && setEdit({ ...p })}>
                      <Person name={profiles.find((x) => x.id === p.user_id)?.full_name} />
                      <span className="ml-auto text-right text-xs text-muted-foreground">{p.start_time?.slice(0, 5)}{p.end_time && `–${p.end_time.slice(0, 5)}`}<br />{p.location}{p.project_id && ` · ${projectCode(p.project_id)}`}</span>
                    </button>
                  ))}
                  {items.length === 0 && <div className="px-3 py-3 text-xs text-muted-foreground">–</div>}
                </div>
              </div>
            );
          })}
          <div className="rounded-lg border border-dashed md:col-span-2 xl:col-span-4">
            <div className="px-3 py-2 text-sm font-semibold">No plan recorded</div>
            <div className="flex flex-wrap gap-3 px-3 pb-3">
              {people.filter((x) => !plans.some((p) => p.user_id === x.id)).map((x) => <button key={x.id} type="button" onClick={() => openNew(x.id, range.from)}><Person name={x.full_name} /></button>)}
            </div>
          </div>
        </div>
      )}

      {(view === 'week' || view === 'month') && (
        <div className="overflow-x-auto rounded-md border border-grid">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-grid">
                <th className="sticky left-0 z-10 min-w-48 bg-white px-3 py-2 text-left font-normal text-muted-foreground">Member</th>
                {days.map((d) => (
                  <th key={d.toString()} className={cn('border-l border-grid px-1 py-2 text-center text-xs font-normal', (d.day() === 0 || d.day() === 6) && 'bg-[#f6f7fa] text-muted-foreground', d.isSame(dayjs(), 'day') && 'bg-[#e5f0ff] font-semibold text-primary')}
                    style={{ minWidth: view === 'week' ? 130 : 30 }}>
                    {view === 'week' ? d.format('ddd DD MMM') : <>{d.format('dd').charAt(0)}<br />{d.format('D')}</>}
                  </th>
                ))}
                {view === 'week' && <th className="border-l border-grid px-2 text-center text-xs font-normal text-muted-foreground">Workload<br />(due this week)</th>}
              </tr>
            </thead>
            <tbody>
              {people.map((u) => {
                const due = loads.filter((l) => l.owner_id === u.id);
                return (
                  <tr key={u.id} className="border-b border-grid">
                    <td className="sticky left-0 z-10 bg-white px-3 py-1.5"><Person name={u.full_name} /><div className="pl-9 text-[11px] text-muted-foreground">{u.section}</div></td>
                    {days.map((d) => {
                      const items = cell(u.id, d);
                      const dd = dueOn(u.id, d);
                      const leaveConflict = dd.length > 0 && items.some((i) => i.work_type === 'leave');
                      return (
                        <td key={d.toString()} onClick={() => openNew(u.id, d)}
                          className={cn('border-l border-grid p-1 align-top', canEdit(u.id) && 'cursor-pointer hover:bg-muted', (d.day() === 0 || d.day() === 6) && 'bg-[#f6f7fa]', leaveConflict && 'ring-2 ring-[#e2445c] ring-inset')}>
                          {view === 'week' ? (
                            <>
                              {items.map((p) => <Chip key={p.id} p={p} projectCode={projectCode} onClick={() => canEdit(p.user_id) && setEdit({ ...p })} />)}
                              {dd.length > 0 && <Tip title={`${dd.filter((x) => x.kind === 'task').length} task(s), ${dd.filter((x) => x.kind === 'bug').length} bug fix(es) due${leaveConflict ? ' — ON LEAVE!' : ''}`}><span className="inline-block rounded bg-[#fff1f0] px-1 text-[11px] font-semibold text-[#e2445c]">{dd.length} due</span></Tip>}
                            </>
                          ) : (
                            <Tip title={items.map((p) => wt(p.work_type).label).join(', ') + (dd.length ? ` · ${dd.length} due` : '')}>
                              <div className="relative mx-auto size-5 rounded-sm" style={{ background: items[0] ? wt(items[0].work_type).color : 'transparent', border: items[0] ? 0 : '1px dashed #d0d4e4' }}>
                                {dd.length > 0 && <span className="absolute -top-1 -right-1 size-2 rounded-full bg-[#e2445c]" />}
                              </div>
                            </Tip>
                          )}
                        </td>
                      );
                    })}
                    {view === 'week' && (
                      <td className="border-l border-grid px-2 text-center">
                        <span className={cn('font-semibold', due.length > 5 && 'text-destructive')}>{due.length}</span>
                        <div className="text-[11px] text-muted-foreground">{due.filter((x) => x.kind === 'task').length} task · {due.filter((x) => x.kind === 'bug').length} bug</div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
          {people.length === 0 && <EmptyState text="No members" />}
        </div>
      )}

      {view === 'team' && (
        <div className="space-y-3">
          {days.map((d) => {
            const dayPlans = plans.filter((p) => p.work_date === d.format('YYYY-MM-DD') && people.some((x) => x.id === p.user_id));
            const onLeave = dayPlans.filter((p) => p.work_type === 'leave');
            const due = dueOn(null, d).filter((l) => people.some((x) => x.id === l.owner_id));
            const weekend = d.day() === 0 || d.day() === 6;
            return (
              <div key={d.toString()} className={cn('grid grid-cols-12 items-center gap-4 rounded-lg border px-4 py-3', weekend && 'bg-[#f6f7fa]', d.isSame(dayjs(), 'day') && 'border-primary')}>
                <div className="col-span-12 md:col-span-2"><div className="font-semibold">{d.format('ddd DD MMM')}</div><div className="text-xs text-muted-foreground">{dayPlans.length}/{people.length} planned</div></div>
                <div className="col-span-12 md:col-span-6">
                  <StackBar parts={WORK_TYPES.map((t) => ({ key: t.value, label: t.label, color: t.color!, value: dayPlans.filter((p) => p.work_type === t.value).length }))} />
                </div>
                <div className="col-span-6 md:col-span-2 text-sm">
                  <div className="text-xs text-muted-foreground">On leave</div>
                  {onLeave.length ? onLeave.map((p) => <div key={p.id} className="truncate">{profiles.find((x) => x.id === p.user_id)?.full_name}</div>) : '–'}
                </div>
                <div className="col-span-6 md:col-span-2 text-sm">
                  <div className="text-xs text-muted-foreground">Due (tasks / bugs)</div>
                  <span className={cn('font-semibold', due.length > 0 && 'text-[#e2445c]')}>{due.filter((x) => x.kind === 'task').length} / {due.filter((x) => x.kind === 'bug').length}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {edit && (
        <Dialog open onOpenChange={(o) => !o && setEdit(null)}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader><DialogTitle>{edit.id ? 'Edit workforce plan' : 'Add workforce plan'}</DialogTitle></DialogHeader>
            <div className="grid grid-cols-12 gap-3">
              <UserSelect className="col-span-12" label="Member" required value={edit.user_id} onChange={(v) => setEdit({ ...edit, user_id: v ?? undefined })}
                users={canAll ? profiles.filter((p) => p.roles.some((r) => STAFF.includes(r))) : profiles.filter((p) => p.id === me?.id)} disabled={!canAll} />
              <DateField className={edit.id ? 'col-span-12' : 'col-span-6'} label={edit.id ? 'Date' : 'From'} value={edit.work_date} onChange={(v) => setEdit({ ...edit, work_date: v, to: edit.to && edit.to < v ? v : edit.to })} />
              {!edit.id && <DateField className="col-span-6" label="To" value={edit.to} onChange={(v) => setEdit({ ...edit, to: v })} />}
              {!edit.id && <label className="col-span-12 flex items-center gap-2 text-sm"><Checkbox checked={!!edit.skipWeekend} onCheckedChange={(c) => setEdit({ ...edit, skipWeekend: !!c })} /> Skip Saturday / Sunday</label>}
              <SelectField className="col-span-12" label="Work Type" value={edit.work_type} onChange={(v) => setEdit({ ...edit, work_type: v })} options={WORK_TYPES} />
              {edit.work_type !== 'leave' && <>
                <FormField className="col-span-6" label="Start"><Input type="time" className="h-9" value={edit.start_time?.slice(0, 5) ?? ''} onChange={(e) => setEdit({ ...edit, start_time: e.target.value })} /></FormField>
                <FormField className="col-span-6" label="End"><Input type="time" className="h-9" value={edit.end_time?.slice(0, 5) ?? ''} onChange={(e) => setEdit({ ...edit, end_time: e.target.value })} /></FormField>
              </>}
              <TextField className="col-span-12" label="Location" value={edit.location} onChange={(v) => setEdit({ ...edit, location: v })} />
              <SelectField className="col-span-12" label="Project (optional)" allowEmpty value={edit.project_id} onChange={(v) => setEdit({ ...edit, project_id: v || null })}
                options={projects.map((p) => ({ value: p.id, label: `${p.project_code} — ${p.project_name}` }))} />
              <TextField className="col-span-12" label="Remark" value={edit.remark} onChange={(v) => setEdit({ ...edit, remark: v })} />
            </div>
            <DialogFooter className="sm:justify-between">
              {edit.id ? <Button variant="destructive" onClick={async () => {
                const { error } = await db.from('workforce_plans').delete().eq('id', edit.id!);
                if (error) return notify(errMsg(error), 'error');
                setEdit(null); load();
              }}>Delete</Button> : <span />}
              <div className="flex gap-2"><Button variant="outline" onClick={() => setEdit(null)}>Cancel</Button><Button onClick={save}>Save</Button></div>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
