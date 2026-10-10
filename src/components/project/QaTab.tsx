'use client';

import { Bug as BugIcon, FlaskConical, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useApp } from '@/components/AppProvider';
import { ActionButton, BoardGroup, EmptyState, Person, SelectField, StatCard, StatusChip } from '@/components/common';
import { BugDialog, ReportBugDialog, TestRoundDialog, bugTestRoundLabel } from '@/components/QaDialogs';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { BUG_STATUSES, SEVERITIES, TEST_RESULTS, TEST_ROUND_STATUSES, TEST_TYPES, optLabel } from '@/lib/constants';
import { fmtDate, isOverdue } from '@/lib/format';
import type { Bug, TestRound } from '@/lib/types';
import { cn } from '@/lib/utils';
import { ViewToggle } from './PlanTab';
import type { TabProps } from './types';

const BUG_GROUPS = [
  { title: 'New — not assigned', color: '#579bfc', statuses: ['new'] },
  { title: 'Assigned / Reopened', color: '#e2445c', statuses: ['assigned', 'reopened'] },
  { title: 'Developer fixing', color: '#fdab3d', statuses: ['in_progress'] },
  { title: 'Waiting retest', color: '#a25ddc', statuses: ['fix_ready', 'retest'] },
  { title: 'Closed', color: '#00c875', statuses: ['closed'] },
  { title: 'Cancelled', color: '#757575', statuses: ['cancelled'] },
];

const SEV_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

export default function QaTab({ data, perm, reload, memberProfiles, focusBug }: TabProps & { focusBug?: string | null }) {
  const { me, hasRole, profileName } = useApp();
  const [view, setView] = useState('bugs');
  const [sev, setSev] = useState('');
  const [dev, setDev] = useState('');
  const [openBug, setOpenBug] = useState<string | null>(null);
  const [report, setReport] = useState<{ test_round_id?: string } | null>(null);
  const [round, setRound] = useState<TestRound | 'new' | null>(null);
  const canQa = hasRole('qa') || perm.manage || data.members.some((m) => m.user_id === me?.id && ['qa', 'leader'].includes(m.member_role));

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- open bug from notification link
    if (focusBug) setOpenBug(focusBug);
  }, [focusBug]);

  const bugs = data.bugs
    .filter((b) => (!sev || b.severity === sev) && (dev === 'me' ? b.assigned_dev_id === me?.id : !dev || b.assigned_dev_id === dev))
    .sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity] || (a.due_date ?? '').localeCompare(b.due_date ?? ''));
  const openBugs = data.bugs.filter((b) => !['closed', 'cancelled'].includes(b.status));
  const devs = [...new Set(data.bugs.map((b) => b.assigned_dev_id).filter(Boolean))] as string[];
  const bug = data.bugs.find((b) => b.id === openBug);
  const reopenRate = data.bugs.length ? Math.round((data.bugs.filter((b) => b.reopen_count > 0).length / data.bugs.length) * 100) : 0;
  const passRate = (() => {
    const done = data.retests.filter((r) => r.status === 'done');
    return done.length ? Math.round((done.filter((r) => r.result === 'passed').length / done.length) * 100) : null;
  })();

  const bugRow = (b: Bug) => {
    const open = !['closed', 'cancelled'].includes(b.status);
    const od = open && ['assigned', 'in_progress', 'reopened'].includes(b.status) && isOverdue(b.due_date, 'open');
    const pending = data.retests.find((r) => r.bug_id === b.id && r.status === 'pending');
    return (
      <TableRow key={b.id} className={cn('cursor-pointer', od && 'bg-[#fff1f0] hover:bg-[#ffe5e3]')} onClick={() => setOpenBug(b.id)}>
        <TableCell className="min-w-80 whitespace-normal">
          <div className="flex items-center gap-1.5">
            <span>{b.title}</span>
            {b.reopen_count > 0 && <span className="rounded bg-[#e2445c] px-1 text-[10px] text-white">↺{b.reopen_count}</span>}
          </div>
          <div className="text-xs text-muted-foreground">{b.bug_no} · {bugTestRoundLabel(data.rounds, b.test_round_id)}</div>
        </TableCell>
        <TableCell className="p-1"><StatusChip list={SEVERITIES} value={b.severity} fullWidth /></TableCell>
        <TableCell className="min-w-28 p-1"><StatusChip list={BUG_STATUSES} value={b.status} fullWidth /></TableCell>
        <TableCell className="text-center"><Person name={b.assigned_dev_id ? profileName(b.assigned_dev_id) : null} showName={false} /></TableCell>
        <TableCell className="text-center"><Person name={b.reporter_id ? profileName(b.reporter_id) : null} showName={false} /></TableCell>
        <TableCell className={cn('text-center', od && 'font-semibold text-destructive')}>{od && '⚠ '}{fmtDate(b.due_date)}</TableCell>
        <TableCell className="text-center text-xs">{pending ? <span>{profileName(pending.tester_id)}<br /><span className="text-muted-foreground">due {fmtDate(pending.due_date)}</span></span> : '–'}</TableCell>
      </TableRow>
    );
  };

  return (
    <div>
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-6">
        <StatCard label="Open Bugs" value={openBugs.length} color="#e2445c" hint={`${data.bugs.length} total`} />
        <StatCard label="Critical Open" value={openBugs.filter((b) => b.severity === 'critical').length} color="#bb3354" hint="Blocks Go-live" />
        <StatCard label="Waiting Retest" value={data.retests.filter((r) => r.status === 'pending').length} color="#a25ddc" />
        <StatCard label="Fix Overdue" value={openBugs.filter((b) => ['assigned', 'in_progress', 'reopened'].includes(b.status) && isOverdue(b.due_date, 'open')).length} color="#ff642e" />
        <StatCard label="Retest Pass Rate" value={passRate == null ? '—' : `${passRate}%`} color="#00c875" hint={`Reopen rate ${reopenRate}%`} />
        <StatCard label="Test Rounds" value={data.rounds.length} color="#579bfc" hint={`${data.rounds.filter((r) => r.status === 'completed').length} completed`} />
      </div>

      <div className="no-print mb-5 flex flex-wrap items-end gap-3">
        <ViewToggle value={view} onChange={setView} options={[['bugs', 'Bug Board'], ['rounds', 'Test Rounds']]} />
        {view === 'bugs' && (
          <>
            <SelectField className="w-40" label="Severity" value={sev} allowEmpty placeholder="All" onChange={setSev} options={SEVERITIES} />
            <SelectField className="w-48" label="Developer" value={dev} allowEmpty placeholder="All" onChange={setDev}
              options={[{ value: 'me', label: 'Assigned to me' }, ...devs.map((d) => ({ value: d, label: profileName(d) }))]} />
          </>
        )}
        <div className="flex-1" />
        {canQa && <Button variant="outline" className="h-9" onClick={() => setRound('new')}><FlaskConical /> New Test Round</Button>}
        <ActionButton tone="destructive" className="h-9" onClick={() => setReport({})}><BugIcon /> Report Bug</ActionButton>
      </div>

      {view === 'bugs' ? (
        <>
          {bugs.length === 0 && <EmptyState text="No bugs 🎉" />}
          {BUG_GROUPS.map((g) => {
            const items = bugs.filter((b) => g.statuses.includes(b.status));
            if (!items.length) return null;
            return (
              <BoardGroup key={g.title} title={g.title} color={g.color} count={items.length} defaultOpen={!['Closed', 'Cancelled'].includes(g.title)}>
                <Table className="board-table">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-left">Bug</TableHead><TableHead>Severity</TableHead><TableHead>Status</TableHead>
                      <TableHead>Developer</TableHead><TableHead>Reporter</TableHead><TableHead>Fix Due</TableHead><TableHead>Retest</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>{items.map(bugRow)}</TableBody>
                </Table>
              </BoardGroup>
            );
          })}
        </>
      ) : (
        <>
          {data.rounds.length === 0 && <EmptyState text="No test round yet" />}
          {[...data.rounds].reverse().map((r, i) => {
            const rb = data.bugs.filter((b) => b.test_round_id === r.id);
            return (
              <BoardGroup key={r.id} title={`Round ${r.round_no} — ${r.title}`} color={['#784bd1', '#579bfc', '#00c875', '#fdab3d'][i % 4]} count={rb.length}
                actions={<div className="flex items-center gap-2">
                  <StatusChip list={TEST_ROUND_STATUSES} value={r.status} className="h-6 min-w-20" />
                  {r.result && <StatusChip list={TEST_RESULTS} value={r.result} className="h-6 min-w-20" />}
                  <Button size="sm" variant="ghost" onClick={() => setRound(r)}>Open</Button>
                </div>}>
                <div className="grid grid-cols-2 gap-3 border-b border-grid p-3 text-sm md:grid-cols-6">
                  <div><div className="text-xs text-muted-foreground">Type</div>{optLabel(TEST_TYPES, r.test_type)}</div>
                  <div><div className="text-xs text-muted-foreground">Tester</div><Person name={r.tester_id ? profileName(r.tester_id) : null} /></div>
                  <div><div className="text-xs text-muted-foreground">Planned / Due</div>{fmtDate(r.planned_date)} → {fmtDate(r.due_date)}</div>
                  <div><div className="text-xs text-muted-foreground">Actual</div>{fmtDate(r.actual_date)}</div>
                  <div><div className="text-xs text-muted-foreground">Cases</div>{r.total_cases != null ? <span><b className="text-[#00854d]">{r.passed_cases ?? 0}</b> / <b className="text-destructive">{r.failed_cases ?? 0}</b> of {r.total_cases}</span> : '–'}</div>
                  <div><div className="text-xs text-muted-foreground">Activity</div>{data.activities.find((a) => a.id === r.activity_id)?.name ?? '-'}</div>
                  {r.summary && <div className="col-span-full text-muted-foreground">{r.summary}</div>}
                </div>
                {rb.length > 0 ? (
                  <Table className="board-table">
                    <TableHeader><TableRow><TableHead className="text-left">Bug</TableHead><TableHead>Severity</TableHead><TableHead>Status</TableHead><TableHead>Developer</TableHead><TableHead>Reporter</TableHead><TableHead>Fix Due</TableHead><TableHead>Retest</TableHead></TableRow></TableHeader>
                    <TableBody>{rb.map(bugRow)}</TableBody>
                  </Table>
                ) : <EmptyState text="No bugs in this round" />}
                <div className="no-print border-t border-grid px-2 py-1">
                  <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => setReport({ test_round_id: r.id })}><Plus /> Report bug in this round</Button>
                </div>
              </BoardGroup>
            );
          })}
        </>
      )}

      {report && (
        <ReportBugDialog project={data.project} rounds={data.rounds} activities={data.activities} tasks={data.tasks} members={memberProfiles}
          defaults={report} onClose={() => setReport(null)} onSaved={reload} />
      )}
      {bug && (
        <BugDialog key={`${bug.id}-${bug.status}-${bug.updated_at}`} project={data.project} bug={bug} rounds={data.rounds} activities={data.activities} tasks={data.tasks}
          fixes={data.fixes} retests={data.retests} members={memberProfiles} canManage={perm.manage}
          onClose={() => setOpenBug(null)} onSaved={reload} />
      )}
      {round && (
        <TestRoundDialog project={data.project} round={round === 'new' ? null : round} rounds={data.rounds} activities={data.activities}
          bugs={data.bugs} members={memberProfiles} canEdit={canQa || (round !== 'new' && round.tester_id === me?.id)}
          onClose={() => setRound(null)} onSaved={async () => { setRound(null); await reload(); }}
          onOpenBug={(b) => { setRound(null); setOpenBug(b.id); }}
          onReportBug={(id) => { setRound(null); setReport({ test_round_id: id }); }} />
      )}
    </div>
  );
}
