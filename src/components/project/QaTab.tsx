'use client';

import { Bug as BugIcon, FlaskConical, Info, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { useApp } from '@/components/AppProvider';
import { ActionButton, BoardGroup, EmptyState, Person, SelectField, StatCard, StatusChip } from '@/components/common';
import KanbanBoard, { KanbanDue, KanbanTag } from '@/components/KanbanBoard';
import { BugDialog, ReportBugDialog, TestRoundDialog, bugTestRoundLabel } from '@/components/QaDialogs';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useOptions } from '@/i18n/useOptions';
import { BUG_STATUSES, SEVERITIES, TEST_RESULTS, TEST_ROUND_STATUSES, TEST_TYPES } from '@/lib/constants';
import { fmtDate, isOverdue } from '@/lib/format';
import type { Bug, TestRound } from '@/lib/types';
import { cn } from '@/lib/utils';
import { ViewToggle } from './PlanTab';
import type { TabProps } from './types';

/** titles: project.qa.group.<key> */
const BUG_GROUPS = [
  { key: 'new', color: '#579bfc', statuses: ['new'] },
  { key: 'assigned', color: '#e2445c', statuses: ['assigned', 'reopened'] },
  { key: 'fixing', color: '#fdab3d', statuses: ['in_progress'] },
  { key: 'retest', color: '#a25ddc', statuses: ['fix_ready', 'retest'] },
  { key: 'closed', color: '#00c875', statuses: ['closed'] },
  { key: 'cancelled', color: '#757575', statuses: ['cancelled'] },
] as const;

const SEV_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

export default function QaTab({ data, perm, reload, memberProfiles, focusBug, focusPanel }: TabProps & { focusBug?: number | null; focusPanel?: string | null }) {
  const t = useTranslations('project.qa');
  const tc = useTranslations('common');
  const { label: optLabel, options } = useOptions();
  const { me, hasRole, profileName } = useApp();
  const [view, setView] = useState('bugs');
  const [sev, setSev] = useState('');
  const [dev, setDev] = useState('');
  const [openBug, setOpenBug] = useState<number | null>(null);
  const [report, setReport] = useState<{ test_round_id?: number } | null>(null);
  const [round, setRound] = useState<TestRound | 'new' | null>(null);
  const canQa = hasRole('qa') || perm.manage || data.members.some((m) => m.user_id === me?.id && ['qa', 'leader'].includes(m.member_role));

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- open bug from notification link
    if (focusBug) setOpenBug(focusBug);
  }, [focusBug]);

  const bugs = data.bugs
    .filter((b) => (!sev || b.severity === sev) && (dev === 'me' ? b.assigned_dev_id === me?.id : !dev || b.assigned_dev_id === Number(dev)))
    .sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity] || (a.due_date ?? '').localeCompare(b.due_date ?? ''));
  const openBugs = data.bugs.filter((b) => !['closed', 'cancelled'].includes(b.status));
  const devs = [...new Set(data.bugs.map((b) => b.assigned_dev_id).filter(Boolean))] as number[];
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
          <div className="text-xs text-muted-foreground">{b.bug_no} · {bugTestRoundLabel(data.rounds, b.test_round_id, optLabel)}</div>
        </TableCell>
        <TableCell className="p-1"><StatusChip list={SEVERITIES} value={b.severity} fullWidth /></TableCell>
        <TableCell className="min-w-28 p-1"><StatusChip list={BUG_STATUSES} value={b.status} fullWidth /></TableCell>
        <TableCell className="text-center"><Person name={b.assigned_dev_id ? profileName(b.assigned_dev_id) : null} showName={false} /></TableCell>
        <TableCell className="text-center"><Person name={b.reporter_id ? profileName(b.reporter_id) : null} showName={false} /></TableCell>
        <TableCell className={cn('text-center', od && 'font-semibold text-destructive')}>{od && '⚠ '}{fmtDate(b.due_date)}</TableCell>
        <TableCell className="text-center text-xs">{pending ? <span>{profileName(pending.tester_id)}<br /><span className="text-muted-foreground">{t('dueOn', { date: fmtDate(pending.due_date) })}</span></span> : '–'}</TableCell>
      </TableRow>
    );
  };

  return (
    <div>
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-6">
        <StatCard label={t('stat.open')} value={openBugs.length} color="#e2445c" hint={t('stat.total', { count: data.bugs.length })} />
        <StatCard label={t('stat.critical')} value={openBugs.filter((b) => b.severity === 'critical').length} color="#bb3354" hint={t('stat.blocksGoLive')} />
        <StatCard label={t('stat.waitingRetest')} value={data.retests.filter((r) => r.status === 'pending').length} color="#a25ddc" />
        <StatCard label={t('stat.fixOverdue')} value={openBugs.filter((b) => ['assigned', 'in_progress', 'reopened'].includes(b.status) && isOverdue(b.due_date, 'open')).length} color="#ff642e" />
        <StatCard label={t('stat.passRate')} value={passRate == null ? '—' : `${passRate}%`} color="#00c875" hint={t('stat.reopenRate', { rate: reopenRate })} />
        <StatCard label={t('stat.rounds')} value={data.rounds.length} color="#579bfc" hint={t('stat.completed', { count: data.rounds.filter((r) => r.status === 'completed').length })} />
      </div>

      <div className="no-print mb-5 flex flex-wrap items-end gap-3">
        <ViewToggle value={view} onChange={setView} options={[['bugs', t('view.bugs')], ['kanban', t('view.kanban')], ['rounds', t('view.rounds')]]} />
        {view !== 'rounds' && (
          <>
            <SelectField className="w-40" label={t('severity')} value={sev} allowEmpty placeholder={tc('all')} onChange={setSev} options={options(SEVERITIES)} />
            <SelectField className="w-48" label={t('developer')} value={dev} allowEmpty placeholder={tc('all')} onChange={setDev}
              options={[{ value: 'me', label: t('assignedToMe') }, ...devs.map((d) => ({ value: String(d), label: profileName(d) }))]} />
          </>
        )}
        <div className="flex-1" />
        {canQa && <Button variant="outline" className="h-9" onClick={() => setRound('new')}><FlaskConical /> {t('newRound')}</Button>}
        <ActionButton tone="destructive" className="h-9" onClick={() => setReport({})}><BugIcon /> {t('reportBug')}</ActionButton>
      </div>

      {view === 'kanban' ? (
        <>
          <p className="mb-3 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Info className="size-3.5" /> {t('kanbanNote')}
          </p>
          <KanbanBoard
            columns={options(BUG_STATUSES).filter((c) => c.value !== 'cancelled' || bugs.some((b) => b.status === 'cancelled'))}
            items={bugs}
            onOpen={(b) => setOpenBug(b.id)}
            emptyText={t('noBugs')}
            renderCard={(b) => {
              const pending = data.retests.find((r) => r.bug_id === b.id && r.status === 'pending');
              return (
                <div className="space-y-2.5">
                  <div className="space-y-1">
                    <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      <span className="font-mono">{b.bug_no}</span>
                      <span className="truncate rounded bg-muted px-1.5 py-px font-medium">{bugTestRoundLabel(data.rounds, b.test_round_id, optLabel)}</span>
                      {b.reopen_count > 0 && <span className="rounded-full bg-red-50 px-1.5 font-medium text-red-600" title={t('reopened')}>↺ {b.reopen_count}</span>}
                    </div>
                    <div className="line-clamp-2 leading-snug font-medium">{b.title}</div>
                  </div>
                  <div className="flex items-end gap-1.5">
                    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
                      <KanbanTag list={SEVERITIES} value={b.severity} />
                      <KanbanDue date={b.due_date} open={['assigned', 'in_progress', 'reopened'].includes(b.status)} />
                    </div>
                    <span className="shrink-0"><Person name={b.assigned_dev_id ? profileName(b.assigned_dev_id) : null} showName={false} size={22} /></span>
                  </div>
                  {pending && <div className="rounded-md bg-muted/60 px-2 py-1 text-[11px] text-muted-foreground">{t('retestBy', { name: profileName(pending.tester_id), date: fmtDate(pending.due_date) })}</div>}
                </div>
              );
            }}
          />
        </>
      ) : view === 'bugs' ? (
        <>
          {bugs.length === 0 && <EmptyState done text={t('noBugs')} />}
          {BUG_GROUPS.map((g) => {
            const items = bugs.filter((b) => (g.statuses as readonly string[]).includes(b.status));
            if (!items.length) return null;
            return (
              <BoardGroup key={g.key} title={t(`group.${g.key}`)} color={g.color} count={items.length} defaultOpen={g.key !== 'closed' && g.key !== 'cancelled'}>
                <Table className="board-table">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-left">{t('col.bug')}</TableHead><TableHead>{t('col.severity')}</TableHead><TableHead>{t('col.status')}</TableHead>
                      <TableHead>{t('col.developer')}</TableHead><TableHead>{t('col.reporter')}</TableHead><TableHead>{t('col.fixDue')}</TableHead><TableHead>{t('col.retest')}</TableHead>
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
          {data.rounds.length === 0 && <EmptyState text={t('noRounds')} />}
          {[...data.rounds].reverse().map((r, i) => {
            const rb = data.bugs.filter((b) => b.test_round_id === r.id);
            return (
              <BoardGroup key={r.id} title={`${t('round', { no: r.round_no })} — ${r.title}`} color={['#784bd1', '#579bfc', '#00c875', '#fdab3d'][i % 4]} count={rb.length}
                actions={<div className="flex items-center gap-2">
                  <StatusChip list={TEST_ROUND_STATUSES} value={r.status} className="h-6 min-w-20" />
                  {r.result && <StatusChip list={TEST_RESULTS} value={r.result} className="h-6 min-w-20" />}
                  <Button size="sm" variant="ghost" onClick={() => setRound(r)}>{t('open')}</Button>
                </div>}>
                <div className="grid grid-cols-2 gap-3 border-b border-grid p-3 text-sm md:grid-cols-6">
                  <div><div className="text-xs text-muted-foreground">{t('info.type')}</div>{optLabel(TEST_TYPES, r.test_type)}</div>
                  <div><div className="text-xs text-muted-foreground">{t('info.tester')}</div><Person name={r.tester_id ? profileName(r.tester_id) : null} /></div>
                  <div><div className="text-xs text-muted-foreground">{t('info.plannedDue')}</div>{fmtDate(r.planned_date)} → {fmtDate(r.due_date)}</div>
                  <div><div className="text-xs text-muted-foreground">{t('info.actual')}</div>{fmtDate(r.actual_date)}</div>
                  <div><div className="text-xs text-muted-foreground">{t('info.cases')}</div>{r.total_cases != null ? <span>{t.rich('info.casesValue', { passed: r.passed_cases ?? 0, failed: r.failed_cases ?? 0, total: r.total_cases, ok: (c) => <b className="text-[#00854d]">{c}</b>, bad: (c) => <b className="text-destructive">{c}</b> })}</span> : '–'}</div>
                  <div><div className="text-xs text-muted-foreground">{t('info.activity')}</div>{data.activities.find((a) => a.id === r.activity_id)?.name ?? '-'}</div>
                  {r.summary && <div className="col-span-full text-muted-foreground">{r.summary}</div>}
                </div>
                {rb.length > 0 ? (
                  <Table className="board-table">
                    <TableHeader><TableRow><TableHead className="text-left">{t('col.bug')}</TableHead><TableHead>{t('col.severity')}</TableHead><TableHead>{t('col.status')}</TableHead><TableHead>{t('col.developer')}</TableHead><TableHead>{t('col.reporter')}</TableHead><TableHead>{t('col.fixDue')}</TableHead><TableHead>{t('col.retest')}</TableHead></TableRow></TableHeader>
                    <TableBody>{rb.map(bugRow)}</TableBody>
                  </Table>
                ) : <EmptyState text={t('noBugsInRound')} />}
                <div className="no-print border-t border-grid px-2 py-1">
                  <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => setReport({ test_round_id: r.id })}><Plus /> {t('reportInRound')}</Button>
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
          initialTab={bug.id === focusBug && focusPanel === 'comments' ? 'comments' : undefined}
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
