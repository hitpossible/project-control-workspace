'use client';

import { ArrowDown, ArrowUp, Copy, Plus, Trash2 } from 'lucide-react';
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
import { DELAY_CATEGORIES, INSIGHT_SEVERITIES, MEMBER_ROLES, ROLE_LABELS } from '@/lib/constants';
import { errMsg, fmtDate } from '@/lib/format';
import { dbClient } from '@/lib/db/client';
import type { Department, DocumentType, InsightRule, NotificationRule, Position, PositionLevel, Profile, ProjectTemplate, ProjectType, Role, Section } from '@/lib/types';
import { POSITION_LEVELS, ROUTE_STAGES, andUp, defaultRoute, formatPrefix, routeApprovers, routeProblems, type RouteStage, type RouteStep } from '@/lib/approval';
import { cn } from '@/lib/utils';
import { DEFAULT_WORK_WEEK, WORK_WEEKS, WORK_WEEK_KEY, makeCalendar } from '@/lib/workdays';

const ROLE_OPTS = (Object.keys(ROLE_LABELS) as Role[]).map((r) => ({ value: r, label: ROLE_LABELS[r] }));
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

const TABS = ['Users & Roles', 'Departments', 'Document Types', 'Project Types', 'Project Templates', 'Project Code', 'Working Days', 'Notification Rules', 'Insight Rules', 'KPI Settings'];

export default function AdminPage() {
  const { hasRole } = useApp();
  const [tab, setTab] = useState(TABS[0]);
  if (!hasRole('admin')) return <Alert><AlertDescription>Administrator only.</AlertDescription></Alert>;
  return (
    <>
      <PageHeader title="Administration" subtitle="Master data, roles, workflow configuration" />
      <Tabs value={tab} onValueChange={setTab} className="mb-5">
        <TabsList ref={wheelScrollX} variant="line" className="no-scrollbar w-full justify-start overflow-x-auto border-b border-grid">
          {TABS.map((t) => <TabsTrigger key={t} value={t} className="flex-none px-3">{t}</TabsTrigger>)}
        </TabsList>
      </Tabs>
      {tab === TABS[0] && <UsersAdmin />}
      {tab === TABS[1] && <DepartmentsAdmin />}
      {tab === TABS[2] && <DocumentTypesAdmin />}
      {tab === TABS[3] && <TypesAdmin />}
      {tab === TABS[4] && <TemplatesAdmin />}
      {tab === TABS[5] && <SettingsAdmin />}
      {tab === TABS[6] && <WorkingDaysAdmin />}
      {tab === TABS[7] && <RulesAdmin />}
      {tab === TABS[8] && <InsightRulesAdmin />}
      {tab === TABS[9] && <KpiSettingsAdmin />}
    </>
  );
}

function UsersAdmin() {
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
      return res.ok ? null : ((await res.json().catch(() => null))?.error?.message ?? 'Failed');
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
    notify('User saved');
    setEdit(null);
    refreshProfiles();
  };

  const set = (patch: Partial<Profile> & { password?: string }) => setEdit((e) => ({ ...e, ...patch }));

  return (
    <>
      <BoardGroup title="Users" color="#579bfc" count={profiles.length}
        actions={<Button size="sm" onClick={() => setEdit({ roles: ['requestor'], is_active: true })}><Plus /> Add User</Button>}>
        <Table className="board-table">
          <TableHeader><TableRow><TableHead className="text-left">Name</TableHead><TableHead>Emp. ID</TableHead><TableHead>Username</TableHead><TableHead>Email</TableHead><TableHead>Department</TableHead><TableHead>Position</TableHead><TableHead>Roles</TableHead><TableHead>Active</TableHead></TableRow></TableHeader>
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
                  <div className="flex flex-wrap gap-1">{p.roles.map((r) => <span key={r} className="rounded bg-secondary px-1.5 py-0.5 text-xs">{ROLE_LABELS[r]}</span>)}</div>
                </TableCell>
                <TableCell className="text-center">{p.is_active ? 'Yes' : 'No'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </BoardGroup>
      {edit && (
        <Dialog open onOpenChange={(o) => !o && setEdit(null)}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader><DialogTitle>{edit.id ? 'Edit User' : 'Add User'}</DialogTitle></DialogHeader>
            <div className="grid grid-cols-12 gap-3">
              <TextField className="col-span-8" label="Full Name" required value={edit.full_name} onChange={(v) => set({ full_name: v })} />
              <TextField className="col-span-4" label="Employee ID" value={edit.employee_id} onChange={(v) => set({ employee_id: v })} />
              <TextField className="col-span-6" label="Username (AD)" value={edit.username} onChange={(v) => set({ username: v })} helperText="Company login name" />
              <TextField className="col-span-6" label="Email" value={edit.email} onChange={(v) => set({ email: v })} />
              <TextField className="col-span-12" label={edit.id ? 'Set local password' : 'Local password (optional)'} type="password" value={edit.password} onChange={(v) => set({ password: v })}
                helperText="Leave empty for AD login. Min 8 characters — only for accounts without AD (e.g. break-glass admin)." />
              <SelectField className="col-span-6" label="Department" allowEmpty value={edit.department_id?.toString()} options={deptOpts}
                onChange={(v) => set({ department_id: idOrNull(v), section_id: idOrNull(v) === edit.department_id ? edit.section_id : null })} />
              <SelectField className="col-span-6" label="Section" allowEmpty value={edit.section_id?.toString()} options={sectionOpts}
                disabled={!edit.department_id} onChange={(v) => set({ section_id: idOrNull(v) })} />
              <SelectField className="col-span-12" label="Position" allowEmpty value={edit.position_id?.toString()} options={positionOpts}
                onChange={(v) => set({ position_id: idOrNull(v) })}
                helperText={`Synced from AD at each login. Approval: ${POSITION_LEVELS.filter((l) => l.value !== 'staff').map((l) => l.position).join(', ')}`} />
              <TextField className="col-span-8" label="Telephone" value={edit.telephone} onChange={(v) => set({ telephone: v })} />
              <TextField className="col-span-4" label="Ext." value={edit.extension} onChange={(v) => set({ extension: v })} />
              <MultiSelect className="col-span-12" label="Roles" value={edit.roles ?? []} onChange={(v) => set({ roles: v as Role[] })} options={ROLE_OPTS} />
              <label className="col-span-12 flex items-center gap-2 text-sm"><Switch checked={!!edit.is_active} onCheckedChange={(c) => set({ is_active: c })} /> Active</label>
            </div>
            <DialogFooter><Button variant="outline" onClick={() => setEdit(null)}>Cancel</Button><Button onClick={save}>Save</Button></DialogFooter>
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
      <p className="mb-3 text-sm text-muted-foreground">Code is a short unique key (e.g. SYS, PRD), saved in upper case. Used for each user&apos;s Department / Section in Users &amp; Roles. Renaming updates the users that have it; inactive entries are hidden from the list.</p>
      <div className="grid grid-cols-12 gap-5">
        <div className="col-span-12 lg:col-span-6">
          <BoardGroup title="Departments" color="#00c875" count={departments.length}>
            <Table className="board-table">
              <TableHeader><TableRow><TableHead className="w-24 text-left">Code</TableHead><TableHead className="min-w-36 text-left">Name</TableHead><TableHead className="w-20">Sections</TableHead><TableHead>Active</TableHead></TableRow></TableHeader>
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
                  <TableCell><Input placeholder="Code" className="h-8 min-w-20 font-mono uppercase" value={newDept.code} onChange={(e) => setNewDept({ ...newDept, code: e.target.value })} /></TableCell>
                  <TableCell><Input placeholder="New department" className="h-8" value={newDept.name} onChange={(e) => setNewDept({ ...newDept, name: e.target.value })} /></TableCell>
                  <TableCell />
                  <TableCell className="text-center"><Button size="sm" disabled={!newDept.name.trim()} onClick={async () => {
                    if (await run(db.from('departments').insert({ code: normCode(newDept.code), name: newDept.name.trim() }))) setNewDept({ code: '', name: '' });
                  }}>Add</Button></TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </BoardGroup>
        </div>
        <div className="col-span-12 lg:col-span-6">
          {current && (
            <BoardGroup title={`Sections — ${current.name}`} color="#579bfc" count={deptSections.length}>
              <Table className="board-table">
                <TableHeader><TableRow><TableHead className="w-24 text-left">Code</TableHead><TableHead className="min-w-36 text-left">Name</TableHead><TableHead>Active</TableHead></TableRow></TableHeader>
                <TableBody>
                  {deptSections.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell className="w-24"><Input key={s.code} defaultValue={s.code ?? ''} placeholder="—" className="h-8 min-w-20 font-mono uppercase" onBlur={(e) => normCode(e.target.value) !== s.code && setCode('sections', s.id, e.target.value)} /></TableCell>
                      <TableCell><Input defaultValue={s.name} className="h-8" onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== s.name && rename('sections', s.id, e.target.value)} /></TableCell>
                      <TableCell className="w-24 text-center"><Switch checked={s.is_active} onCheckedChange={(c) => run(db.from('sections').update({ is_active: c }).eq('id', s.id))} /></TableCell>
                    </TableRow>
                  ))}
                  <TableRow>
                    <TableCell><Input placeholder="Code" className="h-8 min-w-20 font-mono uppercase" value={newSection.code} onChange={(e) => setNewSection({ ...newSection, code: e.target.value })} /></TableCell>
                    <TableCell><Input placeholder="New section" className="h-8" value={newSection.name} onChange={(e) => setNewSection({ ...newSection, name: e.target.value })} /></TableCell>
                    <TableCell className="text-center"><Button size="sm" disabled={!newSection.name.trim()} onClick={async () => {
                      if (await run(db.from('sections').insert({ department_id: current.id, code: normCode(newSection.code), name: newSection.name.trim() }))) setNewSection({ code: '', name: '' });
                    }}>Add</Button></TableCell>
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
      <p className="mb-3 text-sm text-muted-foreground">The code is used in the Project Code ({'{TYPE}'} token), e.g. SYS-WEB-2026-001.</p>
      <BoardGroup title="Project Types" color="#a25ddc" count={rows.length}>
        <Table className="board-table">
          <TableHeader><TableRow><TableHead>Code</TableHead><TableHead className="text-left">Name</TableHead><TableHead>Active</TableHead></TableRow></TableHeader>
          <TableBody>
            {rows.map((t) => (
              <TableRow key={t.id}>
                <TableCell className="w-28 text-center font-semibold">{t.code}</TableCell>
                <TableCell><Input defaultValue={t.name} className="h-8" onBlur={(e) => e.target.value !== t.name && upd(t.id, { name: e.target.value })} /></TableCell>
                <TableCell className="w-24 text-center"><Switch checked={t.is_active} onCheckedChange={(c) => upd(t.id, { is_active: c })} /></TableCell>
              </TableRow>
            ))}
            <TableRow>
              <TableCell><Input placeholder="CODE" className="h-8" value={n.code} onChange={(e) => setN({ ...n, code: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') })} /></TableCell>
              <TableCell><Input placeholder="Name" className="h-8" value={n.name} onChange={(e) => setN({ ...n, name: e.target.value })} /></TableCell>
              <TableCell className="text-center"><Button size="sm" disabled={!n.code || !n.name} onClick={async () => {
                const { error } = await db.from('project_types').insert(n);
                if (error) return notify(errMsg(error), 'error');
                setN({ code: '', name: '' }); load();
              }}>Add</Button></TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </BoardGroup>
    </>
  );
}

function TemplatesAdmin() {
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

  const problems = edit ? draftProblems(edit) : [];
  const save = async () => {
    if (!edit) return;
    if (problems.length) return notify(problems[0], 'error');
    const payload = fromDraft(edit);
    const res = edit.id ? await db.from('project_templates').update(payload).eq('id', edit.id) : await db.from('project_templates').insert(payload);
    if (res.error) return notify(errMsg(res.error), 'error');
    notify('Template saved');
    setEdit(null);
    load();
  };

  const open = (t?: ProjectTemplate) => setEdit(toDraft(t));
  const duplicate = () => edit && setEdit({ ...edit, id: undefined, code: `${edit.code ?? ''}-COPY`, name: `${edit.name ?? ''} (copy)` });
  const totalDays = (t: ProjectTemplate) => t.default_activities.reduce((s, a) => s + Math.max(1, a.duration_days ?? 1), 0);

  return (
    <>
      <p className="mb-3 text-sm text-muted-foreground">Templates define the default activities (User Control Plan), default internal tasks and milestones created when a request is converted.</p>
      <BoardGroup title="Project Templates" color="#00c875" count={rows.length} actions={<Button size="sm" onClick={() => open()}><Plus /> Add Template</Button>}>
        <Table className="board-table">
          <TableHeader><TableRow><TableHead>Code</TableHead><TableHead className="text-left">Name</TableHead><TableHead>Type</TableHead><TableHead className="text-left">Activities</TableHead><TableHead>Duration</TableHead><TableHead>Active</TableHead></TableRow></TableHeader>
          <TableBody>
            {rows.map((t) => (
              <TableRow key={t.id} className={cn('cursor-pointer', !t.is_active && 'opacity-50')} onClick={() => open(t)}>
                <TableCell className="font-semibold">{t.code}</TableCell>
                <TableCell>{t.name}</TableCell>
                <TableCell className="text-center">{types.find((x) => x.id === t.project_type_id)?.name}</TableCell>
                <TableCell className="whitespace-normal">
                  <div className="flex flex-wrap items-center gap-1">
                    {t.default_activities.map((a, i) => (
                      <span key={i} className={cn('rounded px-1.5 py-0.5 text-xs', a.is_milestone ? 'bg-amber-100 text-amber-900' : 'bg-secondary')}>{a.name}</span>
                    ))}
                  </div>
                </TableCell>
                <TableCell className="text-center text-muted-foreground">{totalDays(t)} days</TableCell>
                <TableCell className="text-center">{t.is_active ? 'Yes' : 'No'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </BoardGroup>
      {edit && (
        <Dialog open onOpenChange={(o) => !o && setEdit(null)}>
          <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-5xl">
            <DialogHeader><DialogTitle>{edit.id ? `Edit Template — ${edit.code}` : 'Add Template'}</DialogTitle></DialogHeader>
            <TemplateEditor draft={edit} onChange={setEdit} types={types} />
            <DialogFooter className="items-center sm:justify-between">
              {edit.id ? <Button variant="ghost" onClick={duplicate}><Copy /> Duplicate as new</Button> : <span />}
              <div className="flex items-center gap-2">
                {problems.length > 0 && <span className="text-xs text-destructive">{problems[0]}</span>}
                <Button variant="outline" onClick={() => setEdit(null)}>Cancel</Button>
                <Button onClick={save} disabled={problems.length > 0}>Save</Button>
              </div>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

const TOKENS: [string, string][] = [['{TYPE}', 'Project type code'], ['{YYYY}', 'Year, 4 digits'], ['{YY}', 'Year, 2 digits'], ['{SEQ:n}', 'Running number, n digits — restarts for each new prefix']];
const DOC_TOKENS: [string, string][] = [['{DOC}', 'Document type code'], ...TOKENS.slice(1)];

/** Same substitution as generateCode() on the server, with the first sequence number */
function previewCode(format: string | undefined, type: string | null, doc: string | null = null) {
  if (!format) return '';
  const yyyy = String(new Date().getFullYear());
  let fmt = format.replaceAll('{YYYY}', yyyy).replaceAll('{YY}', yyyy.slice(2)).replaceAll('{DOC}', doc ?? '');
  fmt = type ? fmt.replaceAll('{TYPE}', type) : fmt.replaceAll('-{TYPE}', '').replaceAll('{TYPE}', '');
  return fmt.replace(/\{SEQ:(\d+)\}/g, (_, n) => '1'.padStart(Number(n), '0'));
}

function TokenHints({ tokens }: { tokens: [string, string][] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {tokens.map(([t, d]) => (
        <Tooltip key={t}>
          <TooltipTrigger asChild><Badge variant="outline" className="cursor-help font-mono">{t}</Badge></TooltipTrigger>
          <TooltipContent>{d}</TooltipContent>
        </Tooltip>
      ))}
      <span className="self-center text-xs text-muted-foreground">Hover a token to see what it does</span>
    </div>
  );
}

function SettingsAdmin() {
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
      const t = (data as ProjectType[] | null)?.[0];
      if (t) setTypeCode(t.code);
    });
  }, [db]);
  const save = async () => {
    const { error } = await db.from('app_settings').update({ value: vals[key], updated_at: new Date().toISOString() }).eq('key', key);
    if (!error) setSaved({ ...saved, [key]: vals[key] });
    notify(error ? errMsg(error) : 'Saved', error ? 'error' : 'success');
  };

  return (
    <Card className="max-w-xl">
      <CardHeader>
        <CardTitle>Project Code</CardTitle>
        <CardDescription>How new project codes are generated. Request numbers are set per document type in Admin → Document Types.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div>
          <div className="flex items-end gap-2">
            <TextField className="flex-1" label="Project Code" mono value={vals[key]} onChange={(v) => setVals({ ...vals, [key]: v })} />
            <Button variant={vals[key] !== saved[key] ? 'default' : 'outline'} className="h-9" disabled={vals[key] === saved[key]} onClick={save}>Save</Button>
          </div>
          <div className="mt-1.5 text-xs text-muted-foreground">
            Next looks like <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-foreground">{previewCode(vals[key], typeCode) || '—'}</span>
          </div>
        </div>
        <div className="border-t pt-4"><TokenHints tokens={TOKENS} /></div>
      </CardContent>
    </Card>
  );
}

type DocDraft = Omit<DocumentType, 'id'> & { id?: number };
const newDoc = (sort: number): DocDraft => ({
  code: '', name: '', form_no: '', request_no_format: '{DOC}-{YYYY}-{SEQ:4}', approval_route: defaultRoute(), sort_order: sort, is_active: true,
});

function DocumentTypesAdmin() {
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
    if (!d.code.trim()) out.push('code is required');
    if (!d.name.trim()) out.push('name is required');
    if (!/\{SEQ:\d+\}/.test(d.request_no_format)) out.push('the request number format needs a {SEQ:n} running number');
    const year = String(new Date().getFullYear());
    const clash = rows.find((o) => o.id !== d.id && formatPrefix(o.request_no_format, o.code, year) === formatPrefix(d.request_no_format, d.code, year));
    if (clash) out.push(`the request number format gives the same numbers as ${clash.name} — use {DOC} or another prefix`);
    return [...out, ...routeProblems(d.approval_route)];
  };

  const save = async () => {
    if (!edit) return;
    const p = problems(edit);
    if (p.length) return notify(`Cannot save: ${p.join('; ')}`, 'error');
    const { id, code, name, form_no, request_no_format, approval_route, sort_order, is_active } = edit;
    const payload = { code: code.trim(), name: name.trim(), form_no: form_no?.trim() || null, request_no_format: request_no_format.trim(), approval_route, sort_order, is_active };
    const res = id
      ? await db.from('document_types').update(payload).eq('id', id).select().single()
      : await db.from('document_types').insert(payload).select().single();
    if (res.error) return notify(errMsg(res.error), 'error');
    notify(`${payload.name} saved`);
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
  const personOpts = (selected: number[]) => profiles.filter((p) => p.is_active || selected.includes(p.id)).map((p) => ({ value: String(p.id), label: p.full_name }));
  const stepNo = (i: number) => <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">{i + 1}</span>;

  const stageBlock = (stage: RouteStage, hint: string) => {
    const items = route.map((s, i) => ({ s, i })).filter(({ s }) => s.stage === stage);
    const fixed = stage === 'receive';
    return (
      <div>
        <div className="mb-2 flex items-center gap-2">
          <span className="flex-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{ROUTE_STAGES.find((x) => x.value === stage)!.label}</span>
          {!fixed && <Button size="sm" variant="ghost" className="h-7" onClick={() => addStep(stage)}><Plus /> Add step</Button>}
        </div>
        {items.length === 0 && <p className="rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground">No steps</p>}
        <ol className="space-y-1.5">
          {items.map(({ s, i }) => (
            <li key={s.step_code} className="flex items-start gap-2 rounded-lg border px-3 py-2">
              <span className="mt-1.5">{stepNo(i)}</span>
              <Input className="h-9 w-44 shrink-0" value={s.step_name} onChange={(e) => patchStep(i, { step_name: e.target.value })} />
              {stage === 'requestor' ? (
                <SelectField className="flex-1" value={s.levels?.[0] ?? ''} onChange={(v) => patchStep(i, { levels: andUp(v as PositionLevel) })}
                  options={POSITION_LEVELS.map((l) => ({ value: l.value, label: `${l.label} up` }))} />
              ) : (
                <MultiSelect className="flex-1" placeholder="Select people…" value={routeApprovers(s).map(String)}
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
      <BoardGroup title="Document Types" color="#579bfc" count={rows.length}
        actions={<Button size="sm" onClick={() => open(newDoc((rows.at(-1)?.sort_order ?? 0) + 1))}><Plus /> Add</Button>}>
        <ul className="divide-y">
          {rows.map((t) => (
            <li key={t.id}>
              <button type="button" onClick={() => open(t)}
                className={cn('flex w-full items-center gap-2 px-3 py-2.5 text-left hover:bg-muted/60', edit?.id === t.id && 'bg-primary/5')}>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{t.name}</span>
                  <span className="block font-mono text-xs text-muted-foreground">{previewCode(t.request_no_format, null, t.code)}</span>
                </span>
                {!t.is_active && <Badge variant="secondary">Inactive</Badge>}
              </button>
            </li>
          ))}
        </ul>
      </BoardGroup>

      {edit && (
        <div className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle>{edit.id ? edit.name || 'Document type' : 'New document type'}</CardTitle>
              <CardDescription>Each document type has its own request number (running number) and approval route</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-12 gap-3">
                <TextField className="col-span-3" label="Code" required value={edit.code} disabled={!!edit.id}
                  onChange={(v) => setEdit({ ...edit, code: v.toUpperCase().replace(/[^A-Z0-9]/g, '') })}
                  helperText={edit.id ? 'Fixed once created' : '{DOC} in the number'} />
                <TextField className="col-span-6" label="Name" required value={edit.name} onChange={(v) => setEdit({ ...edit, name: v })} />
                <TextField className="col-span-3" label="Form No." value={edit.form_no} placeholder="FM-SYS-004" onChange={(v) => setEdit({ ...edit, form_no: v })} />
                <div className="col-span-9">
                  <TextField label="Request Number" required mono value={edit.request_no_format} onChange={(v) => setEdit({ ...edit, request_no_format: v })} />
                  <div className="mt-1.5 text-xs text-muted-foreground">
                    Next looks like <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-foreground">{previewCode(edit.request_no_format, null, edit.code) || '—'}</span>
                    {' '}· numbering continues where it left off for the same prefix
                  </div>
                </div>
                <TextField className="col-span-3" label="Order" type="number" value={edit.sort_order} onChange={(v) => setEdit({ ...edit, sort_order: Number(v) || 0 })} />
              </div>
              <TokenHints tokens={DOC_TOKENS} />
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={edit.is_active} onCheckedChange={(c) => setEdit({ ...edit, is_active: c })} /> Open for new requests
              </label>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Approval Route</CardTitle>
              <CardDescription>The steps every {edit.name || 'request'} goes through, in order. Changes apply to requests submitted from now on.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              {stageBlock('requestor', "Anyone at that position or higher in the requestor's own department (positions come from AD).")}
              {stageBlock('receive', 'Receives the request and fills in Project Type / Template / Project Leader.')}
              {stageBlock('authority', 'Pick one or more people per step — whoever acts first completes it.')}
            </CardContent>
          </Card>

          <div className="flex items-center justify-end gap-3">
            {problems(edit).length > 0 && <span className="text-xs text-destructive">{problems(edit)[0]}</span>}
            {route.some((s) => s.stage !== 'requestor' && !routeApprovers(s).length) && !problems(edit).length && (
              <span className="text-xs text-destructive">Requests can&apos;t be submitted until every step has an approver</span>
            )}
            <Button variant={dirty ? 'default' : 'outline'} disabled={!dirty} onClick={save}>Save</Button>
          </div>
        </div>
      )}
    </div>
  );
}

type Holiday = { id: number; holiday_date: string; name: string };

function WorkingDaysAdmin() {
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
    notify('Work week saved');
  };
  const addHoliday = async () => {
    const { error } = await db.from('company_holidays').insert({ holiday_date: n.holiday_date, name: n.name.trim() });
    if (error) return notify(errMsg(error), 'error');
    setYear(Number(n.holiday_date.slice(0, 4)));
    setN({ holiday_date: '', name: '' });
    load();
  };
  const removeHoliday = async (h: Holiday) => {
    if (!confirm(`Remove ${h.name}?`)) return;
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
          <CardTitle>Work Week</CardTitle>
          <CardDescription>Days the company works. Template activities at Convert and delay / schedule variance count only working days.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {WORK_WEEKS.map((w) => (
            <button key={w.value} type="button" disabled={!week} onClick={() => current?.value !== w.value && saveWeek(w.days)}
              className={cn('flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors hover:bg-muted/60',
                current?.value === w.value && 'border-primary bg-primary/5')}>
              <span className={cn('flex size-4 items-center justify-center rounded-full border', current?.value === w.value && 'border-primary')}>
                {current?.value === w.value && <span className="size-2 rounded-full bg-primary" />}
              </span>
              <span className="flex-1 font-medium">{w.label}</span>
              <span className="text-xs text-muted-foreground">{w.days.length} days / week</span>
            </button>
          ))}
          {week && !current && <p className="text-xs text-muted-foreground">Custom work week set in the database — pick one to replace it.</p>}
        </CardContent>
      </Card>

      <BoardGroup title="Company Holidays" color="#e2445c" count={inYear.length}
        actions={
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">{workdays} working days in {year}</span>
            <SelectField className="w-28" value={String(year)} onChange={(v) => setYear(Number(v))} options={years.map((y) => ({ value: String(y), label: String(y) }))} />
          </div>
        }>
        <Table className="board-table">
          <TableHeader><TableRow><TableHead className="w-44">Date</TableHead><TableHead className="text-left">Holiday</TableHead><TableHead className="w-16" /></TableRow></TableHeader>
          <TableBody>
            {inYear.map((h) => (
              <TableRow key={h.id}>
                <TableCell className="text-center">{fmtDate(h.holiday_date)} <span className="text-xs text-muted-foreground">{['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(`${h.holiday_date}T00:00:00Z`).getUTCDay()]}</span></TableCell>
                <TableCell>{h.name}</TableCell>
                <TableCell className="text-center">
                  <Button size="icon" variant="ghost" className="size-8 text-destructive" onClick={() => removeHoliday(h)}><Trash2 /></Button>
                </TableCell>
              </TableRow>
            ))}
            {inYear.length === 0 && (
              <TableRow><TableCell colSpan={3} className="text-center text-sm text-muted-foreground">No holidays in {year}</TableCell></TableRow>
            )}
            <TableRow>
              <TableCell><DateField value={n.holiday_date} onChange={(v) => setN({ ...n, holiday_date: v })} /></TableCell>
              <TableCell><Input placeholder="e.g. Songkran Festival" className="h-9" value={n.name} onChange={(e) => setN({ ...n, name: e.target.value })} /></TableCell>
              <TableCell className="text-center"><Button size="sm" disabled={!n.holiday_date || !n.name.trim()} onClick={addHoliday}>Add</Button></TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </BoardGroup>
    </div>
  );
}

function RulesAdmin() {
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
  const recipientOpts = [{ value: 'explicit', label: 'Directly involved person' }, ...MEMBER_ROLES];
  return (
    <>
      <p className="mb-3 text-sm text-muted-foreground">
        Recipients are resolved per event from the Project Team roles. “Directly involved person” = task owner, approver, requestor, activity PIC. Overdue reminders repeat every N days and escalate to more roles (e.g. Manager) after N days overdue.
      </p>
      <BoardGroup title="Notification Rules" color="#fdab3d" count={rows.length}>
        <Table className="board-table">
          <TableHeader><TableRow><TableHead className="text-left">Event</TableHead><TableHead className="min-w-80">Recipients</TableHead><TableHead>In-app</TableHead><TableHead>E-mail</TableHead><TableHead>Repeat every (days)</TableHead><TableHead>Escalate after (days)</TableHead><TableHead className="min-w-56">Escalate to</TableHead><TableHead>Active</TableHead></TableRow></TableHeader>
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
                    <TableCell className="text-center"><Input type="number" defaultValue={r.escalate_after_days ?? ''} placeholder="never" className="mx-auto h-8 w-20" onBlur={(e) => upd(r.event_code, { escalate_after_days: e.target.value ? Math.max(1, Number(e.target.value)) : null })} /></TableCell>
                    <TableCell className="whitespace-normal"><MultiSelect value={r.escalate_roles ?? []} onChange={(v) => upd(r.event_code, { escalate_roles: v })} options={MEMBER_ROLES} placeholder="—" /></TableCell>
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
      <p className="mb-3 text-sm text-muted-foreground">Smart Insight rules (PRD §22). Set the X thresholds, severity and on/off. Internal rules are only shown to the System Service team.</p>
      <BoardGroup title="Insight Rules" color="#784bd1" count={rows.length}>
        <Table className="board-table">
          <TableHeader><TableRow><TableHead className="text-left">Rule</TableHead><TableHead>Threshold (X)</TableHead><TableHead>Severity</TableHead><TableHead>Visibility</TableHead><TableHead>Active</TableHead></TableRow></TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.code}>
                <TableCell className="whitespace-normal"><div className="font-semibold">{r.name}</div><div className="text-xs text-muted-foreground">{r.description}</div></TableCell>
                <TableCell className="text-center">{r.threshold_label
                  ? <div className="flex items-center justify-center gap-1"><Input type="number" defaultValue={r.threshold ?? ''} className="h-8 w-20" onBlur={(e) => upd(r.code, { threshold: e.target.value === '' ? null : Number(e.target.value) })} /><span className="text-xs text-muted-foreground">{r.threshold_label}</span></div>
                  : '-'}</TableCell>
                <TableCell className="w-36"><SelectField value={r.severity} onChange={(v) => upd(r.code, { severity: v })} options={INSIGHT_SEVERITIES} /></TableCell>
                <TableCell className="text-center text-xs">{r.internal ? 'Internal team' : 'Everyone'}</TableCell>
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
  const db = dbClient();
  const { notify } = useApp();
  const [cats, setCats] = useState<string[]>([]);
  useEffect(() => {
    db.from('app_settings').select('value').eq('key', 'kpi_excluded_delay_categories').maybeSingle().then(({ data }) => setCats((data?.value as string[]) ?? []));
  }, [db]);
  return (
    <div className="max-w-2xl">
      <h3 className="mb-1 font-semibold">Fair individual KPI</h3>
      <p className="mb-3 text-sm text-muted-foreground">
        Late tasks whose Delay Category is in this list are <b>excused</b> — they are not counted against the owner&apos;s on-time rate, overdue count or average delay
        (e.g. waiting for the user or an external vendor). PRD §23.
      </p>
      <MultiSelect label="Excused delay categories" value={cats} onChange={setCats} options={DELAY_CATEGORIES.map((c) => ({ value: c, label: c }))} />
      <Button className="mt-3" onClick={async () => {
        const { error } = await db.from('app_settings').upsert({ key: 'kpi_excluded_delay_categories', value: cats, updated_at: new Date().toISOString() });
        notify(error ? errMsg(error) : 'KPI settings saved', error ? 'error' : 'success');
      }}>Save</Button>
    </div>
  );
}
