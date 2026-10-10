'use client';

import dayjs from 'dayjs';
import { Flag, GitPullRequestArrow, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { dispatchEmails, useApp } from '@/components/AppProvider';
import { ActionButton, BoardGroup, CommentDialog, DateField, EmptyState, Person, StatusChip, TextField } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { REVISION_STATUSES } from '@/lib/constants';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { errMsg, fmtDate, fmtDateTime } from '@/lib/format';
import { dbClient } from '@/lib/db/client';
import { cn } from '@/lib/utils';
import type { TabProps } from './types';

const diff = (a: string | null, b: string | null) => (a && b ? dayjs(a).diff(dayjs(b), 'day') : null);

function Variance({ v }: { v: number | null }) {
  if (v == null) return <>-</>;
  return <span className={cn('font-semibold', v > 0 ? 'text-destructive' : v < 0 ? 'text-[#00854d]' : 'text-muted-foreground')}>{v > 0 ? `+${v}` : v}d</span>;
}

export default function BaselineTab({ data, perm, reload }: TabProps) {
  const db = dbClient();
  const { me, hasRole, profileName, notify } = useApp();
  const latestId = data.baselines[0]?.id ?? null;
  const [picked, setPicked] = useState<{ id: string | null; latest: string | null }>({ id: latestId, latest: latestId });
  // jump to the newest version whenever a new baseline appears
  const sel = picked.latest === latestId ? picked.id : latestId;
  const setSel = (id: string) => setPicked({ id, latest: latestId });
  const [dialog, setDialog] = useState(false);
  const [revOpen, setRevOpen] = useState(false);
  const [rev, setRev] = useState({ reason: '', impact: '', target: data.project.target_date ?? '' });
  const [decide, setDecide] = useState<'approve' | 'reject' | null>(null);
  const pending = data.revisions.find((r) => r.status === 'pending');
  const canApprove = hasRole('supervisor', 'manager') || data.members.some((m) => m.user_id === me?.id && ['manager', 'supervisor'].includes(m.member_role));
  const latestItems = data.baselineItems.filter((i) => i.baseline_id === data.baselines[0]?.id);

  const rpc = async (fn: string, args: Record<string, unknown>, ok: string) => {
    const { error } = await db.rpc(fn, args);
    if (error) { notify(errMsg(error), 'error'); return false; }
    notify(ok);
    dispatchEmails();
    await reload();
    return true;
  };
  const p = data.project;
  const baseline = data.baselines.find((b) => b.id === sel);
  const items = data.baselineItems.filter((i) => i.baseline_id === sel);
  const first = p.baseline_version === 0;

  const create = async (reason: string) => {
    const { error } = await db.rpc('create_baseline', { p_project_id: p.id, p_reason: reason || null });
    if (error) return notify(errMsg(error), 'error');
    notify(first ? 'Baseline V1 set — project started' : 'New baseline version created');
    dispatchEmails();
    setDialog(false);
    await reload();
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <p className="flex-1 text-sm text-muted-foreground">
          A baseline freezes the approved User Control Plan. Re-plans need a reason and Manager approval; old versions are never overwritten. Schedule Variance = Forecast Finish − Baseline Finish.
        </p>
        {perm.manage && first && (
          <ActionButton tone="success" className="no-print" onClick={() => setDialog(true)}><Flag /> Set Baseline V1 & Start Project</ActionButton>
        )}
        {perm.manage && !first && !pending && (
          <Button className="no-print" onClick={() => setRevOpen(true)}><GitPullRequestArrow /> Request Baseline Revision</Button>
        )}
      </div>

      {pending && (
        <div className="mb-5 rounded-lg border-2 border-[#fdab3d] bg-[#fffaf0] p-4">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <GitPullRequestArrow className="size-5 text-[#d97706]" />
            <h3 className="font-semibold">Baseline revision V{pending.from_version} → V{pending.from_version + 1} waiting for approval</h3>
            <StatusChip list={REVISION_STATUSES} value={pending.status} className="h-6" />
          </div>
          <div className="grid grid-cols-1 gap-3 text-sm md:grid-cols-4">
            <div><div className="text-xs text-muted-foreground">Requested by</div><Person name={profileName(pending.requested_by)} /> <span className="text-xs text-muted-foreground">{fmtDateTime(pending.requested_at)}</span></div>
            <div><div className="text-xs text-muted-foreground">Target date</div>{fmtDate(pending.previous_target_date)} → <b>{fmtDate(pending.proposed_target_date)}</b></div>
            <div className="md:col-span-2"><div className="text-xs text-muted-foreground">Reason</div>{pending.reason}</div>
            {pending.impact && <div className="md:col-span-4"><div className="text-xs text-muted-foreground">Impact</div>{pending.impact}</div>}
          </div>
          <Table className="board-table mt-3 bg-white">
            <TableHeader><TableRow><TableHead className="text-left">Activity</TableHead><TableHead>Baseline V{pending.from_version} Finish</TableHead><TableHead>Proposed Finish</TableHead><TableHead>Change</TableHead></TableRow></TableHeader>
            <TableBody>
              {pending.plan_snapshot.map((s) => {
                const old = latestItems.find((i) => i.activity_id === s.activity_id);
                const d = diff(s.plan_finish, old?.planned_finish ?? null);
                return (
                  <TableRow key={s.activity_id} className={cn(d && 'bg-[#fff6e5]')}>
                    <TableCell>{s.name}{!old && <span className="ml-1 rounded bg-secondary px-1 text-[10px]">new</span>}</TableCell>
                    <TableCell className="text-center">{fmtDate(old?.planned_finish)}</TableCell>
                    <TableCell className="text-center font-medium">{fmtDate(s.plan_finish)}</TableCell>
                    <TableCell className="text-center"><Variance v={d} /></TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          <div className="no-print mt-3 flex flex-wrap gap-2">
            {canApprove && pending.requested_by !== me?.id && <>
              <ActionButton tone="success" onClick={() => setDecide('approve')}>Approve → create V{pending.from_version + 1}</ActionButton>
              <ActionButton tone="destructive" outline onClick={() => setDecide('reject')}>Reject</ActionButton>
            </>}
            {(pending.requested_by === me?.id || perm.manage) && (
              <Button variant="ghost" onClick={() => rpc('cancel_baseline_revision', { p_revision_id: pending.id }, 'Request cancelled')}>Cancel request</Button>
            )}
            {!canApprove && <span className="text-sm text-muted-foreground">Waiting for Manager / Supervisor approval.</span>}
          </div>
        </div>
      )}

      {first && (
        <Alert className="mb-4 border-[#fdab3d] bg-[#fff6e5]"><TriangleAlert /><AlertDescription>Baseline V1 has not been set. Finalise the User Control Plan (all activities need Plan Start / Plan Finish), then set Baseline V1 to start the project.</AlertDescription></Alert>
      )}

      {data.baselines.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-2">
          {data.baselines.map((b) => (
            <button key={b.id} type="button" onClick={() => setSel(b.id)}
              className={cn('rounded-full border px-3 py-1 text-sm', b.id === sel ? 'border-primary bg-selected text-primary' : 'hover:bg-muted')}>
              Baseline V{b.version_no}
            </button>
          ))}
        </div>
      )}

      {baseline ? (
        <>
          <div className="mb-4 flex flex-wrap gap-8 rounded-lg bg-muted p-4 text-sm">
            <div><div className="text-xs text-muted-foreground">Version</div><div className="font-semibold">V{baseline.version_no}</div></div>
            <div><div className="text-xs text-muted-foreground">Planned Start → Finish</div><div className="font-semibold">{fmtDate(baseline.planned_start)} → {fmtDate(baseline.planned_finish)}</div></div>
            <div><div className="text-xs text-muted-foreground">Current Forecast</div><div className="font-semibold">{fmtDate(p.forecast_date)}</div></div>
            <div><div className="text-xs text-muted-foreground">Variance</div><Variance v={diff(p.forecast_date, baseline.planned_finish)} /></div>
            <div><div className="text-xs text-muted-foreground">Reason</div><div>{baseline.reason}</div></div>
            <div><div className="text-xs text-muted-foreground">Created</div><div>{profileName(baseline.created_by)} · {fmtDateTime(baseline.created_at)}</div></div>
            {baseline.approved_by && <div><div className="text-xs text-muted-foreground">Approved by</div><div>{profileName(baseline.approved_by)}</div></div>}
          </div>
          <BoardGroup title={`Baseline V${baseline.version_no} vs current plan`} color="#784bd1" count={items.length}>
            <Table className="board-table">
              <TableHeader>
                <TableRow>
                  <TableHead className="text-left">Activity</TableHead><TableHead>PIC (baseline)</TableHead>
                  <TableHead>Baseline Start</TableHead><TableHead>Baseline Finish</TableHead>
                  <TableHead>Current Plan Finish</TableHead><TableHead>Actual / Forecast Finish</TableHead><TableHead>Variance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((i) => {
                  const a = data.activities.find((x) => x.id === i.activity_id);
                  const fc = a ? a.actual_finish ?? a.forecast_finish ?? (a.plan_finish && dayjs(a.plan_finish).isBefore(dayjs(), 'day') && a.status !== 'completed' ? dayjs().format('YYYY-MM-DD') : a.plan_finish) : null;
                  return (
                    <TableRow key={i.id}>
                      <TableCell className="font-medium">{i.is_milestone && '◆ '}{i.activity_name}{!a && <span className="ml-1 rounded bg-secondary px-1.5 text-xs">removed</span>}</TableCell>
                      <TableCell className="text-center">{i.pic}</TableCell>
                      <TableCell className="text-center">{fmtDate(i.planned_start)}</TableCell>
                      <TableCell className="text-center">{fmtDate(i.planned_finish)}</TableCell>
                      <TableCell className="text-center">{fmtDate(a?.plan_finish)}</TableCell>
                      <TableCell className="text-center">{fmtDate(fc)}{a?.actual_finish && <span className="text-xs text-[#00854d]"> (actual)</span>}</TableCell>
                      <TableCell className="text-center"><Variance v={diff(fc, i.planned_finish)} /></TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </BoardGroup>
        </>
      ) : !first ? null : <EmptyState text="No baseline yet" />}

      {data.revisions.filter((r) => r.status !== 'pending').length > 0 && (
        <BoardGroup title="Baseline Revision History" color="#a25ddc" count={data.revisions.filter((r) => r.status !== 'pending').length} defaultOpen={false}>
          <Table className="board-table">
            <TableHeader><TableRow><TableHead>From</TableHead><TableHead className="text-left">Reason</TableHead><TableHead>Target change</TableHead><TableHead>Requested</TableHead><TableHead>Decision</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
            <TableBody>
              {data.revisions.filter((r) => r.status !== 'pending').map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="text-center">V{r.from_version}{r.status === 'approved' && ` → V${r.from_version + 1}`}</TableCell>
                  <TableCell className="whitespace-normal">{r.reason}{r.impact && <div className="text-xs text-muted-foreground">Impact: {r.impact}</div>}</TableCell>
                  <TableCell className="text-center">{fmtDate(r.previous_target_date)} → {fmtDate(r.proposed_target_date)}</TableCell>
                  <TableCell className="text-center text-xs">{profileName(r.requested_by)}<br />{fmtDateTime(r.requested_at)}</TableCell>
                  <TableCell className="text-center text-xs whitespace-normal">{r.decided_by ? <>{profileName(r.decided_by)} · {fmtDateTime(r.decided_at)}{r.decision_comment && <div className="italic">“{r.decision_comment}”</div>}</> : '–'}</TableCell>
                  <TableCell className="p-1"><StatusChip list={REVISION_STATUSES} value={r.status} fullWidth /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </BoardGroup>
      )}

      <Dialog open={revOpen} onOpenChange={setRevOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Request Baseline Revision (V{p.baseline_version} → V{p.baseline_version + 1})</DialogTitle>
            <DialogDescription>Update the plan dates in the User Control Plan first. The current plan is captured as the proposal and must be approved by a Manager / Supervisor. Baseline V{p.baseline_version} is kept.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <TextField label="Reason (required)" multiline rows={2} value={rev.reason} onChange={(v) => setRev({ ...rev, reason: v })} />
            <TextField label="Impact" value={rev.impact} onChange={(v) => setRev({ ...rev, impact: v })} placeholder="e.g. Go-live +1 week; no cost impact" />
            <DateField label="New Target Date" value={rev.target} onChange={(v) => setRev({ ...rev, target: v })} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRevOpen(false)}>Cancel</Button>
            <Button disabled={!rev.reason.trim()} onClick={async () => {
              if (await rpc('request_baseline_revision', { p_project_id: p.id, p_reason: rev.reason, p_impact: rev.impact || null, p_new_target: rev.target || null }, 'Revision request sent for approval')) {
                setRevOpen(false);
              }
            }}>Submit for Approval</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {decide && pending && (
        <CommentDialog open title={decide === 'approve' ? `Approve baseline V${pending.from_version + 1}` : 'Reject baseline revision'}
          description={pending.reason} confirmLabel={decide === 'approve' ? 'Approve' : 'Reject'} required={decide === 'reject'}
          variant={decide === 'approve' ? 'success' : 'destructive'} onClose={() => setDecide(null)}
          onConfirm={async (c) => {
            if (await rpc('decide_baseline_revision', { p_revision_id: pending.id, p_approve: decide === 'approve', p_comment: c || null },
              decide === 'approve' ? `Baseline V${pending.from_version + 1} created` : 'Revision rejected')) setDecide(null);
          }} />
      )}

      <CommentDialog
        open={dialog}
        title="Set Baseline V1"
        description="Freezes the current User Control Plan as Baseline V1 and moves the project to In Progress."
        confirmLabel="Set Baseline V1"
        variant="success"
        onClose={() => setDialog(false)}
        onConfirm={create}
      />
    </div>
  );
}
