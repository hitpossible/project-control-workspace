'use client';

import { Bug as BugIcon, CircleCheck, CircleX, ExternalLink, FlaskConical, Hammer, Play, Plus, Send, UserPlus, Wrench } from 'lucide-react';
import { useState } from 'react';
import { PRIORITIES, ROOT_CAUSE_CATEGORIES, SEVERITIES, BUG_STATUSES, TEST_RESULTS, TEST_ROUND_STATUSES, TEST_TYPES, optLabel } from '@/lib/constants';
import { errMsg, fmtDate, fmtDateTime, isOverdue, nullify } from '@/lib/format';
import { dbClient } from '@/lib/db/client';
import type { Activity, Bug, BugFix, InternalTask, Profile, Project, Retest, TestRound } from '@/lib/types';
import { cn } from '@/lib/utils';
import AuditHistory from './AuditHistory';
import { dispatchEmails, useApp } from './AppProvider';
import { ActionButton, DateField, EmptyState, Person, SelectField, StatusChip, TextField } from './common';
import EvidencePanel from './EvidencePanel';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';
import { Tabs, TabsList, TabsTrigger } from './ui/tabs';
import { UserSelect } from './common';

const col = (n: string) => cn('col-span-12', n);

function DialogTabs({ value, onChange, tabs }: { value: string; onChange: (v: string) => void; tabs: string[] }) {
  return (
    <Tabs value={value} onValueChange={onChange}>
      <TabsList variant="line" className="w-full justify-start border-b border-grid">
        {tabs.map((t) => <TabsTrigger key={t} value={t} className="flex-none px-3">{t}</TabsTrigger>)}
      </TabsList>
    </Tabs>
  );
}

function useRpc(onDone: () => void) {
  const db = dbClient();
  const { notify, refreshUnread } = useApp();
  return async (fn: string, args: Record<string, unknown>, ok: string) => {
    const { data, error } = await db.rpc(fn, args);
    if (error) { notify(errMsg(error), 'error'); return null; }
    notify(ok);
    dispatchEmails();
    refreshUnread();
    onDone();
    return data ?? true;
  };
}

// ---------------------------------------------------------------------------
// Report bug
// ---------------------------------------------------------------------------
export function ReportBugDialog({ project, rounds, activities, tasks, members, defaults, onClose, onSaved }: {
  project: Project; rounds: TestRound[]; activities: Activity[]; tasks: InternalTask[]; members: Profile[];
  defaults?: { test_round_id?: string; task_id?: string }; onClose: () => void; onSaved: () => void;
}) {
  const rpc = useRpc(onSaved);
  const [f, setF] = useState({
    title: '', description: '', severity: 'medium', priority: '', test_round_id: defaults?.test_round_id ?? '', activity_id: '', task_id: defaults?.task_id ?? '',
    steps: '', expected: '', actual: '', dev: null as string | null, due: '',
  });
  const set = (k: keyof typeof f) => (v: string | null) => setF((p) => ({ ...p, [k]: v }));
  const devs = members.filter((m) => m.roles.some((r) => ['developer', 'project_leader'].includes(r)));

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-heading"><BugIcon className="size-5 text-[#e2445c]" /> Report Bug</DialogTitle>
          <DialogDescription>{project.project_code} · {project.project_name}</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-12 gap-3">
          <TextField className="col-span-12" label="Title" required value={f.title} onChange={set('title')} />
          <SelectField className={col('sm:col-span-3')} label="Severity" required value={f.severity} onChange={set('severity')} options={SEVERITIES} />
          <SelectField className={col('sm:col-span-3')} label="Priority" allowEmpty placeholder="= severity" value={f.priority} onChange={set('priority')} options={PRIORITIES} />
          <SelectField className={col('sm:col-span-6')} label="Test Round" allowEmpty value={f.test_round_id} onChange={set('test_round_id')}
            options={rounds.map((r) => ({ value: r.id, label: `Round ${r.round_no} — ${r.title}` }))} />
          <SelectField className={col('sm:col-span-6')} label="Related Activity" allowEmpty placeholder="(from test round)" value={f.activity_id} onChange={set('activity_id')}
            options={activities.map((a) => ({ value: a.id, label: a.name }))} />
          <SelectField className={col('sm:col-span-6')} label="Related Task" allowEmpty value={f.task_id} onChange={set('task_id')}
            options={tasks.map((t) => ({ value: t.id, label: `${t.task_no} ${t.name}` }))} />
          <TextField className="col-span-12" label="Description" multiline rows={2} value={f.description} onChange={set('description')} />
          <TextField className="col-span-12" label="Steps to reproduce" multiline rows={3} value={f.steps} onChange={set('steps')} />
          <TextField className={col('sm:col-span-6')} label="Expected result" multiline rows={2} value={f.expected} onChange={set('expected')} />
          <TextField className={col('sm:col-span-6')} label="Actual result" multiline rows={2} value={f.actual} onChange={set('actual')} />
          <UserSelect className={col('sm:col-span-6')} label="Assign Developer" value={f.dev} onChange={set('dev')} users={devs} />
          <DateField className={col('sm:col-span-6')} label="Fix Due Date" value={f.due} onChange={set('due')} helperText="Default by severity: Critical 1d · High 3d · Medium 5d · Low 10d" />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <ActionButton tone="destructive" disabled={!f.title.trim()} onClick={async () => {
            const ok = await rpc('report_bug', {
              p_project_id: project.id, p_title: f.title, p_description: f.description || null, p_severity: f.severity, p_priority: f.priority || f.severity,
              p_test_round_id: f.test_round_id || null, p_activity_id: f.activity_id || null, p_task_id: f.task_id || null,
              p_steps: f.steps || null, p_expected: f.expected || null, p_actual: f.actual || null, p_assigned_dev_id: f.dev, p_due_date: f.due || null,
            }, 'Bug reported');
            if (ok) onClose();
          }}><Send /> Report Bug</ActionButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Bug detail + workflow (Assign → Fix → Fix Ready → Retest → Close / Reopen)
// ---------------------------------------------------------------------------
export function BugDialog({ project, bug, rounds, activities, tasks, fixes, retests, members, canManage, onClose, onSaved }: {
  project: Project; bug: Bug; rounds: TestRound[]; activities: Activity[]; tasks: InternalTask[];
  fixes: BugFix[]; retests: Retest[]; members: Profile[]; canManage: boolean; onClose: () => void; onSaved: () => void;
}) {
  const db = dbClient();
  const { me, hasRole, profileName, notify } = useApp();
  const rpc = useRpc(onSaved);
  const [tab, setTab] = useState('Workflow');
  const [f, setF] = useState<Bug>(bug);
  const [assign, setAssign] = useState({ dev: bug.assigned_dev_id, due: bug.due_date ?? '' });
  const currentFix = fixes.filter((x) => x.bug_id === bug.id).sort((a, b) => b.fix_cycle - a.fix_cycle)[0];
  const [fix, setFix] = useState({ description: currentFix?.fix_description ?? '', unit: currentFix?.unit_test_result ?? '', note: currentFix?.technical_note ?? '', build: currentFix?.build_link ?? '', commit: currentFix?.commit_link ?? '', tester: null as string | null });
  const pendingRetest = retests.find((r) => r.bug_id === bug.id && r.status === 'pending');
  const [retest, setRetest] = useState({ result: 'passed', comment: '' });
  const [cancelReason, setCancelReason] = useState('');
  const set = <K extends keyof Bug>(k: K) => (v: Bug[K] | string | null) => setF((p) => ({ ...p, [k]: v }));

  const isQa = hasRole('qa') || canManage;
  const canTriage = canManage || bug.reporter_id === me?.id || hasRole('qa', 'supervisor', 'manager');
  const isDev = bug.assigned_dev_id === me?.id || canManage;
  const open = !['closed', 'cancelled'].includes(bug.status);
  const canEdit = open && (canTriage || isDev);
  const devs = members.filter((m) => m.roles.some((r) => ['developer', 'project_leader'].includes(r)));
  const qas = members.filter((m) => m.roles.some((r) => ['qa', 'project_leader'].includes(r)));
  const myFixes = fixes.filter((x) => x.bug_id === bug.id).sort((a, b) => a.fix_cycle - b.fix_cycle);
  const myRetests = retests.filter((x) => x.bug_id === bug.id);

  const saveDetails = async () => {
    const { error } = await db.from('bugs').update(nullify({
      title: f.title, description: f.description, steps_to_reproduce: f.steps_to_reproduce, expected_result: f.expected_result,
      actual_result: f.actual_result, severity: f.severity, priority: f.priority, root_cause: f.root_cause,
      root_cause_category: f.root_cause_category, test_round_id: f.test_round_id, activity_id: f.activity_id, task_id: f.task_id, due_date: f.due_date,
    })).eq('id', bug.id);
    if (error) return notify(errMsg(error), 'error');
    notify('Bug updated');
    onSaved();
  };

  const step = (n: number, label: string, done: boolean, active: boolean) => (
    <div className="flex items-center gap-1.5">
      <span className={cn('flex size-6 items-center justify-center rounded-full text-xs font-semibold', done ? 'bg-[#00c875] text-white' : active ? 'bg-primary text-white' : 'bg-grid text-muted-foreground')}>{done ? '✓' : n}</span>
      <span className={cn('text-xs', active ? 'font-semibold' : 'text-muted-foreground')}>{label}</span>
    </div>
  );
  const flow = ['new', 'assigned', 'in_progress', 'fix_ready', 'closed'];
  const pos = bug.status === 'reopened' ? 1 : bug.status === 'retest' ? 3 : flow.indexOf(bug.status);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] gap-3 overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2 font-heading text-lg">
            <BugIcon className="size-5 text-[#e2445c]" /> {bug.bug_no} — {bug.title}
          </DialogTitle>
          <DialogDescription asChild>
            <div className="flex flex-wrap items-center gap-2">
              <StatusChip list={BUG_STATUSES} value={bug.status} />
              <StatusChip list={SEVERITIES} value={bug.severity} />
              <span className="text-xs">Reported by {profileName(bug.reporter_id)} · {fmtDateTime(bug.created_at)}</span>
              {bug.reopen_count > 0 && <span className="rounded bg-[#e2445c] px-1.5 text-[11px] text-white">Reopened ×{bug.reopen_count}</span>}
            </div>
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-3 rounded-md bg-muted px-3 py-2">
          {step(1, 'Reported', pos > 0, pos === 0)}<span className="text-muted-foreground/50">→</span>
          {step(2, bug.status === 'reopened' ? 'Reopened' : 'Assigned', pos > 1, pos === 1)}<span className="text-muted-foreground/50">→</span>
          {step(3, 'Developer Fix', pos > 2, pos === 2)}<span className="text-muted-foreground/50">→</span>
          {step(4, 'Retest', pos > 3, pos === 3)}<span className="text-muted-foreground/50">→</span>
          {step(5, 'Closed', bug.status === 'closed', false)}
        </div>

        <DialogTabs value={tab} onChange={setTab} tabs={['Workflow', 'Details', 'Fix & Retest History', 'Evidence', 'History']} />

        {tab === 'Workflow' && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
              <div><div className="text-xs text-muted-foreground">Developer</div><Person name={bug.assigned_dev_id ? profileName(bug.assigned_dev_id) : null} /></div>
              <div><div className="text-xs text-muted-foreground">Fix Due</div><span className={cn(isOverdue(bug.due_date, open ? 'open' : 'completed') && 'font-semibold text-destructive')}>{fmtDate(bug.due_date)}</span></div>
              <div><div className="text-xs text-muted-foreground">Test Round</div>{rounds.find((r) => r.id === bug.test_round_id)?.title ?? '-'}</div>
              <div><div className="text-xs text-muted-foreground">Supervisor</div><Person name={bug.supervisor_id ? profileName(bug.supervisor_id) : null} /></div>
            </div>

            {!open && (
              <div className={cn('rounded-md px-3 py-2 text-sm', bug.status === 'closed' ? 'bg-[#e6f9f0] text-[#00854d]' : 'bg-muted')}>
                {bug.status === 'closed' ? `✓ Closed after retest passed · ${fmtDateTime(bug.closed_at)}` : `Cancelled — ${bug.cancel_reason ?? ''}`}
              </div>
            )}

            {open && canTriage && (
              <section className="rounded-lg border p-3">
                <h4 className="mb-2 flex items-center gap-1.5 text-sm font-semibold"><UserPlus className="size-4" /> Assign Developer</h4>
                <div className="grid grid-cols-12 items-end gap-2">
                  <UserSelect className="col-span-12 sm:col-span-6" value={assign.dev} onChange={(v) => setAssign({ ...assign, dev: v })} users={devs} />
                  <DateField className="col-span-8 sm:col-span-4" value={assign.due} onChange={(v) => setAssign({ ...assign, due: v })} />
                  <Button className="col-span-4 h-9 sm:col-span-2" disabled={!assign.dev}
                    onClick={() => rpc('assign_bug', { p_bug_id: bug.id, p_dev_id: assign.dev, p_due_date: assign.due || null }, 'Developer assigned')}>Assign</Button>
                </div>
              </section>
            )}

            {open && isDev && ['assigned', 'reopened'].includes(bug.status) && (
              <section className="rounded-lg border p-3">
                <h4 className="mb-1 flex items-center gap-1.5 text-sm font-semibold"><Hammer className="size-4" /> Developer Fix</h4>
                <p className="mb-2 text-xs text-muted-foreground">Starts fix cycle {myFixes.length + 1}.</p>
                <ActionButton tone="warning" onClick={() => rpc('start_fix', { p_bug_id: bug.id }, 'Fix started')}><Play /> Start Fix</ActionButton>
              </section>
            )}

            {open && bug.status === 'in_progress' && currentFix?.status === 'in_progress' && (isDev || currentFix.fix_owner_id === me?.id) && (
              <section className="rounded-lg border border-[#a25ddc] p-3">
                <h4 className="mb-2 flex items-center gap-1.5 text-sm font-semibold"><Wrench className="size-4" /> Fix cycle {currentFix.fix_cycle} — mark Fix Ready</h4>
                <div className="grid grid-cols-12 gap-2">
                  <TextField className="col-span-12" label="Fix Description" required multiline rows={2} value={fix.description} onChange={(v) => setFix({ ...fix, description: v })} />
                  <TextField className={col('sm:col-span-6')} label="Unit Test Result" value={fix.unit} onChange={(v) => setFix({ ...fix, unit: v })} />
                  <TextField className={col('sm:col-span-6')} label="Technical Note" value={fix.note} onChange={(v) => setFix({ ...fix, note: v })} />
                  <TextField className={col('sm:col-span-6')} label="Build Link" value={fix.build} onChange={(v) => setFix({ ...fix, build: v })} placeholder="https://" />
                  <TextField className={col('sm:col-span-6')} label="Commit / PR Link" value={fix.commit} onChange={(v) => setFix({ ...fix, commit: v })} placeholder="https://" />
                  <UserSelect className={col('sm:col-span-6')} label="Retest by (default: reporter / project QA)" value={fix.tester} onChange={(v) => setFix({ ...fix, tester: v })} users={qas} />
                </div>
                <ActionButton tone="secondary" className="mt-3" disabled={!fix.description.trim()} onClick={() => rpc('mark_fix_ready', {
                  p_fix_id: currentFix.id, p_description: fix.description, p_unit_test_result: fix.unit || null, p_technical_note: fix.note || null,
                  p_build_link: fix.build || null, p_commit_link: fix.commit || null, p_tester_id: fix.tester,
                }, 'Fix Ready — QA notified')}><Send /> Fix Ready → send to QA</ActionButton>
              </section>
            )}

            {open && pendingRetest && (isQa || pendingRetest.tester_id === me?.id) && (
              <section className="rounded-lg border border-[#784bd1] p-3">
                <h4 className="mb-2 flex items-center gap-1.5 text-sm font-semibold"><FlaskConical className="size-4" /> Retest round {pendingRetest.retest_round}
                  <span className="font-normal text-muted-foreground">· tester {profileName(pendingRetest.tester_id)} · due {fmtDate(pendingRetest.due_date)}</span></h4>
                <div className="grid grid-cols-12 items-end gap-2">
                  <SelectField className="col-span-12 sm:col-span-4" label="Result" value={retest.result} onChange={(v) => setRetest({ ...retest, result: v })} options={TEST_RESULTS} />
                  <TextField className="col-span-12 sm:col-span-8" label={retest.result === 'passed' ? 'Comment' : 'Comment (required)'} value={retest.comment} onChange={(v) => setRetest({ ...retest, comment: v })} />
                </div>
                <div className="mt-3 flex gap-2">
                  <ActionButton tone={retest.result === 'passed' ? 'success' : 'destructive'} disabled={retest.result !== 'passed' && !retest.comment.trim()}
                    onClick={() => rpc('record_retest', { p_retest_id: pendingRetest.id, p_result: retest.result, p_comment: retest.comment || null },
                      retest.result === 'passed' ? 'Retest passed — bug closed' : 'Retest recorded — bug reopened')}>
                    {retest.result === 'passed' ? <><CircleCheck /> Pass & Close Bug</> : <><CircleX /> Record & Reopen Bug</>}
                  </ActionButton>
                </div>
              </section>
            )}

            {open && !pendingRetest && bug.status === 'fix_ready' && (
              <p className="text-sm text-muted-foreground">Waiting for QA retest.</p>
            )}

            {open && canTriage && (
              <section className="rounded-lg border border-dashed p-3">
                <h4 className="mb-2 text-sm font-semibold text-muted-foreground">Cancel bug (duplicate / not a bug)</h4>
                <div className="flex items-end gap-2">
                  <TextField className="flex-1" placeholder="Reason" value={cancelReason} onChange={setCancelReason} />
                  <Button variant="outline" className="h-9" disabled={!cancelReason.trim()} onClick={() => rpc('cancel_bug', { p_bug_id: bug.id, p_reason: cancelReason }, 'Bug cancelled')}>Cancel Bug</Button>
                </div>
              </section>
            )}
          </div>
        )}

        {tab === 'Details' && (
          <div className="grid grid-cols-12 gap-3">
            <TextField className="col-span-12" label="Title" value={f.title} onChange={set('title')} disabled={!canEdit} />
            <SelectField className={col('sm:col-span-3')} label="Severity" value={f.severity} onChange={set('severity')} options={SEVERITIES} disabled={!canEdit} />
            <SelectField className={col('sm:col-span-3')} label="Priority" value={f.priority} onChange={set('priority')} options={PRIORITIES} disabled={!canEdit} />
            <SelectField className={col('sm:col-span-6')} label="Test Round" allowEmpty value={f.test_round_id} onChange={set('test_round_id')} disabled={!canEdit}
              options={rounds.map((r) => ({ value: r.id, label: `Round ${r.round_no} — ${r.title}` }))} />
            <SelectField className={col('sm:col-span-6')} label="Related Activity" allowEmpty value={f.activity_id} onChange={set('activity_id')} disabled={!canEdit}
              options={activities.map((a) => ({ value: a.id, label: a.name }))} />
            <SelectField className={col('sm:col-span-6')} label="Related Task" allowEmpty value={f.task_id} onChange={set('task_id')} disabled={!canEdit}
              options={tasks.map((t) => ({ value: t.id, label: `${t.task_no} ${t.name}` }))} />
            <TextField className="col-span-12" label="Description" multiline rows={2} value={f.description} onChange={set('description')} disabled={!canEdit} />
            <TextField className="col-span-12" label="Steps to reproduce" multiline rows={3} value={f.steps_to_reproduce} onChange={set('steps_to_reproduce')} disabled={!canEdit} />
            <TextField className={col('sm:col-span-6')} label="Expected result" multiline rows={2} value={f.expected_result} onChange={set('expected_result')} disabled={!canEdit} />
            <TextField className={col('sm:col-span-6')} label="Actual result" multiline rows={2} value={f.actual_result} onChange={set('actual_result')} disabled={!canEdit} />
            <SelectField className={col('sm:col-span-4')} label="Root Cause Category" allowEmpty value={f.root_cause_category} onChange={set('root_cause_category')} disabled={!canEdit}
              options={ROOT_CAUSE_CATEGORIES.map((c) => ({ value: c, label: c }))} />
            <TextField className={col('sm:col-span-8')} label="Root Cause" value={f.root_cause} onChange={set('root_cause')} disabled={!canEdit} />
            <DateField className={col('sm:col-span-4')} label="Fix Due Date" value={f.due_date} onChange={set('due_date')} disabled={!canTriage || !open} />
            {canEdit && <div className="col-span-12 flex justify-end"><Button onClick={saveDetails}>Save Details</Button></div>}
          </div>
        )}

        {tab === 'Fix & Retest History' && (
          <div className="space-y-3">
            {myFixes.length === 0 && <EmptyState text="No fix cycle yet" />}
            {myFixes.map((x) => {
              const rt = myRetests.filter((r) => r.fix_id === x.id);
              return (
                <div key={x.id} className="rounded-lg border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold">Fix cycle {x.fix_cycle}</span>
                    <span className={cn('rounded px-1.5 text-[11px] capitalize text-white', { in_progress: 'bg-[#fdab3d]', ready: 'bg-[#a25ddc]', verified: 'bg-[#00c875]', failed: 'bg-[#e2445c]' }[x.status])}>{x.status.replace('_', ' ')}</span>
                    <span className="text-xs text-muted-foreground">{profileName(x.fix_owner_id)} · started {fmtDate(x.fix_start_date)}{x.fix_ready_at && ` · ready ${fmtDateTime(x.fix_ready_at)}`}</span>
                  </div>
                  {x.fix_description && <p className="mt-1 text-sm">{x.fix_description}</p>}
                  <div className="mt-1 flex flex-wrap gap-3 text-xs text-muted-foreground">
                    {x.unit_test_result && <span>Unit test: {x.unit_test_result}</span>}
                    {x.build_link && <a href={x.build_link} target="_blank" rel="noopener" className="inline-flex items-center gap-0.5 text-primary">Build <ExternalLink className="size-3" /></a>}
                    {x.commit_link && <a href={x.commit_link} target="_blank" rel="noopener" className="inline-flex items-center gap-0.5 text-primary">Commit / PR <ExternalLink className="size-3" /></a>}
                    {x.technical_note && <span>Note: {x.technical_note}</span>}
                  </div>
                  {rt.map((r) => (
                    <div key={r.id} className="mt-2 flex flex-wrap items-center gap-2 border-l-2 border-[#784bd1] pl-3 text-sm">
                      <span className="font-medium">Retest {r.retest_round}</span>
                      {r.result ? <StatusChip list={TEST_RESULTS} value={r.result} className="h-6 min-w-0" /> : <span className="text-xs text-muted-foreground">pending · due {fmtDate(r.due_date)}</span>}
                      <span className="text-xs text-muted-foreground">{profileName(r.tester_id)}{r.tested_at && ` · ${fmtDateTime(r.tested_at)}`}</span>
                      {r.comment && <span className="italic">“{r.comment}”</span>}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        )}

        {tab === 'Evidence' && <EvidencePanel entityType="bug" entityId={bug.id} projectId={project.id} canAdd canVerify={canManage} />}
        {tab === 'History' && <AuditHistory entityId={bug.id} />}

        <DialogFooter><Button variant="outline" onClick={onClose}>Close</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Test Round
// ---------------------------------------------------------------------------
export function TestRoundDialog({ project, round, rounds, activities, bugs, members, canEdit, onClose, onSaved, onOpenBug, onReportBug }: {
  project: Project; round: TestRound | null; rounds: TestRound[]; activities: Activity[]; bugs: Bug[]; members: Profile[];
  canEdit: boolean; onClose: () => void; onSaved: () => void; onOpenBug: (b: Bug) => void; onReportBug: (roundId: string) => void;
}) {
  const db = dbClient();
  const { me, notify } = useApp();
  const [tab, setTab] = useState('Details');
  const last = rounds[rounds.length - 1];
  const [f, setF] = useState<Partial<TestRound>>(round ?? {
    title: last ? `Regression Round ${last.round_no + 1}` : 'System Test Round 1', test_type: last ? 'regression' : 'system',
    tester_id: me?.id, status: 'planned', activity_id: last?.activity_id ?? activities.find((a) => /test|qa/i.test(a.name))?.id ?? null,
  });
  const set = <K extends keyof TestRound>(k: K) => (v: TestRound[K] | string | null) => setF((p) => ({ ...p, [k]: v }));
  const roundBugs = round ? bugs.filter((b) => b.test_round_id === round.id) : [];
  const qas = members.filter((m) => m.roles.some((r) => ['qa', 'project_leader'].includes(r)));

  const save = async () => {
    if (!f.title?.trim()) return notify('Title is required', 'warning');
    if (f.status === 'completed' && !f.result) return notify('Set the result before completing the round', 'warning');
    const num = (v: unknown) => (v === '' || v == null ? null : Number(v));
    const payload = nullify({
      title: f.title, test_type: f.test_type, activity_id: f.activity_id ?? null, tester_id: f.tester_id ?? null,
      planned_date: f.planned_date ?? null, due_date: f.due_date ?? null, actual_date: f.actual_date ?? null,
      status: f.status, result: f.result ?? null, total_cases: num(f.total_cases), passed_cases: num(f.passed_cases), failed_cases: num(f.failed_cases),
      summary: f.summary ?? null,
    });
    const res = round
      ? await db.from('test_rounds').update(payload).eq('id', round.id)
      : await db.from('test_rounds').insert({ ...payload, project_id: project.id });
    if (res.error) return notify(errMsg(res.error), 'error');
    notify(round ? 'Test round updated' : 'Test round created');
    onSaved();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] gap-3 overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-heading text-lg"><FlaskConical className="size-5 text-[#784bd1]" />
            {round ? `Round ${round.round_no} — ${round.title}` : 'New Test Round'}</DialogTitle>
          <DialogDescription>{project.project_code} · QA / Test Round</DialogDescription>
        </DialogHeader>
        {round && <DialogTabs value={tab} onChange={setTab} tabs={[`Details`, `Bugs (${roundBugs.length})`, 'Evidence', 'History']} />}

        {tab === 'Details' && (
          <div className="grid grid-cols-12 gap-3">
            <TextField className={col('sm:col-span-8')} label="Title" required value={f.title} onChange={set('title')} disabled={!canEdit} />
            <SelectField className={col('sm:col-span-4')} label="Test Type" value={f.test_type} onChange={set('test_type')} options={TEST_TYPES} disabled={!canEdit} />
            <SelectField className={col('sm:col-span-6')} label="Related Activity" allowEmpty value={f.activity_id} onChange={set('activity_id')} disabled={!canEdit}
              options={activities.map((a) => ({ value: a.id, label: a.name }))} />
            <UserSelect className={col('sm:col-span-6')} label="Tester" value={f.tester_id} onChange={set('tester_id')} users={qas} disabled={!canEdit} />
            <DateField className={col('col-span-4')} label="Planned Date" value={f.planned_date} onChange={set('planned_date')} disabled={!canEdit} />
            <DateField className={col('col-span-4')} label="Due Date" value={f.due_date} onChange={set('due_date')} disabled={!canEdit} />
            <DateField className={col('col-span-4')} label="Actual Date" value={f.actual_date} onChange={set('actual_date')} disabled={!canEdit} />
            <SelectField className={col('sm:col-span-6')} label="Status" value={f.status} onChange={set('status')} options={TEST_ROUND_STATUSES} disabled={!canEdit} />
            <SelectField className={col('sm:col-span-6')} label="Result" allowEmpty value={f.result} onChange={set('result')} options={TEST_RESULTS} disabled={!canEdit} required={f.status === 'completed'} />
            <TextField className="col-span-4" label="Total Cases" type="number" value={f.total_cases} onChange={set('total_cases')} disabled={!canEdit} />
            <TextField className="col-span-4" label="Passed" type="number" value={f.passed_cases} onChange={set('passed_cases')} disabled={!canEdit} />
            <TextField className="col-span-4" label="Failed" type="number" value={f.failed_cases} onChange={set('failed_cases')} disabled={!canEdit} />
            <TextField className="col-span-12" label="Test Summary" multiline rows={3} value={f.summary} onChange={set('summary')} disabled={!canEdit} />
          </div>
        )}

        {tab.startsWith('Bugs') && round && (
          <div>
            <div className="mb-2 flex justify-end"><ActionButton tone="destructive" size="sm" onClick={() => onReportBug(round.id)}><Plus /> Report bug in this round</ActionButton></div>
            {roundBugs.length === 0 ? <EmptyState text="No bugs in this round" /> : (
              <div className="divide-y divide-grid rounded-md border">
                {roundBugs.map((b) => (
                  <button key={b.id} type="button" onClick={() => onOpenBug(b)} className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted">
                    <span className="text-xs text-muted-foreground">{b.bug_no}</span>
                    <span className="flex-1 text-sm">{b.title}</span>
                    <StatusChip list={SEVERITIES} value={b.severity} className="h-6 min-w-20" />
                    <StatusChip list={BUG_STATUSES} value={b.status} className="h-6 min-w-24" />
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {tab === 'Evidence' && round && <EvidencePanel entityType="test_round" entityId={round.id} projectId={project.id} canAdd={canEdit} canVerify={canEdit} />}
        {tab === 'History' && round && <AuditHistory entityId={round.id} />}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
          {canEdit && tab === 'Details' && <Button onClick={save}>Save</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export const bugTestRoundLabel = (rounds: TestRound[], id: string | null) => {
  const r = rounds.find((x) => x.id === id);
  return r ? `R${r.round_no} ${optLabel(TEST_TYPES, r.test_type)}` : '-';
};
