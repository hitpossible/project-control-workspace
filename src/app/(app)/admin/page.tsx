'use client';

import { Plus } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useApp } from '@/components/AppProvider';
import { BoardGroup, MultiSelect, PageHeader, Person, SelectField, TextField } from '@/components/common';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DELAY_CATEGORIES, INSIGHT_SEVERITIES, MEMBER_ROLES, ROLE_LABELS } from '@/lib/constants';
import { errMsg } from '@/lib/format';
import { dbClient } from '@/lib/db/client';
import type { InsightRule, NotificationRule, Profile, ProjectTemplate, ProjectType, Role } from '@/lib/types';
import { cn } from '@/lib/utils';

const ROLE_OPTS = (Object.keys(ROLE_LABELS) as Role[]).map((r) => ({ value: r, label: ROLE_LABELS[r] }));
const TABS = ['Users & Roles', 'Project Types', 'Project Templates', 'Numbering', 'Notification Rules', 'Insight Rules', 'KPI Settings'];

export default function AdminPage() {
  const { hasRole } = useApp();
  const [tab, setTab] = useState(TABS[0]);
  if (!hasRole('admin')) return <Alert><AlertDescription>Administrator only.</AlertDescription></Alert>;
  return (
    <>
      <PageHeader title="Administration" subtitle="Master data, roles, workflow configuration" />
      <Tabs value={tab} onValueChange={setTab} className="mb-5">
        <TabsList variant="line" className="w-full justify-start overflow-x-auto border-b border-grid">
          {TABS.map((t) => <TabsTrigger key={t} value={t} className="flex-none px-3">{t}</TabsTrigger>)}
        </TabsList>
      </Tabs>
      {tab === TABS[0] && <UsersAdmin />}
      {tab === TABS[1] && <TypesAdmin />}
      {tab === TABS[2] && <TemplatesAdmin />}
      {tab === TABS[3] && <SettingsAdmin />}
      {tab === TABS[4] && <RulesAdmin />}
      {tab === TABS[5] && <InsightRulesAdmin />}
      {tab === TABS[6] && <KpiSettingsAdmin />}
    </>
  );
}

function UsersAdmin() {
  const db = dbClient();
  const { profiles, refreshProfiles, notify } = useApp();
  const [edit, setEdit] = useState<(Partial<Profile> & { password?: string }) | null>(null);

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
        full_name: edit.full_name, employee_id: edit.employee_id, department: edit.department, section: edit.section,
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
          <TableHeader><TableRow><TableHead className="text-left">Name</TableHead><TableHead>Emp. ID</TableHead><TableHead>Username</TableHead><TableHead>Email</TableHead><TableHead>Department</TableHead><TableHead>Roles</TableHead><TableHead>Active</TableHead></TableRow></TableHeader>
          <TableBody>
            {profiles.map((p) => (
              <TableRow key={p.id} className={cn('cursor-pointer', !p.is_active && 'opacity-50')} onClick={() => setEdit({ ...p })}>
                <TableCell><Person name={p.full_name} /></TableCell>
                <TableCell className="text-center">{p.employee_id}</TableCell>
                <TableCell className="text-center">{p.username}</TableCell>
                <TableCell className="text-center">{p.email}</TableCell>
                <TableCell className="text-center">{p.department}</TableCell>
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
              <TextField className="col-span-6" label="Department" value={edit.department} onChange={(v) => set({ department: v })} />
              <TextField className="col-span-6" label="Section" value={edit.section} onChange={(v) => set({ section: v })} />
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
  const [edit, setEdit] = useState<(Partial<ProjectTemplate> & { json: string; evid: string }) | null>(null);
  const load = useCallback(async () => {
    setRows(((await db.from('project_templates').select('*').order('name')).data ?? []) as ProjectTemplate[]);
    setTypes(((await db.from('project_types').select('*').order('name')).data ?? []) as ProjectType[]);
  }, [db]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data fetch
    load();
  }, [load]);

  const save = async () => {
    if (!edit) return;
    let acts, evid;
    try {
      acts = JSON.parse(edit.json);
      evid = JSON.parse(edit.evid);
      if (!Array.isArray(acts) || !Array.isArray(evid)) throw new Error('Must be JSON arrays');
    } catch (e) {
      return notify(`Invalid JSON: ${errMsg(e)}`, 'error');
    }
    const payload = { code: edit.code, name: edit.name, description: edit.description ?? null, project_type_id: edit.project_type_id ?? null, default_activities: acts, evidence_checklist: evid, is_active: edit.is_active ?? true };
    const res = edit.id ? await db.from('project_templates').update(payload).eq('id', edit.id) : await db.from('project_templates').insert(payload);
    if (res.error) return notify(errMsg(res.error), 'error');
    notify('Template saved');
    setEdit(null);
    load();
  };

  const open = (t?: ProjectTemplate) => setEdit(t
    ? { ...t, json: JSON.stringify(t.default_activities, null, 2), evid: JSON.stringify(t.evidence_checklist, null, 2) }
    : { code: '', name: '', is_active: true, json: '[\n  {"name":"Requirement","pic_label":"System","duration_days":5,"tasks":[{"name":"Requirement document","task_type":"doc","duration_days":3}]}\n]', evid: '[]' });

  return (
    <>
      <p className="mb-3 text-sm text-muted-foreground">Templates define the default activities (User Control Plan), default internal tasks and milestones created when a request is converted.</p>
      <BoardGroup title="Project Templates" color="#00c875" count={rows.length} actions={<Button size="sm" onClick={() => open()}><Plus /> Add Template</Button>}>
        <Table className="board-table">
          <TableHeader><TableRow><TableHead>Code</TableHead><TableHead className="text-left">Name</TableHead><TableHead>Type</TableHead><TableHead className="text-left">Activities</TableHead><TableHead>Active</TableHead></TableRow></TableHeader>
          <TableBody>
            {rows.map((t) => (
              <TableRow key={t.id} className="cursor-pointer" onClick={() => open(t)}>
                <TableCell className="font-semibold">{t.code}</TableCell>
                <TableCell>{t.name}</TableCell>
                <TableCell className="text-center">{types.find((x) => x.id === t.project_type_id)?.name}</TableCell>
                <TableCell className="whitespace-normal text-muted-foreground">{t.default_activities.map((a) => a.name).join(' → ')}</TableCell>
                <TableCell className="text-center">{t.is_active ? 'Yes' : 'No'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </BoardGroup>
      {edit && (
        <Dialog open onOpenChange={(o) => !o && setEdit(null)}>
          <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
            <DialogHeader><DialogTitle>{edit.id ? 'Edit Template' : 'Add Template'}</DialogTitle></DialogHeader>
            <div className="grid grid-cols-12 gap-3">
              <TextField className="col-span-4" label="Code" value={edit.code} onChange={(v) => setEdit({ ...edit, code: v })} />
              <TextField className="col-span-8" label="Name" value={edit.name} onChange={(v) => setEdit({ ...edit, name: v })} />
              <TextField className="col-span-8" label="Description" value={edit.description} onChange={(v) => setEdit({ ...edit, description: v })} />
              <SelectField className="col-span-4" label="Project Type" allowEmpty value={edit.project_type_id?.toString()} onChange={(v) => setEdit({ ...edit, project_type_id: v ? Number(v) : null })} options={types.map((t) => ({ value: t.id.toString(), label: t.name }))} />
              <TextField className="col-span-12" label="Default activities (JSON)" multiline rows={12} mono value={edit.json} onChange={(v) => setEdit({ ...edit, json: v })}
                helperText='[{"name","pic_label":"System|User|Vendor","duration_days","is_milestone","tasks":[{"name","task_type","duration_days"}]}]' />
              <TextField className="col-span-12" label="Evidence checklist (JSON array — used in Phase 2)" multiline rows={3} mono value={edit.evid} onChange={(v) => setEdit({ ...edit, evid: v })} />
              <label className="col-span-12 flex items-center gap-2 text-sm"><Switch checked={!!edit.is_active} onCheckedChange={(c) => setEdit({ ...edit, is_active: c })} /> Active</label>
            </div>
            <DialogFooter><Button variant="outline" onClick={() => setEdit(null)}>Cancel</Button><Button onClick={save}>Save</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

function SettingsAdmin() {
  const db = dbClient();
  const { notify } = useApp();
  const [vals, setVals] = useState<Record<string, string>>({});
  useEffect(() => {
    db.from('app_settings').select('*').then(({ data }) => setVals(Object.fromEntries((data ?? []).map((s: { key: string; value: unknown }) => [s.key, String(s.value)]))));
  }, [db]);
  const save = async (key: string) => {
    const { error } = await db.from('app_settings').update({ value: vals[key], updated_at: new Date().toISOString() }).eq('key', key);
    notify(error ? errMsg(error) : 'Saved', error ? 'error' : 'success');
  };
  return (
    <div className="max-w-xl">
      <p className="mb-4 text-sm text-muted-foreground">
        Tokens: <b>{'{TYPE}'}</b> project type code · <b>{'{YYYY}'}</b> / <b>{'{YY}'}</b> year · <b>{'{SEQ:n}'}</b> running number with n digits (resets per prefix, e.g. per type and year). Codes are unique and never re-used.
      </p>
      <div className="space-y-4">
        {[['project_code_format', 'Project Code format (e.g. SYS-{TYPE}-{YYYY}-{SEQ:3})'], ['request_no_format', 'Request Number format (e.g. REQ-SYS-{YYYY}-{SEQ:4})']].map(([k, l]) => (
          <div key={k} className="flex items-end gap-2">
            <TextField className="flex-1" label={l} value={vals[k]} onChange={(v) => setVals({ ...vals, [k]: v })} />
            <Button variant="outline" className="h-9" onClick={() => save(k)}>Save</Button>
          </div>
        ))}
      </div>
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
