'use client';

import { ArrowDown, ArrowUp, Copy, Plus, RotateCcw, Sparkles, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { useApp } from '@/components/AppProvider';
import { BoardGroup, DateField, MultiSelect, PageHeader, Person, SelectField, TextField } from '@/components/common';
import { TemplateEditor, draftProblems, fromDraft, toDraft, type TemplateDraft } from '@/components/TemplateEditor';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useOptions } from '@/i18n/useOptions';
import { DELAY_CATEGORIES, INSIGHT_SEVERITIES, MEMBER_ROLES, ROLES } from '@/lib/constants';
import { day, errMsg, fmtDate } from '@/lib/format';
import { dbClient } from '@/lib/db/client';
import type { Department, DocumentType, InsightRule, NotificationRule, Position, PositionLevel, Profile, ProjectTemplate, ProjectType, Role, Section } from '@/lib/types';
import { DEFAULT_CRITERIA, type ClarifyCriterion } from '@/lib/clarify';
import { POSITION_LEVELS, ROUTE_STAGES, andUp, defaultRoute, formatPrefix, routeApprovers, routeProblems, type RouteStage, type RouteStep } from '@/lib/approval';
import { cn } from '@/lib/utils';
import { DEFAULT_WORK_WEEK, WORK_WEEKS, WORK_WEEK_KEY, makeCalendar } from '@/lib/workdays';
import { confirmDialog } from '@/components/ConfirmDialog';

// A plain mouse wheel only scrolls vertically, so turn it into horizontal scrolling of the tab strip.
function wheelScrollX(el: HTMLDivElement | null) {
  if (!el) return;
  const onWheel = (e: WheelEvent) => {
    if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
    const max = el.scrollWidth - el.clientWidth;
    if (max <= 0) return;
    const next = Math.min(max, Math.max(0, el.scrollLeft + e.deltaY));
    if (next === el.scrollLeft) return;
    e.preventDefault();
    el.scrollLeft = next;
  };
  el.addEventListener('wheel', onWheel, { passive: false });
  return () => el.removeEventListener('wheel', onWheel);
}

/** labels: admin.tab.<key> */
const TABS = ['users', 'departments', 'documentTypes', 'projectTypes', 'templates', 'projectCode', 'workingDays', 'notificationRules', 'insightRules', 'kpi'] as const;

export default function AdminPage() {
  const t = useTranslations('admin');
  const { hasRole } = useApp();
  const [tab, setTab] = useState<string>(TABS[0]);
  if (!hasRole('admin')) return <Alert><AlertDescription>{t('adminOnly')}</AlertDescription></Alert>;
  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <Tabs value={tab} onValueChange={setTab} className="mb-5">
        <TabsList ref={wheelScrollX} variant="line" className="no-scrollbar w-full justify-start overflow-x-auto border-b border-grid">
          {TABS.map((k) => <TabsTrigger key={k} value={k} className="flex-none px-3">{t(`tab.${k}`)}</TabsTrigger>)}
        </TabsList>
      </Tabs>
      <div key={tab} className="motion-rise">
      {tab === 'users' && <UsersAdmin />}
      {tab === 'departments' && <DepartmentsAdmin />}
      {tab === 'documentTypes' && <DocumentTypesAdmin />}
      {tab === 'projectTypes' && <TypesAdmin />}
      {tab === 'templates' && <TemplatesAdmin />}
      {tab === 'projectCode' && <SettingsAdmin />}
      {tab === 'workingDays' && <WorkingDaysAdmin />}
      {tab === 'notificationRules' && <RulesAdmin />}
      {tab === 'insightRules' && <InsightRulesAdmin />}
      {tab === 'kpi' && <KpiSettingsAdmin />}
      </div>
    </>
  );
}

function UsersAdmin() {
  const t = useTranslations('admin.users');
  const tc = useTranslations('common');
  const { label: optLabel, options: optOptions } = useOptions();
  const db = dbClient();
  const { profiles, refreshProfiles, notify } = useApp();
  const [edit, setEdit] = useState<(Partial<Profile> & { password?: string }) | null>(null);
  const { departments, sections, positions } = useDepartments();
  // active entries, plus the user's current one so an inactive entry is not lost
  const options = (rows: { id: number; name: string; is_active?: boolean }[], current: number | null | undefined) =>
    rows.filter((r) => r.is_active !== false || r.id === current).map((r) => ({ value: String(r.id), label: r.name }));
  const deptOpts = options(departments, edit?.department_id);
  const sectionOpts = options(sections.filter((x) => x.department_id === edit?.department_id), edit?.section_id);
  const positionOpts = options(positions, edit?.position_id);
  const idOrNull = (v: string) => (v ? Number(v) : null);

  const save = async () => {
    if (!edit) return;
    const call = async (method: 'POST' | 'PATCH', body: unknown) => {
      const res = await fetch('/api/admin/users', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      return res.ok ? null : ((await res.json().catch(() => null))?.error?.message ?? t('failed'));
    };
    if (!edit.id) {
      const err = await call('POST', edit);
      if (err) return notify(err, 'error');
    } else {
      const { error } = await db.from('profiles').update({
        username: edit.username || null, email: edit.email || null,
        full_name: edit.full_name, employee_id: edit.employee_id, department_id: edit.department_id ?? null, section_id: edit.section_id ?? null, position_id: edit.position_id ?? null,
        telephone: edit.telephone, extension: edit.extension, roles: edit.roles, is_active: edit.is_active,
      }).eq('id', edit.id);
      if (error) return notify(errMsg(error), 'error');
      if (edit.password) {
        const err = await call('PATCH', { id: edit.id, password: edit.password });
        if (err) return notify(err, 'error');
      }
    }
    notify(t('saved'));
    setEdit(null);
    refreshProfiles();
  };

  const set = (patch: Partial<Profile> & { password?: string }) => setEdit((e) => ({ ...e, ...patch }));

  return (
    <>
      <BoardGroup title={t('title')} color="#579bfc" count={profiles.length}
        actions={<Button size="sm" onClick={() => setEdit({ roles: ['requestor'], is_active: true })}><Plus /> {t('add')}</Button>}>
        <Table className="board-table">
          <TableHeader><TableRow><TableHead className="text-left">{t('col.name')}</TableHead><TableHead>{t('col.empId')}</TableHead><TableHead>{t('col.username')}</TableHead><TableHead>{t('col.email')}</TableHead><TableHead>{t('col.department')}</TableHead><TableHead>{t('col.position')}</TableHead><TableHead>{t('col.roles')}</TableHead><TableHead>{t('col.active')}</TableHead></TableRow></TableHeader>
          <TableBody>
            {profiles.map((p) => (
              <TableRow key={p.id} className={cn('cursor-pointer', !p.is_active && 'opacity-50')} onClick={() => setEdit({ ...p })}>
                <TableCell><Person name={p.full_name} /></TableCell>
                <TableCell className="text-center">{p.employee_id}</TableCell>
                <TableCell className="text-center">{p.username}</TableCell>
                <TableCell className="text-center">{p.email}</TableCell>
                <TableCell className="text-center">{p.department}</TableCell>
                <TableCell className="text-center">{p.position}</TableCell>
                <TableCell className="whitespace-normal">
                  <div className="flex flex-wrap gap-1">{p.roles.map((r) => <span key={r} className="rounded bg-secondary px-1.5 py-0.5 text-xs">{optLabel(ROLES, r)}</span>)}</div>
                </TableCell>
                <TableCell className="text-center">{p.is_active ? t('yes') : t('no')}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </BoardGroup>
      {edit && (
        <Dialog open onOpenChange={(o) => !o && setEdit(null)}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader><DialogTitle>{edit.id ? t('edit') : t('add')}</DialogTitle></DialogHeader>
            <div className="grid grid-cols-12 gap-3">
              <TextField className="col-span-8" label={t('field.fullName')} required value={edit.full_name} onChange={(v) => set({ full_name: v })} />
              <TextField className="col-span-4" label={t('field.employeeId')} value={edit.employee_id} onChange={(v) => set({ employee_id: v })} />
              <TextField className="col-span-6" label={t('field.username')} value={edit.username} onChange={(v) => set({ username: v })} helperText={t('field.usernameHelp')} />
              <TextField className="col-span-6" label={t('field.email')} value={edit.email} onChange={(v) => set({ email: v })} />
              <TextField className="col-span-12" label={edit.id ? t('field.setPassword') : t('field.password')} type="password" value={edit.password} onChange={(v) => set({ password: v })}
                helperText={t('field.passwordHelp')} />
              <SelectField className="col-span-6" label={t('field.department')} allowEmpty value={edit.department_id?.toString()} options={deptOpts}
                onChange={(v) => set({ department_id: idOrNull(v), section_id: idOrNull(v) === edit.department_id ? edit.section_id : null })} />
              <SelectField className="col-span-6" label={t('field.section')} allowEmpty value={edit.section_id?.toString()} options={sectionOpts}
                disabled={!edit.department_id} onChange={(v) => set({ section_id: idOrNull(v) })} />
              <SelectField className="col-span-12" label={t('field.position')} allowEmpty value={edit.position_id?.toString()} options={positionOpts}
                onChange={(v) => set({ position_id: idOrNull(v) })}
                helperText={t('field.positionHelp', { positions: POSITION_LEVELS.filter((l) => l.value !== 'staff').map((l) => l.position).join(', ') })} />
              <TextField className="col-span-8" label={t('field.telephone')} value={edit.telephone} onChange={(v) => set({ telephone: v })} />
              <TextField className="col-span-4" label={t('field.ext')} value={edit.extension} onChange={(v) => set({ extension: v })} />
              <MultiSelect className="col-span-12" label={t('col.roles')} value={edit.roles ?? []} onChange={(v) => set({ roles: v as Role[] })} options={optOptions(ROLES)} />
              <label className="col-span-12 flex items-center gap-2 text-sm"><Switch checked={!!edit.is_active} onCheckedChange={(c) => set({ is_active: c })} /> {t('col.active')}</label>
            </div>
            <DialogFooter><Button variant="outline" onClick={() => setEdit(null)}>{tc('cancel')}</Button><Button onClick={save}>{tc('save')}</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

function useDepartments() {
  const db = dbClient();
  const [departments, setDepartments] = useState<Department[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const load = useCallback(async () => {
    const [d, s, p] = await Promise.all([
      db.from('departments').select('*').order('name'), db.from('sections').select('*').order('name'), db.from('positions').select('*').order('name'),
    ]);
    setDepartments((d.data ?? []) as Department[]);
    setSections((s.data ?? []) as Section[]);
    setPositions((p.data ?? []) as Position[]);
  }, [db]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data fetch
    load();
  }, [load]);
  return { departments, sections, positions, load };
}

/** Blank → null (codes are optional); otherwise trimmed upper case */
const normCode = (v: string) => v.trim().toUpperCase() || null;

function DepartmentsAdmin() {
  const t = useTranslations('admin.departments');
  const tc = useTranslations('common');
  const db = dbClient();
  const { notify, refreshProfiles } = useApp();
  const { departments, sections, load } = useDepartments();
  const [selected, setSelected] = useState<number | null>(null);
  const [newDept, setNewDept] = useState({ code: '', name: '' });
  const [newSection, setNewSection] = useState({ code: '', name: '' });
  const current = departments.find((d) => d.id === selected) ?? departments[0];
  const deptSections = sections.filter((s) => s.department_id === current?.id);

  const run = async (p: PromiseLike<{ error: { message: string } | null }>) => {
    const { error } = await p;
    if (error) notify(errMsg(error), 'error');
    await load();
    return !error;
  };
  // renames are copied to user profiles by the server
  const rename = async (table: 'departments' | 'sections', id: number, name: string) => {
    if (await run(db.from(table).update({ name: name.trim() }).eq('id', id))) refreshProfiles();
  };
  const setCode = (table: 'departments' | 'sections', id: number, code: string) =>
    run(db.from(table).update({ code: normCode(code) }).eq('id', id));

  return (
    <>
      <p className="mb-3 text-sm text-muted-foreground">{t('intro')}</p>
      <div className="grid grid-cols-12 gap-5">
        <div className="col-span-12 lg:col-span-6">
          <BoardGroup title={t('title')} color="#00c875" count={departments.length}>
            <Table className="board-table">
              <TableHeader><TableRow><TableHead className="w-24 text-left">{t('col.code')}</TableHead><TableHead className="min-w-36 text-left">{t('col.name')}</TableHead><TableHead className="w-20">{t('col.sections')}</TableHead><TableHead>{t('col.active')}</TableHead></TableRow></TableHeader>
              <TableBody>
                {departments.map((d) => (
                  <TableRow key={d.id} className={cn('cursor-pointer', d.id === current?.id && 'bg-accent')} onClick={() => setSelected(d.id)}>
                    <TableCell className="w-24"><Input key={d.code} defaultValue={d.code ?? ''} placeholder="—" className="h-8 min-w-20 font-mono uppercase" onBlur={(e) => normCode(e.target.value) !== d.code && setCode('departments', d.id, e.target.value)} /></TableCell>
                    <TableCell><Input defaultValue={d.name} className="h-8" onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== d.name && rename('departments', d.id, e.target.value)} /></TableCell>
                    <TableCell className="w-20 text-center">{sections.filter((s) => s.department_id === d.id).length}</TableCell>
                    <TableCell className="w-24 text-center"><Switch checked={d.is_active} onCheckedChange={(c) => run(db.from('departments').update({ is_active: c }).eq('id', d.id))} /></TableCell>
                  </TableRow>
                ))}
                <TableRow>
                  <TableCell><Input placeholder={t('col.code')} className="h-8 min-w-20 font-mono uppercase" value={newDept.code} onChange={(e) => setNewDept({ ...newDept, code: e.target.value })} /></TableCell>
                  <TableCell><Input placeholder={t('newDepartment')} className="h-8" value={newDept.name} onChange={(e) => setNewDept({ ...newDept, name: e.target.value })} /></TableCell>
                  <TableCell />
                  <TableCell className="text-center"><Button size="sm" disabled={!newDept.name.trim()} onClick={async () => {
                    if (await run(db.from('departments').insert({ code: normCode(newDept.code), name: newDept.name.trim() }))) setNewDept({ code: '', name: '' });
                  }}>{tc('add')}</Button></TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </BoardGroup>
        </div>
        <div className="col-span-12 lg:col-span-6">
          {current && (
            <BoardGroup title={t('sectionsOf', { name: current.name })} color="#579bfc" count={deptSections.length}>
              <Table className="board-table">
                <TableHeader><TableRow><TableHead className="w-24 text-left">{t('col.code')}</TableHead><TableHead className="min-w-36 text-left">{t('col.name')}</TableHead><TableHead>{t('col.active')}</TableHead></TableRow></TableHeader>
                <TableBody>
                  {deptSections.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell className="w-24"><Input key={s.code} defaultValue={s.code ?? ''} placeholder="—" className="h-8 min-w-20 font-mono uppercase" onBlur={(e) => normCode(e.target.value) !== s.code && setCode('sections', s.id, e.target.value)} /></TableCell>
                      <TableCell><Input defaultValue={s.name} className="h-8" onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== s.name && rename('sections', s.id, e.target.value)} /></TableCell>
                      <TableCell className="w-24 text-center"><Switch checked={s.is_active} onCheckedChange={(c) => run(db.from('sections').update({ is_active: c }).eq('id', s.id))} /></TableCell>
                    </TableRow>
                  ))}
                  <TableRow>
                    <TableCell><Input placeholder={t('col.code')} className="h-8 min-w-20 font-mono uppercase" value={newSection.code} onChange={(e) => setNewSection({ ...newSection, code: e.target.value })} /></TableCell>
                    <TableCell><Input placeholder={t('newSection')} className="h-8" value={newSection.name} onChange={(e) => setNewSection({ ...newSection, name: e.target.value })} /></TableCell>
                    <TableCell className="text-center"><Button size="sm" disabled={!newSection.name.trim()} onClick={async () => {
                      if (await run(db.from('sections').insert({ department_id: current.id, code: normCode(newSection.code), name: newSection.name.trim() }))) setNewSection({ code: '', name: '' });
                    }}>{tc('add')}</Button></TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </BoardGroup>
          )}
        </div>
      </div>
    </>
  );
}

function TypesAdmin() {
  const t = useTranslations('admin.types');
  const tc = useTranslations('common');
  const db = dbClient();
  const { notify } = useApp();
  const [rows, setRows] = useState<ProjectType[]>([]);
  const [n, setN] = useState({ code: '', name: '' });
  const load = useCallback(async () => setRows(((await db.from('project_types').select('*').order('code')).data ?? []) as ProjectType[]), [db]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data fetch
    load();
  }, [load]);
  const upd = async (id: number, patch: Partial<ProjectType>) => {
    const { error } = await db.from('project_types').update(patch).eq('id', id);
    if (error) notify(errMsg(error), 'error');
    load();
  };
  return (
    <>
      <p className="mb-3 text-sm text-muted-foreground">{t('intro', { token: '{TYPE}' })}</p>
      <BoardGroup title={t('title')} color="#a25ddc" count={rows.length}>
        <Table className="board-table">
          <TableHeader><TableRow><TableHead>{t('col.code')}</TableHead><TableHead className="text-left">{t('col.name')}</TableHead><TableHead>{t('col.active')}</TableHead></TableRow></TableHeader>
          <TableBody>
            {rows.map((x) => (
              <TableRow key={x.id}>
                <TableCell className="w-28 text-center font-semibold">{x.code}</TableCell>
                <TableCell><Input defaultValue={x.name} className="h-8" onBlur={(e) => e.target.value !== x.name && upd(x.id, { name: e.target.value })} /></TableCell>
                <TableCell className="w-24 text-center"><Switch checked={x.is_active} onCheckedChange={(c) => upd(x.id, { is_active: c })} /></TableCell>
              </TableRow>
            ))}
            <TableRow>
              <TableCell><Input placeholder={t('codePlaceholder')} className="h-8" value={n.code} onChange={(e) => setN({ ...n, code: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') })} /></TableCell>
              <TableCell><Input placeholder={t('col.name')} className="h-8" value={n.name} onChange={(e) => setN({ ...n, name: e.target.value })} /></TableCell>
              <TableCell className="text-center"><Button size="sm" disabled={!n.code || !n.name} onClick={async () => {
                const { error } = await db.from('project_types').insert(n);
                if (error) return notify(errMsg(error), 'error');
                setN({ code: '', name: '' }); load();
              }}>{tc('add')}</Button></TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </BoardGroup>
    </>
  );
}

function TemplatesAdmin() {
  const t = useTranslations('admin.templates');
  const tt = useTranslations('template');
  const tc = useTranslations('common');
  const db = dbClient();
  const { notify } = useApp();
  const [rows, setRows] = useState<ProjectTemplate[]>([]);
  const [types, setTypes] = useState<ProjectType[]>([]);
  const [edit, setEdit] = useState<TemplateDraft | null>(null);
  const load = useCallback(async () => {
    setRows(((await db.from('project_templates').select('*').order('name')).data ?? []) as ProjectTemplate[]);
    setTypes(((await db.from('project_types').select('*').order('name')).data ?? []) as ProjectType[]);
  }, [db]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data fetch
    load();
  }, [load]);

  const problems = edit ? draftProblems(edit, tt) : [];
  const save = async () => {
    if (!edit) return;
    if (problems.length) return notify(problems[0], 'error');
    const payload = fromDraft(edit);
    const res = edit.id ? await db.from('project_templates').update(payload).eq('id', edit.id) : await db.from('project_templates').insert(payload);
    if (res.error) return notify(errMsg(res.error), 'error');
    notify(t('saved'));
    setEdit(null);
    load();
  };

  const open = (x?: ProjectTemplate) => setEdit(toDraft(x));
  const duplicate = () => edit && setEdit({ ...edit, id: undefined, code: `${edit.code ?? ''}-COPY`, name: tt('copyName', { name: edit.name ?? '' }) });
  const totalDays = (x: ProjectTemplate) => x.default_activities.reduce((s, a) => s + Math.max(1, a.duration_days ?? 1), 0);

  return (
    <>
      <p className="mb-3 text-sm text-muted-foreground">{t('intro')}</p>
      <BoardGroup title={t('title')} color="#00c875" count={rows.length} actions={<Button size="sm" onClick={() => open()}><Plus /> {t('add')}</Button>}>
        <Table className="board-table">
          <TableHeader><TableRow><TableHead>{t('col.code')}</TableHead><TableHead className="text-left">{t('col.name')}</TableHead><TableHead>{t('col.type')}</TableHead><TableHead className="text-left">{t('col.activities')}</TableHead><TableHead>{t('col.duration')}</TableHead><TableHead>{t('col.active')}</TableHead></TableRow></TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id} className={cn('cursor-pointer', !r.is_active && 'opacity-50')} onClick={() => open(r)}>
                <TableCell className="font-semibold">{r.code}</TableCell>
                <TableCell>{r.name}</TableCell>
                <TableCell className="text-center">{types.find((x) => x.id === r.project_type_id)?.name}</TableCell>
                <TableCell className="whitespace-normal">
                  <div className="flex flex-wrap items-center gap-1">
                    {r.default_activities.map((a, i) => (
                      <span key={i} className={cn('rounded px-1.5 py-0.5 text-xs', a.is_milestone ? 'bg-amber-100 text-amber-900' : 'bg-secondary')}>{a.name}</span>
                    ))}
                  </div>
                </TableCell>
                <TableCell className="text-center text-muted-foreground">{t('days', { count: totalDays(r) })}</TableCell>
                <TableCell className="text-center">{r.is_active ? t('yes') : t('no')}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </BoardGroup>
      {edit && (
        <Dialog open onOpenChange={(o) => !o && setEdit(null)}>
          <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-5xl">
            <DialogHeader><DialogTitle>{edit.id ? t('edit', { code: edit.code ?? '' }) : t('add')}</DialogTitle></DialogHeader>
            <TemplateEditor draft={edit} onChange={setEdit} types={types} />
            <DialogFooter className="items-center sm:justify-between">
              {edit.id ? <Button variant="ghost" onClick={duplicate}><Copy /> {t('duplicate')}</Button> : <span />}
              <div className="flex items-center gap-2">
                {problems.length > 0 && <span className="text-xs text-destructive">{problems[0]}</span>}
                <Button variant="outline" onClick={() => setEdit(null)}>{tc('cancel')}</Button>
                <Button onClick={save} disabled={problems.length > 0}>{tc('save')}</Button>
              </div>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

/** [token, description key: admin.tokens.<key>] */
const TOKENS: [string, string][] = [['{TYPE}', 'type'], ['{YYYY}', 'yyyy'], ['{YY}', 'yy'], ['{SEQ:n}', 'seq']];
const DOC_TOKENS: [string, string][] = [['{DOC}', 'doc'], ...TOKENS.slice(1)];

/** Same substitution as generateCode() on the server, with the first sequence number */
function previewCode(format: string | undefined, type: string | null, doc: string | null = null) {
  if (!format) return '';
  const yyyy = String(new Date().getFullYear());
  let fmt = format.replaceAll('{YYYY}', yyyy).replaceAll('{YY}', yyyy.slice(2)).replaceAll('{DOC}', doc ?? '');
  fmt = type ? fmt.replaceAll('{TYPE}', type) : fmt.replaceAll('-{TYPE}', '').replaceAll('{TYPE}', '');
  return fmt.replace(/\{SEQ:(\d+)\}/g, (_, n) => '1'.padStart(Number(n), '0'));
}

function TokenHints({ tokens }: { tokens: [string, string][] }) {
  const t = useTranslations('admin.tokens');
  return (
    <div className="flex flex-wrap gap-1.5">
      {tokens.map(([token, d]) => (
        <Tooltip key={token}>
          <TooltipTrigger asChild><Badge variant="outline" className="cursor-help font-mono">{token}</Badge></TooltipTrigger>
          <TooltipContent>{t(d as 'type')}</TooltipContent>
        </Tooltip>
      ))}
      <span className="self-center text-xs text-muted-foreground">{t('hover')}</span>
    </div>
  );
}

function SettingsAdmin() {
  const t = useTranslations('admin.projectCode');
  const tc = useTranslations('common');
  const db = dbClient();
  const { notify } = useApp();
  const [vals, setVals] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<Record<string, string>>({});
  const [typeCode, setTypeCode] = useState('DEV');
  const key = 'project_code_format';
  useEffect(() => {
    db.from('app_settings').select('*').then(({ data }) => {
      const v = Object.fromEntries((data ?? []).map((s: { key: string; value: unknown }) => [s.key, String(s.value)]));
      setVals(v);
      setSaved(v);
    });
    db.from('project_types').select('*').eq('is_active', true).order('code').then(({ data }) => {
      const first = (data as ProjectType[] | null)?.[0];
      if (first) setTypeCode(first.code);
    });
  }, [db]);
  const save = async () => {
    const { error } = await db.from('app_settings').update({ value: vals[key], updated_at: new Date().toISOString() }).eq('key', key);
    if (!error) setSaved({ ...saved, [key]: vals[key] });
    notify(error ? errMsg(error) : t('saved'), error ? 'error' : 'success');
  };

  return (
    <Card className="max-w-xl">
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div>
          <div className="flex items-end gap-2">
            <TextField className="flex-1" label={t('title')} mono value={vals[key]} onChange={(v) => setVals({ ...vals, [key]: v })} />
            <Button variant={vals[key] !== saved[key] ? 'default' : 'outline'} className="h-9" disabled={vals[key] === saved[key]} onClick={save}>{tc('save')}</Button>
          </div>
          <div className="mt-1.5 text-xs text-muted-foreground">
            {t('preview')} <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-foreground">{previewCode(vals[key], typeCode) || '—'}</span>
          </div>
        </div>
        <div className="border-t pt-4"><TokenHints tokens={TOKENS} /></div>
      </CardContent>
    </Card>
  );
}

type DocDraft = Omit<DocumentType, 'id'> & { id?: number };
const newDoc = (sort: number): DocDraft => ({
  code: '', name: '', form_no: '', request_no_format: '{DOC}-{YYYY}-{SEQ:4}', approval_route: defaultRoute(), clarify_criteria: DEFAULT_CRITERIA, sort_order: sort, is_active: true,
});

function DocumentTypesAdmin() {
  const t = useTranslations('admin.docTypes');
  const tc = useTranslations('common');
  const { text: enumText } = useOptions();
  const db = dbClient();
  const { notify, profiles } = useApp();
  const [rows, setRows] = useState<DocumentType[]>([]);
  const [edit, setEdit] = useState<DocDraft | null>(null);
  const [savedEdit, setSavedEdit] = useState('');
  const dirty = !!edit && JSON.stringify(edit) !== savedEdit;
  const load = useCallback(async () => {
    const list = ((await db.from('document_types').select('*').order('sort_order').order('name')).data ?? []) as DocumentType[];
    setRows(list);
    return list;
  }, [db]);
  const open = (d: DocDraft) => {
    setEdit(d);
    setSavedEdit(JSON.stringify(d));
  };
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data fetch
    load().then((list) => list[0] && open(list[0]));
  }, [load]);

  const problems = (d: DocDraft) => {
    const out: string[] = [];
    if (!d.code.trim()) out.push(t('problem.code'));
    if (!d.name.trim()) out.push(t('problem.name'));
    if (!/\{SEQ:\d+\}/.test(d.request_no_format)) out.push(t('problem.seq', { token: '{SEQ:n}' }));
    const year = String(new Date().getFullYear());
    const clash = rows.find((o) => o.id !== d.id && formatPrefix(o.request_no_format, o.code, year) === formatPrefix(d.request_no_format, d.code, year));
    if (clash) out.push(t('problem.clash', { name: clash.name, token: '{DOC}' }));
    if ((d.clarify_criteria ?? []).some((c) => !c.label.trim())) out.push(t('problem.criterion'));
    return [...out, ...routeProblems(d.approval_route).map((c) => enumText('routeProblem', c))];
  };

  const save = async () => {
    if (!edit) return;
    const p = problems(edit);
    if (p.length) return notify(t('cannotSave', { problems: p.join('; ') }), 'error');
    const { id, code, name, form_no, request_no_format, approval_route, sort_order, is_active } = edit;
    const clarify_criteria = (edit.clarify_criteria ?? []).map((c) => ({ ...c, label: c.label.trim(), hint: c.hint.trim() }));
    const payload = { code: code.trim(), name: name.trim(), form_no: form_no?.trim() || null, request_no_format: request_no_format.trim(), approval_route, clarify_criteria, sort_order, is_active };
    const res = id
      ? await db.from('document_types').update(payload).eq('id', id).select().single()
      : await db.from('document_types').insert(payload).select().single();
    if (res.error) return notify(errMsg(res.error), 'error');
    notify(t('saved', { name: payload.name }));
    await load();
    open(res.data as DocumentType);
  };

  const route = edit?.approval_route ?? [];
  const setRoute = (r: RouteStep[]) => edit && setEdit({ ...edit, approval_route: r });
  const patchStep = (i: number, patch: Partial<RouteStep>) => setRoute(route.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const addStep = (stage: RouteStage) => {
    const at = route.reduce((last, s, j) => (ROUTE_STAGES.findIndex((x) => x.value === s.stage) <= ROUTE_STAGES.findIndex((x) => x.value === stage) ? j + 1 : last), 0);
    let n = 1;
    while (route.some((s) => s.step_code === `${stage}_${n}`)) n++;
    const step: RouteStep = stage === 'requestor'
      ? { step_code: `${stage}_${n}`, step_name: 'Approved By', stage, levels: andUp('manager') }
      : { step_code: `${stage}_${n}`, step_name: 'Approved Request By', stage, approvers: [] };
    setRoute([...route.slice(0, at), step, ...route.slice(at)]);
  };
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (route[j]?.stage !== route[i].stage) return;
    const next = [...route];
    [next[i], next[j]] = [next[j], next[i]];
    setRoute(next);
  };
  const criteria = edit?.clarify_criteria ?? [];
  const setCriteria = (c: ClarifyCriterion[]) => edit && setEdit({ ...edit, clarify_criteria: c });
  const patchCriterion = (i: number, patch: Partial<ClarifyCriterion>) => setCriteria(criteria.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const addCriterion = () => {
    let n = 1;
    while (criteria.some((c) => c.key === `custom_${n}`)) n++;
    setCriteria([...criteria, { key: `custom_${n}`, label: '', hint: '', required: false }]);
  };
  const moveCriterion = (i: number, d: -1 | 1) => {
    const next = [...criteria];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    setCriteria(next);
  };
  const personOpts = (selected: number[]) => profiles.filter((p) => p.is_active || selected.includes(p.id)).map((p) => ({ value: String(p.id), label: p.full_name }));
  const stepNo = (i: number) => <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">{i + 1}</span>;

  const stageBlock = (stage: RouteStage, hint: string) => {
    const items = route.map((s, i) => ({ s, i })).filter(({ s }) => s.stage === stage);
    const fixed = stage === 'receive';
    return (
      <div>
        <div className="mb-2 flex items-center gap-2">
          <span className="flex-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{enumText('routeStage', stage)}</span>
          {!fixed && <Button size="sm" variant="ghost" className="h-7" onClick={() => addStep(stage)}><Plus /> {t('addStep')}</Button>}
        </div>
        {items.length === 0 && <p className="rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground">{t('noSteps')}</p>}
        <ol className="space-y-1.5">
          {items.map(({ s, i }) => (
            <li key={s.step_code} className="flex items-start gap-2 rounded-lg border px-3 py-2">
              <span className="mt-1.5">{stepNo(i)}</span>
              <Input className="h-9 w-44 shrink-0" value={s.step_name} onChange={(e) => patchStep(i, { step_name: e.target.value })} />
              {stage === 'requestor' ? (
                <SelectField className="flex-1" value={s.levels?.[0] ?? ''} onChange={(v) => patchStep(i, { levels: andUp(v as PositionLevel) })}
                  options={POSITION_LEVELS.map((l) => ({ value: l.value, label: t('levelUp', { level: enumText('positionLevel', l.value) }) }))} />
              ) : (
                <MultiSelect className="flex-1" placeholder={t('selectPeople')} value={routeApprovers(s).map(String)}
                  options={personOpts(routeApprovers(s))} onChange={(v) => patchStep(i, { approvers: v.map(Number) })} />
              )}
              {!fixed && (
                <div className="flex shrink-0">
                  <Button size="icon" variant="ghost" className="size-9" disabled={route[i - 1]?.stage !== stage} onClick={() => move(i, -1)}><ArrowUp /></Button>
                  <Button size="icon" variant="ghost" className="size-9" disabled={route[i + 1]?.stage !== stage} onClick={() => move(i, 1)}><ArrowDown /></Button>
                  <Button size="icon" variant="ghost" className="size-9 text-destructive" onClick={() => setRoute(route.filter((_, j) => j !== i))}><Trash2 /></Button>
                </div>
              )}
            </li>
          ))}
        </ol>
        <p className="mt-2 text-xs text-muted-foreground">{hint}</p>
      </div>
    );
  };

  return (
    <div className="grid gap-5 lg:grid-cols-[18rem_minmax(0,1fr)] lg:items-start">
      <BoardGroup title={t('title')} color="#579bfc" count={rows.length}
        actions={<Button size="sm" onClick={() => open(newDoc((rows.at(-1)?.sort_order ?? 0) + 1))}><Plus /> {tc('add')}</Button>}>
        <ul className="divide-y">
          {rows.map((d) => (
            <li key={d.id}>
              <button type="button" onClick={() => open(d)}
                className={cn('flex w-full items-center gap-2 px-3 py-2.5 text-left hover:bg-muted/60', edit?.id === d.id && 'bg-primary/5')}>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{d.name}</span>
                  <span className="block font-mono text-xs text-muted-foreground">{previewCode(d.request_no_format, null, d.code)}</span>
                </span>
                {!d.is_active && <Badge variant="secondary">{t('inactive')}</Badge>}
              </button>
            </li>
          ))}
        </ul>
      </BoardGroup>

      {edit && (
        <div className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle>{edit.id ? edit.name || t('documentType') : t('new')}</CardTitle>
              <CardDescription>{t('description')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-12 gap-3">
                <TextField className="col-span-3" label={t('field.code')} required value={edit.code} disabled={!!edit.id}
                  onChange={(v) => setEdit({ ...edit, code: v.toUpperCase().replace(/[^A-Z0-9]/g, '') })}
                  helperText={edit.id ? t('field.codeFixed') : t('field.codeHelp', { token: '{DOC}' })} />
                <TextField className="col-span-6" label={t('field.name')} required value={edit.name} onChange={(v) => setEdit({ ...edit, name: v })} />
                <TextField className="col-span-3" label={t('field.formNo')} value={edit.form_no} placeholder="FM-SYS-004" onChange={(v) => setEdit({ ...edit, form_no: v })} />
                <div className="col-span-9">
                  <TextField label={t('field.requestNo')} required mono value={edit.request_no_format} onChange={(v) => setEdit({ ...edit, request_no_format: v })} />
                  <div className="mt-1.5 text-xs text-muted-foreground">
                    {t('preview')} <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-foreground">{previewCode(edit.request_no_format, null, edit.code) || '—'}</span>
                    {' '}· {t('field.continues')}
                  </div>
                </div>
                <TextField className="col-span-3" label={t('field.order')} type="number" value={edit.sort_order} onChange={(v) => setEdit({ ...edit, sort_order: Number(v) || 0 })} />
              </div>
              <TokenHints tokens={DOC_TOKENS} />
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={edit.is_active} onCheckedChange={(c) => setEdit({ ...edit, is_active: c })} /> {t('field.open')}
              </label>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('route.title')}</CardTitle>
              <CardDescription>{t('route.description', { name: edit.name || t('route.request') })}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              {stageBlock('requestor', t('route.hint.requestor'))}
              {stageBlock('receive', t('route.hint.receive'))}
              {stageBlock('authority', t('route.hint.authority'))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Sparkles className="size-4 text-primary" /> {t('criteria.title')}</CardTitle>
              <CardDescription>{t('criteria.description')}</CardDescription>
            </CardHeader>
            <CardContent>
              {criteria.length === 0 && <p className="mb-2 rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground">{t('criteria.none')}</p>}
              <ol className="space-y-1.5">
                {criteria.map((c, i) => (
                  <li key={c.key} className="flex items-center gap-2 rounded-lg border px-3 py-2">
                    {stepNo(i)}
                    <Input className="h-9 w-48 shrink-0" placeholder={t('criteria.name')} value={c.label} onChange={(e) => patchCriterion(i, { label: e.target.value })} />
                    <Input className="h-9 flex-1" placeholder={t('criteria.hint')} value={c.hint} onChange={(e) => patchCriterion(i, { hint: e.target.value })} />
                    <label className="flex shrink-0 items-center gap-1.5 text-xs">
                      <Switch checked={c.required} onCheckedChange={(v) => patchCriterion(i, { required: v })} /> {t('criteria.required')}
                    </label>
                    <div className="flex shrink-0">
                      <Button size="icon" variant="ghost" className="size-9" disabled={i === 0} onClick={() => moveCriterion(i, -1)}><ArrowUp /></Button>
                      <Button size="icon" variant="ghost" className="size-9" disabled={i === criteria.length - 1} onClick={() => moveCriterion(i, 1)}><ArrowDown /></Button>
                      <Button size="icon" variant="ghost" className="size-9 text-destructive" onClick={() => setCriteria(criteria.filter((_, j) => j !== i))}><Trash2 /></Button>
                    </div>
                  </li>
                ))}
              </ol>
              <div className="mt-2 flex gap-2">
                <Button size="sm" variant="ghost" className="h-7" onClick={addCriterion}><Plus /> {t('criteria.add')}</Button>
                <Button size="sm" variant="ghost" className="h-7" onClick={() => setCriteria(DEFAULT_CRITERIA)}><RotateCcw /> {t('criteria.reset')}</Button>
              </div>
            </CardContent>
          </Card>

          <div className="flex items-center justify-end gap-3">
            {problems(edit).length > 0 && <span className="text-xs text-destructive">{problems(edit)[0]}</span>}
            {route.some((s) => s.stage !== 'requestor' && !routeApprovers(s).length) && !problems(edit).length && (
              <span className="text-xs text-destructive">{t('needApprovers')}</span>
            )}
            <Button variant={dirty ? 'default' : 'outline'} disabled={!dirty} onClick={save}>{tc('save')}</Button>
          </div>
        </div>
      )}
    </div>
  );
}

type Holiday = { id: number; holiday_date: string; name: string };

function WorkingDaysAdmin() {
  const t = useTranslations('admin.workingDays');
  const tc = useTranslations('common');
  const db = dbClient();
  const { notify } = useApp();
  const [week, setWeek] = useState<number[] | null>(null);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [year, setYear] = useState(new Date().getFullYear());
  const [n, setN] = useState({ holiday_date: '', name: '' });
  const load = useCallback(async () => {
    const { data } = await db.from('app_settings').select('value').eq('key', WORK_WEEK_KEY).maybeSingle();
    setWeek((data?.value as number[] | undefined) ?? DEFAULT_WORK_WEEK);
    setHolidays(((await db.from('company_holidays').select('*').order('holiday_date')).data ?? []) as Holiday[]);
  }, [db]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data fetch
    load();
  }, [load]);

  const saveWeek = async (days: number[]) => {
    const { error } = await db.from('app_settings').upsert({ key: WORK_WEEK_KEY, value: days, updated_at: new Date().toISOString() });
    if (error) return notify(errMsg(error), 'error');
    setWeek(days);
    notify(t('saved'));
  };
  const addHoliday = async () => {
    const { error } = await db.from('company_holidays').insert({ holiday_date: n.holiday_date, name: n.name.trim() });
    if (error) return notify(errMsg(error), 'error');
    setYear(Number(n.holiday_date.slice(0, 4)));
    setN({ holiday_date: '', name: '' });
    load();
  };
  const removeHoliday = async (h: Holiday) => {
    if (!(await confirmDialog({ title: t('remove.title', { name: h.name }), description: t('remove.text'), confirmText: t('remove.confirm'), destructive: true }))) return;
    const { error } = await db.from('company_holidays').delete().eq('id', h.id);
    if (error) return notify(errMsg(error), 'error');
    load();
  };

  const current = WORK_WEEKS.find((w) => week && w.days.join() === [...week].sort().join());
  const years = [...new Set([new Date().getFullYear(), new Date().getFullYear() + 1, ...holidays.map((h) => Number(h.holiday_date.slice(0, 4)))])].sort();
  const inYear = holidays.filter((h) => h.holiday_date.startsWith(String(year)));
  // working days in the year with the current settings
  const cal = makeCalendar(week, holidays.map((h) => h.holiday_date));
  const workdays = cal.workdaysBetween(`${year - 1}-12-31`, `${year}-12-31`);

  return (
    <div className="grid max-w-5xl gap-5 lg:grid-cols-[22rem_minmax(0,1fr)] lg:items-start">
      <Card>
        <CardHeader>
          <CardTitle>{t('weekTitle')}</CardTitle>
          <CardDescription>{t('weekDescription')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {WORK_WEEKS.map((w) => (
            <button key={w.value} type="button" disabled={!week} onClick={() => current?.value !== w.value && saveWeek(w.days)}
              className={cn('flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors hover:bg-muted/60',
                current?.value === w.value && 'border-primary bg-primary/5')}>
              <span className={cn('flex size-4 items-center justify-center rounded-full border', current?.value === w.value && 'border-primary')}>
                {current?.value === w.value && <span className="size-2 rounded-full bg-primary" />}
              </span>
              <span className="flex-1 font-medium">{t(`week.${w.value}`)}</span>
              <span className="text-xs text-muted-foreground">{t('perWeek', { count: w.days.length })}</span>
            </button>
          ))}
          {week && !current && <p className="text-xs text-muted-foreground">{t('custom')}</p>}
        </CardContent>
      </Card>

      <BoardGroup title={t('holidays')} color="#e2445c" count={inYear.length}
        actions={
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">{t('workdaysIn', { count: workdays, year })}</span>
            <SelectField className="w-28" value={String(year)} onChange={(v) => setYear(Number(v))} options={years.map((y) => ({ value: String(y), label: String(y) }))} />
          </div>
        }>
        <Table className="board-table">
          <TableHeader><TableRow><TableHead className="w-44">{t('col.date')}</TableHead><TableHead className="text-left">{t('col.holiday')}</TableHead><TableHead className="w-16" /></TableRow></TableHeader>
          <TableBody>
            {inYear.map((h) => (
              <TableRow key={h.id}>
                <TableCell className="text-center">{fmtDate(h.holiday_date)} <span className="text-xs text-muted-foreground">{day(h.holiday_date).format('ddd')}</span></TableCell>
                <TableCell>{h.name}</TableCell>
                <TableCell className="text-center">
                  <Button size="icon" variant="ghost" className="size-8 text-destructive" onClick={() => removeHoliday(h)}><Trash2 /></Button>
                </TableCell>
              </TableRow>
            ))}
            {inYear.length === 0 && (
              <TableRow><TableCell colSpan={3} className="text-center text-sm text-muted-foreground">{t('noHolidays', { year })}</TableCell></TableRow>
            )}
            <TableRow>
              <TableCell><DateField value={n.holiday_date} onChange={(v) => setN({ ...n, holiday_date: v })} /></TableCell>
              <TableCell><Input placeholder={t('holidayPlaceholder')} className="h-9" value={n.name} onChange={(e) => setN({ ...n, name: e.target.value })} /></TableCell>
              <TableCell className="text-center"><Button size="sm" disabled={!n.holiday_date || !n.name.trim()} onClick={addHoliday}>{tc('add')}</Button></TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </BoardGroup>
    </div>
  );
}

function RulesAdmin() {
  const t = useTranslations('admin.notificationRules');
  const { options } = useOptions();
  const db = dbClient();
  const { notify } = useApp();
  const [rows, setRows] = useState<NotificationRule[]>([]);
  const load = useCallback(async () => setRows(((await db.from('notification_rules').select('*').order('event_code')).data ?? []) as NotificationRule[]), [db]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data fetch
    load();
  }, [load]);
  const upd = async (code: string, patch: Partial<NotificationRule>) => {
    const { error } = await db.from('notification_rules').update(patch).eq('event_code', code);
    if (error) notify(errMsg(error), 'error');
    load();
  };
  const recipientOpts = [{ value: 'explicit', label: t('explicit') }, ...options(MEMBER_ROLES)];
  return (
    <>
      <p className="mb-3 text-sm text-muted-foreground">
        {t('intro')}
      </p>
      <BoardGroup title={t('title')} color="#fdab3d" count={rows.length}>
        <Table className="board-table">
          <TableHeader><TableRow><TableHead className="text-left">{t('col.event')}</TableHead><TableHead className="min-w-80">{t('col.recipients')}</TableHead><TableHead>{t('col.inApp')}</TableHead><TableHead>{t('col.email')}</TableHead><TableHead>{t('col.repeat')}</TableHead><TableHead>{t('col.escalateAfter')}</TableHead><TableHead className="min-w-56">{t('col.escalateTo')}</TableHead><TableHead>{t('col.active')}</TableHead></TableRow></TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.event_code}>
                <TableCell><div className="font-semibold">{r.name}</div><div className="text-xs text-muted-foreground">{r.event_code}</div></TableCell>
                <TableCell className="whitespace-normal"><MultiSelect value={r.recipient_roles} onChange={(v) => upd(r.event_code, { recipient_roles: v })} options={recipientOpts} /></TableCell>
                {(['in_app', 'email'] as const).map((ch) => (
                  <TableCell key={ch} className="text-center">
                    <Checkbox checked={r.channels.includes(ch)} onCheckedChange={(c) => upd(r.event_code, { channels: c ? [...r.channels, ch] : r.channels.filter((x) => x !== ch) })} />
                  </TableCell>
                ))}
                {['task_overdue', 'fix_overdue'].includes(r.event_code) ? (
                  <>
                    <TableCell className="text-center"><Input type="number" defaultValue={r.escalation_days ?? 1} className="mx-auto h-8 w-20" onBlur={(e) => upd(r.event_code, { escalation_days: Math.max(1, Number(e.target.value)) })} /></TableCell>
                    <TableCell className="text-center"><Input type="number" defaultValue={r.escalate_after_days ?? ''} placeholder={t('never')} className="mx-auto h-8 w-20" onBlur={(e) => upd(r.event_code, { escalate_after_days: e.target.value ? Math.max(1, Number(e.target.value)) : null })} /></TableCell>
                    <TableCell className="whitespace-normal"><MultiSelect value={r.escalate_roles ?? []} onChange={(v) => upd(r.event_code, { escalate_roles: v })} options={options(MEMBER_ROLES)} placeholder="—" /></TableCell>
                  </>
                ) : <><TableCell className="text-center">-</TableCell><TableCell className="text-center">-</TableCell><TableCell className="text-center">-</TableCell></>}
                <TableCell className="text-center"><Switch checked={r.is_active} onCheckedChange={(c) => upd(r.event_code, { is_active: c })} /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </BoardGroup>
    </>
  );
}

function InsightRulesAdmin() {
  const t = useTranslations('admin.insightRules');
  const { options } = useOptions();
  const db = dbClient();
  const { notify } = useApp();
  const [rows, setRows] = useState<InsightRule[]>([]);
  const load = useCallback(async () => setRows(((await db.from('insight_rules').select('*').order('internal').order('code')).data ?? []) as InsightRule[]), [db]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data fetch
    load();
  }, [load]);
  const upd = async (code: string, patch: Partial<InsightRule>) => {
    const { error } = await db.from('insight_rules').update(patch).eq('code', code);
    if (error) notify(errMsg(error), 'error');
    load();
  };
  return (
    <>
      <p className="mb-3 text-sm text-muted-foreground">{t('intro')}</p>
      <BoardGroup title={t('title')} color="#784bd1" count={rows.length}>
        <Table className="board-table">
          <TableHeader><TableRow><TableHead className="text-left">{t('col.rule')}</TableHead><TableHead>{t('col.threshold')}</TableHead><TableHead>{t('col.severity')}</TableHead><TableHead>{t('col.visibility')}</TableHead><TableHead>{t('col.active')}</TableHead></TableRow></TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.code}>
                <TableCell className="whitespace-normal"><div className="font-semibold">{r.name}</div><div className="text-xs text-muted-foreground">{r.description}</div></TableCell>
                <TableCell className="text-center">{r.threshold_label
                  ? <div className="flex items-center justify-center gap-1"><Input type="number" defaultValue={r.threshold ?? ''} className="h-8 w-20" onBlur={(e) => upd(r.code, { threshold: e.target.value === '' ? null : Number(e.target.value) })} /><span className="text-xs text-muted-foreground">{r.threshold_label}</span></div>
                  : '-'}</TableCell>
                <TableCell className="w-36"><SelectField value={r.severity} onChange={(v) => upd(r.code, { severity: v })} options={options(INSIGHT_SEVERITIES)} /></TableCell>
                <TableCell className="text-center text-xs">{r.internal ? t('internal') : t('everyone')}</TableCell>
                <TableCell className="text-center"><Switch checked={r.is_active} onCheckedChange={(c) => upd(r.code, { is_active: c })} /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </BoardGroup>
    </>
  );
}

function KpiSettingsAdmin() {
  const t = useTranslations('admin.kpi');
  const tc = useTranslations('common');
  const { options } = useOptions();
  const db = dbClient();
  const { notify } = useApp();
  const [cats, setCats] = useState<string[]>([]);
  useEffect(() => {
    db.from('app_settings').select('value').eq('key', 'kpi_excluded_delay_categories').maybeSingle().then(({ data }) => setCats((data?.value as string[]) ?? []));
  }, [db]);
  return (
    <div className="max-w-2xl">
      <h3 className="mb-1 font-semibold">{t('title')}</h3>
      <p className="mb-3 text-sm text-muted-foreground">
        {t.rich('intro', { b: (c) => <b>{c}</b> })}
      </p>
      <MultiSelect label={t('excused')} value={cats} onChange={setCats} options={options(DELAY_CATEGORIES)} />
      <Button className="mt-3" onClick={async () => {
        const { error } = await db.from('app_settings').upsert({ key: 'kpi_excluded_delay_categories', value: cats, updated_at: new Date().toISOString() });
        notify(error ? errMsg(error) : t('saved'), error ? 'error' : 'success');
      }}>{tc('save')}</Button>
    </div>
  );
}
