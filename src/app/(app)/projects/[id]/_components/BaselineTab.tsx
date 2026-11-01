'use client';

import dayjs from 'dayjs';
import { Flag, GitPullRequestArrow, TriangleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { dispatchEmails, useApp } from '@/providers/AppProvider';
import { ActionButton, CommentDialog, DateField, SelectField, TextField } from '@/components/shared/form';
import { BoardGroup, Person, StatusChip } from '@/components/shared/labels';
import { EmptyState } from '@/components/shared/layout';
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
  const tc = useTranslations('common');
  if (v == null) return <>-</>;
  return <span className={cn('font-semibold', v > 0 ? 'text-destructive' : v < 0 ? 'text-[#00854d]' : 'text-muted-foreground')}>{tc('days', { n: v > 0 ? `+${v}` : v })}</span>;
}

export default function BaselineTab({ data, perm, reload, linkCr }: TabProps & { linkCr?: number | null }) {
  const t = useTranslations('project.baseline');
  const tc = useTranslations('common');
  const db = dbClient();
  const { me, hasRole, profileName, notify } = useApp();
  const latestId = data.baselines[0]?.id ?? null;
  const [picked, setPicked] = useState<{ id: number | null; latest: number | null }>({ id: latestId, latest: latestId });
  // jump to the newest version whenever a new baseline appears
  const sel = picked.latest === latestId ? picked.id : latestId;
  const setSel = (id: number) => setPicked({ id, latest: latestId });
  const [dialog, setDialog] = useState(false);
  // approved change requests a revision can carry out (not counted as a reschedule); ?cr= opens the dialog for one
  const crs = data.changeRequests.filter((c) => ['approved', 'implemented'].includes(c.status) && !data.revisions.some((r) => r.change_request_id === c.id && r.status !== 'rejected' && r.status !== 'cancelled'));
  const fromCr = (id: number | null) => {
    const c = crs.find((x) => x.id === id);
    return c
      ? { cr: String(c.id), reason: `${c.cr_no} ${c.title}`, impact: c.impact_summary ?? '', target: c.impact_target ?? data.project.target_date ?? '' }
      : { cr: '', reason: '', impact: '', target: data.project.target_date ?? '' };
  };
  const [revOpen, setRevOpen] = useState(!!linkCr && crs.some((c) => c.id === linkCr) && perm.manage && !data.revisions.some((r) => r.status === 'pending'));
  const [rev, setRev] = useState(() => fromCr(linkCr ?? null));
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
    notify(first ? t('v1Set') : t('created'));
    dispatchEmails();
    setDialog(false);
    await reload();
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <p className="flex-1 text-sm text-muted-foreground">
          {t('intro')}
        </p>
        {perm.manage && first && (
          <ActionButton tone="success" className="no-print" onClick={() => setDialog(true)}><Flag /> {t('setV1Start')}</ActionButton>
        )}
        {perm.manage && !first && !pending && (
          <Button className="no-print" onClick={() => setRevOpen(true)}><GitPullRequestArrow /> {t('requestRevision')}</Button>
        )}
      </div>

      {pending && (
        <div className="mb-5 rounded-lg border-2 border-[#fdab3d] bg-[#fffaf0] p-4">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <GitPullRequestArrow className="size-5 text-[#d97706]" />
            <h3 className="font-semibold">{t('pending.title', { from: pending.from_version, to: pending.from_version + 1 })}</h3>
            <StatusChip list={REVISION_STATUSES} value={pending.status} className="h-6" />
          </div>
          <div className="grid grid-cols-1 gap-3 text-sm md:grid-cols-4">
            <div><div className="text-xs text-muted-foreground">{t('pending.requestedBy')}</div><Person name={profileName(pending.requested_by)} /> <span className="text-xs text-muted-foreground">{fmtDateTime(pending.requested_at)}</span></div>
            <div><div className="text-xs text-muted-foreground">{t('pending.targetDate')}</div>{fmtDate(pending.previous_target_date)} → <b>{fmtDate(pending.proposed_target_date)}</b></div>
            <div className="md:col-span-2"><div className="text-xs text-muted-foreground">{t('reason')}</div>{pending.reason}</div>
            {pending.impact && <div className="md:col-span-4"><div className="text-xs text-muted-foreground">{t('impact')}</div>{pending.impact}</div>}
          </div>
          <Table className="board-table mt-3 bg-white">
            <TableHeader><TableRow><TableHead className="text-left">{t('col.activity')}</TableHead><TableHead>{t('pending.baselineFinish', { version: pending.from_version })}</TableHead><TableHead>{t('pending.proposedFinish')}</TableHead><TableHead>{t('pending.change')}</TableHead></TableRow></TableHeader>
            <TableBody>
              {pending.plan_snapshot.map((s) => {
                const old = latestItems.find((i) => i.activity_id === s.activity_id);
                const d = diff(s.plan_finish, old?.planned_finish ?? null);
                return (
                  <TableRow key={s.activity_id} className={cn(d && 'bg-[#fff6e5]')}>
                    <TableCell>{s.name}{!old && <span className="ml-1 rounded bg-secondary px-1 text-[10px]">{t('new')}</span>}</TableCell>
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
              <ActionButton tone="success" onClick={() => setDecide('approve')}>{t('pending.approve', { version: pending.from_version + 1 })}</ActionButton>
              <ActionButton tone="destructive" outline onClick={() => setDecide('reject')}>{t('pending.reject')}</ActionButton>
            </>}
            {(pending.requested_by === me?.id || perm.manage) && (
              <Button variant="ghost" onClick={() => rpc('cancel_baseline_revision', { p_revision_id: pending.id }, t('pending.cancelled'))}>{t('pending.cancel')}</Button>
            )}
            {!canApprove && <span className="text-sm text-muted-foreground">{t('pending.waiting')}</span>}
          </div>
        </div>
      )}

      {first && (
        <Alert className="mb-4 border-[#fdab3d] bg-[#fff6e5]"><TriangleAlert /><AlertDescription>{t('notSet')}</AlertDescription></Alert>
      )}

      {data.baselines.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-2">
          {data.baselines.map((b) => (
            <button key={b.id} type="button" onClick={() => setSel(b.id)}
              className={cn('rounded-full border px-3 py-1 text-sm', b.id === sel ? 'border-primary bg-selected text-primary' : 'hover:bg-muted')}>
              {t('version', { version: b.version_no })}
            </button>
          ))}
        </div>
      )}

      {baseline ? (
        <>
          <div className="mb-4 flex flex-wrap gap-8 rounded-lg bg-muted p-4 text-sm">
            <div><div className="text-xs text-muted-foreground">{t('info.version')}</div><div className="font-semibold">V{baseline.version_no}</div></div>
            <div><div className="text-xs text-muted-foreground">{t('info.planned')}</div><div className="font-semibold">{fmtDate(baseline.planned_start)} → {fmtDate(baseline.planned_finish)}</div></div>
            <div><div className="text-xs text-muted-foreground">{t('info.forecast')}</div><div className="font-semibold">{fmtDate(p.forecast_date)}</div></div>
            <div><div className="text-xs text-muted-foreground">{t('info.variance')}</div><Variance v={diff(p.forecast_date, baseline.planned_finish)} /></div>
            <div><div className="text-xs text-muted-foreground">{t('reason')}</div><div>{baseline.reason}</div></div>
            <div><div className="text-xs text-muted-foreground">{t('info.created')}</div><div>{profileName(baseline.created_by)} · {fmtDateTime(baseline.created_at)}</div></div>
            {baseline.approved_by && <div><div className="text-xs text-muted-foreground">{t('info.approvedBy')}</div><div>{profileName(baseline.approved_by)}</div></div>}
          </div>
          <BoardGroup title={t('vsCurrent', { version: baseline.version_no })} color="#784bd1" count={items.length}>
            <Table className="board-table">
              <TableHeader>
                <TableRow>
                  <TableHead className="text-left">{t('col.activity')}</TableHead><TableHead>{t('col.pic')}</TableHead>
                  <TableHead>{t('col.start')}</TableHead><TableHead>{t('col.finish')}</TableHead>
                  <TableHead>{t('col.currentFinish')}</TableHead><TableHead>{t('col.actualForecast')}</TableHead><TableHead>{t('info.variance')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((i) => {
                  const a = data.activities.find((x) => x.id === i.activity_id);
                  const fc = a ? a.actual_finish ?? a.forecast_finish ?? (a.plan_finish && dayjs(a.plan_finish).isBefore(dayjs(), 'day') && a.status !== 'completed' ? dayjs().format('YYYY-MM-DD') : a.plan_finish) : null;
                  return (
                    <TableRow key={i.id}>
                      <TableCell className="font-medium">{i.is_milestone && '◆ '}{i.activity_name}{!a && <span className="ml-1 rounded bg-secondary px-1.5 text-xs">{t('removed')}</span>}</TableCell>
                      <TableCell className="text-center">{i.pic}</TableCell>
                      <TableCell className="text-center">{fmtDate(i.planned_start)}</TableCell>
                      <TableCell className="text-center">{fmtDate(i.planned_finish)}</TableCell>
                      <TableCell className="text-center">{fmtDate(a?.plan_finish)}</TableCell>
                      <TableCell className="text-center">{fmtDate(fc)}{a?.actual_finish && <span className="text-xs text-[#00854d]"> {t('actual')}</span>}</TableCell>
                      <TableCell className="text-center"><Variance v={diff(fc, i.planned_finish)} /></TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </BoardGroup>
        </>
      ) : !first ? null : <EmptyState text={t('empty')} />}

      {data.revisions.filter((r) => r.status !== 'pending').length > 0 && (
        <BoardGroup title={t('history.title')} color="#a25ddc" count={data.revisions.filter((r) => r.status !== 'pending').length} defaultOpen={false}>
          <Table className="board-table">
            <TableHeader><TableRow><TableHead>{t('history.from')}</TableHead><TableHead className="text-left">{t('reason')}</TableHead><TableHead>{t('history.targetChange')}</TableHead><TableHead>{t('history.requested')}</TableHead><TableHead>{t('history.decision')}</TableHead><TableHead>{t('history.status')}</TableHead></TableRow></TableHeader>
            <TableBody>
              {data.revisions.filter((r) => r.status !== 'pending').map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="text-center">V{r.from_version}{r.status === 'approved' && ` → V${r.from_version + 1}`}</TableCell>
                  <TableCell className="whitespace-normal">{r.reason}{r.change_request_id && <span className="ml-1 rounded bg-[#579bfc]/15 px-1.5 py-0.5 text-[11px] font-medium text-[#1f62c8]">{t('history.scopeChange')}</span>}{r.impact && <div className="text-xs text-muted-foreground">{t('impactValue', { impact: r.impact })}</div>}</TableCell>
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
            <DialogTitle>{t('revision.title', { from: p.baseline_version, to: p.baseline_version + 1 })}</DialogTitle>
            <DialogDescription>{t('revision.description', { version: p.baseline_version })}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {crs.length > 0 && (
              <SelectField label={t('revision.changeRequest')} value={rev.cr} allowEmpty placeholder={t('revision.noChangeRequest')}
                onChange={(v) => setRev(v ? fromCr(Number(v)) : { ...rev, cr: '' })}
                options={crs.map((c) => ({ value: String(c.id), label: `${c.cr_no} ${c.title}` }))} helperText={t('revision.changeRequestHelp')} />
            )}
            <TextField label={t('revision.reason')} multiline rows={2} value={rev.reason} onChange={(v) => setRev({ ...rev, reason: v })} />
            <TextField label={t('impact')} value={rev.impact} onChange={(v) => setRev({ ...rev, impact: v })} placeholder={t('revision.impactPlaceholder')} />
            <DateField label={t('revision.newTarget')} value={rev.target} onChange={(v) => setRev({ ...rev, target: v })} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRevOpen(false)}>{tc('cancel')}</Button>
            <Button disabled={!rev.reason.trim()} onClick={async () => {
              if (await rpc('request_baseline_revision', { p_project_id: p.id, p_reason: rev.reason, p_impact: rev.impact || null, p_new_target: rev.target || null, p_change_request_id: rev.cr ? Number(rev.cr) : null }, t('revision.sent'))) {
                setRevOpen(false);
              }
            }}>{t('revision.submit')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {decide && pending && (
        <CommentDialog open title={decide === 'approve' ? t('decide.approveTitle', { version: pending.from_version + 1 }) : t('decide.rejectTitle')}
          description={pending.reason} confirmLabel={decide === 'approve' ? t('decide.approve') : t('decide.reject')} required={decide === 'reject'}
          variant={decide === 'approve' ? 'success' : 'destructive'} onClose={() => setDecide(null)}
          onConfirm={async (c) => {
            if (await rpc('decide_baseline_revision', { p_revision_id: pending.id, p_approve: decide === 'approve', p_comment: c || null },
              decide === 'approve' ? t('decide.approved', { version: pending.from_version + 1 }) : t('decide.rejected'))) setDecide(null);
          }} />
      )}

      <CommentDialog
        open={dialog}
        title={t('setV1')}
        description={t('setV1Description')}
        confirmLabel={t('setV1')}
        variant="success"
        onClose={() => setDialog(false)}
        onConfirm={create}
      />
    </div>
  );
}
