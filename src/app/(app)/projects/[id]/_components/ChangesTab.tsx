'use client';

import { CalendarClock, Check, FilePlus2, Hammer, ThumbsDown, ThumbsUp, Undo2, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { dispatchEmails, useApp } from '@/providers/AppProvider';
import { ActionButton, CommentDialog, DateField, SelectField, TextField } from '@/components/shared/form';
import { BoardGroup, PriorityChip, StatusChip } from '@/components/shared/labels';
import { EmptyState } from '@/components/shared/layout';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useOptions } from '@/i18n/useOptions';
import { CR_STATUSES, CR_TYPES, PRIORITIES } from '@/lib/constants';
import { dbClient } from '@/lib/db/client';
import { errMsg, fmtDate, fmtDateTime } from '@/lib/format';
import type { ChangeRequest } from '@/lib/types';
import { useCanAccept } from './ClosureSignoff';
import type { TabProps } from './types';

/** Change Requests: scope changes after the project started. Server: src/server/rpc/change-requests.ts */
const OPEN = ['submitted', 'assessed', 'agreed', 'approved'];

async function rpc(fn: string, args: Record<string, unknown>) {
  const { error } = await dbClient().rpc(fn, args);
  if (error) throw new Error(errMsg(error));
  dispatchEmails();
}

export default function ChangesTab({ data, perm, reload, focusCr }: TabProps & { focusCr?: number | null }) {
  const t = useTranslations('project.changes');
  const router = useRouter();
  const { profileName } = useApp();
  const canAccept = useCanAccept(data);
  const [creating, setCreating] = useState(false);
  const p = data.project;
  const closed = ['completed', 'cancelled'].includes(p.status);
  const canRaise = !closed && (perm.internal || canAccept);
  const open = (id: number | null) => router.replace(`/projects/${p.id}?tab=changes${id ? `&cr=${id}` : ''}`, { scroll: false });
  const selected = data.changeRequests.find((c) => c.id === focusCr) ?? null;
  const active = data.changeRequests.filter((c) => OPEN.includes(c.status));
  const done = data.changeRequests.filter((c) => !OPEN.includes(c.status));

  const table = (rows: ChangeRequest[]) => (
    <Table className="board-table">
      <TableHeader>
        <TableRow>
          <TableHead className="text-left">{t('field.title')}</TableHead><TableHead>{t('field.type')}</TableHead><TableHead>{t('field.priority')}</TableHead>
          <TableHead>{t('field.status')}</TableHead><TableHead>{t('field.effort')}</TableHead><TableHead>{t('field.newTarget')}</TableHead><TableHead>{t('field.raised')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((c) => (
          <TableRow key={c.id} className="cursor-pointer" onClick={() => open(c.id)}>
            <TableCell className="min-w-64 whitespace-normal">{c.title}<span className="ml-1 text-xs text-muted-foreground/70">{c.cr_no}</span></TableCell>
            <TableCell className="p-1"><StatusChip list={CR_TYPES} value={c.change_type} fullWidth /></TableCell>
            <TableCell className="p-1"><PriorityChip value={c.priority} fullWidth /></TableCell>
            <TableCell className="min-w-32 p-1"><StatusChip list={CR_STATUSES} value={c.status} fullWidth /></TableCell>
            <TableCell className="text-center">{c.impact_md == null ? '–' : t('md', { n: c.impact_md })}</TableCell>
            <TableCell className="text-center">{c.impact_target ? fmtDate(c.impact_target) : '–'}</TableCell>
            <TableCell className="text-center text-xs">{profileName(c.requested_by)}<br />{fmtDate(c.requested_at)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-muted-foreground">{t('intro')}</p>
        {canRaise && <Button onClick={() => setCreating(true)}><FilePlus2 /> {t('new')}</Button>}
      </div>
      {data.changeRequests.length === 0 ? <EmptyState text={t('empty')} /> : (
        <>
          {active.length > 0 && <BoardGroup title={t('open')} color="#579bfc" count={active.length}>{table(active)}</BoardGroup>}
          {done.length > 0 && <BoardGroup title={t('closed')} color="#757575" count={done.length} defaultOpen={active.length === 0}>{table(done)}</BoardGroup>}
        </>
      )}
      {creating && <NewChangeRequest projectId={p.id} reload={reload} onClose={(id) => { setCreating(false); if (id) open(id); }} />}
      {selected && <ChangeRequestDialog key={selected.id} cr={selected} data={data} perm={perm} reload={reload} onClose={() => open(null)} />}
    </div>
  );
}

function NewChangeRequest({ projectId, reload, onClose }: { projectId: number; reload: () => Promise<void>; onClose: (id?: number) => void }) {
  const t = useTranslations('project.changes');
  const { notify } = useApp();
  const { options } = useOptions();
  const [f, setF] = useState({ title: '', change_type: 'add', priority: 'medium', description: '', reason: '' });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (v: string) => setF({ ...f, [k]: v });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t('new')}</DialogTitle>
          <DialogDescription>{t('newDescription')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <TextField label={t('field.title')} required value={f.title} onChange={set('title')} />
          <div className="grid grid-cols-2 gap-3">
            <SelectField label={t('field.type')} value={f.change_type} onChange={set('change_type')} options={options(CR_TYPES)} />
            <SelectField label={t('field.priority')} value={f.priority} onChange={set('priority')} options={options(PRIORITIES)} />
          </div>
          <TextField label={t('field.description')} required multiline rows={4} value={f.description} onChange={set('description')} placeholder={t('descriptionPlaceholder')} />
          <TextField label={t('field.reason')} required multiline rows={2} value={f.reason} onChange={set('reason')} placeholder={t('reasonPlaceholder')} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onClose()}>{t('cancel')}</Button>
          <Button disabled={busy || !f.title.trim() || !f.description.trim() || !f.reason.trim()} onClick={async () => {
            setBusy(true);
            try {
              const { data: cr, error } = await dbClient().rpc('submit_change_request', {
                p_project_id: projectId, p_title: f.title, p_change_type: f.change_type, p_priority: f.priority, p_description: f.description, p_reason: f.reason,
              });
              if (error) throw new Error(errMsg(error));
              dispatchEmails();
              notify(t('submitted'));
              await reload();
              onClose((cr as ChangeRequest | null)?.id);
            } catch (e) {
              notify(errMsg(e), 'error');
            } finally {
              setBusy(false);
            }
          }}>{t('submit')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type Prompt = 'disagree' | 'approve' | 'reject' | 'implement' | 'withdraw' | 'agree';

function ChangeRequestDialog({ cr, data, perm, reload, onClose }: Pick<TabProps, 'data' | 'perm' | 'reload'> & { cr: ChangeRequest; onClose: () => void }) {
  const t = useTranslations('project.changes');
  const router = useRouter();
  const { me, notify, profileName, hasRole } = useApp();
  const canAccept = useCanAccept(data);
  const [assessing, setAssessing] = useState(false);
  const [impact, setImpact] = useState({ md: cr.impact_md?.toString() ?? '', target: cr.impact_target ?? '', summary: cr.impact_summary ?? '' });
  const [prompt, setPrompt] = useState<Prompt | null>(null);

  const act = async (fn: string, args: Record<string, unknown>, msg: string) => {
    try {
      await rpc(fn, { p_cr_id: cr.id, ...args });
      notify(msg);
      setPrompt(null);
      setAssessing(false);
      await reload();
    } catch (e) {
      notify(errMsg(e), 'error');
    }
  };

  const mine = cr.requested_by === me?.id;
  const can = {
    assess: perm.manage && ['submitted', 'assessed'].includes(cr.status),
    agree: canAccept && cr.status === 'assessed',
    decide: hasRole('manager', 'supervisor', 'admin') && cr.status === 'agreed' && (!mine || hasRole('admin')),
    implement: perm.manage && cr.status === 'approved',
    withdraw: (mine || perm.manage) && ['submitted', 'assessed', 'agreed'].includes(cr.status),
  };
  const targetMoves = !!cr.impact_target && cr.impact_target !== data.project.target_date;
  const revision = data.revisions.find((r) => r.change_request_id === cr.id);
  const otherPending = !revision && data.revisions.some((r) => r.status === 'pending');

  const step = (label: string, by: number | null, at: string | null, extra?: React.ReactNode) => at && (
    <li className="flex gap-2 text-sm"><Check className="mt-0.5 size-4 shrink-0 text-[#00c875]" />
      <div><span className="font-medium">{label}</span> <span className="text-xs text-muted-foreground">{by ? `${profileName(by)} · ` : ''}{fmtDateTime(at)}</span>{extra}</div>
    </li>
  );

  const prompts: Record<Prompt, { title: string; confirm: string; required: boolean; variant: 'success' | 'destructive' | 'warning' | 'default'; run: (c: string) => Promise<void> }> = {
    agree: { title: t('agreeTitle'), confirm: t('agree'), required: false, variant: 'success', run: (c) => act('agree_change_request', { p_agree: true, p_comment: c || null }, t('agreed')) },
    disagree: { title: t('disagreeTitle'), confirm: t('disagree'), required: true, variant: 'destructive', run: (c) => act('agree_change_request', { p_agree: false, p_comment: c }, t('disagreed')) },
    approve: { title: t('approveTitle'), confirm: t('approve'), required: false, variant: 'success', run: (c) => act('decide_change_request', { p_approve: true, p_comment: c || null }, t('approved')) },
    reject: { title: t('rejectTitle'), confirm: t('reject'), required: true, variant: 'destructive', run: (c) => act('decide_change_request', { p_approve: false, p_comment: c }, t('rejected')) },
    implement: { title: t('implementTitle'), confirm: t('implement'), required: false, variant: 'success', run: (c) => act('implement_change_request', { p_note: c || null }, t('implemented')) },
    withdraw: { title: t('withdrawTitle'), confirm: t('withdraw'), required: false, variant: 'warning', run: (c) => act('withdraw_change_request', { p_comment: c || null }, t('withdrawn')) },
  };
  const pr = prompt ? prompts[prompt] : null;

  return (
    <>
      <Dialog open={!pr} onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex flex-wrap items-center gap-2">{cr.cr_no} — {cr.title}</DialogTitle>
            <DialogDescription asChild>
              <div className="flex flex-wrap items-center gap-2">
                <StatusChip list={CR_STATUSES} value={cr.status} /><StatusChip list={CR_TYPES} value={cr.change_type} /><PriorityChip value={cr.priority} />
              </div>
            </DialogDescription>
          </DialogHeader>

          <section className="space-y-3 text-sm">
            <div><div className="text-xs font-medium text-muted-foreground">{t('field.description')}</div><p className="whitespace-pre-wrap">{cr.description}</p></div>
            <div><div className="text-xs font-medium text-muted-foreground">{t('field.reason')}</div><p className="whitespace-pre-wrap">{cr.reason}</p></div>
            {cr.impact_summary && !assessing && (
              <div className="rounded-md border bg-muted/40 p-3">
                <div className="mb-1 flex flex-wrap gap-x-4 text-xs font-medium text-muted-foreground">
                  <span>{t('field.effort')}: {cr.impact_md == null ? '–' : t('md', { n: cr.impact_md })}</span>
                  <span>{t('field.newTarget')}: {cr.impact_target ? `${fmtDate(cr.impact_target)}${targetMoves ? ` (${t('from', { date: fmtDate(data.project.target_date) })})` : ''}` : t('unchanged')}</span>
                </div>
                <p className="whitespace-pre-wrap">{cr.impact_summary}</p>
              </div>
            )}
          </section>

          {assessing ? (
            <section className="space-y-3 rounded-md border p-3">
              <div className="grid grid-cols-2 gap-3">
                <TextField label={t('field.effortMd')} type="number" value={impact.md} onChange={(v) => setImpact({ ...impact, md: v })} helperText={t('effortHelp')} />
                <DateField label={t('field.newTarget')} value={impact.target} onChange={(v) => setImpact({ ...impact, target: v })} helperText={t('targetHelp')} />
              </div>
              <TextField label={t('field.impactSummary')} required multiline rows={3} value={impact.summary} onChange={(v) => setImpact({ ...impact, summary: v })} placeholder={t('impactPlaceholder')} />
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setAssessing(false)}>{t('cancel')}</Button>
                <Button disabled={!impact.summary.trim()} onClick={() => act('assess_change_request', {
                  p_impact_md: impact.md === '' ? null : Number(impact.md), p_impact_target: impact.target || null, p_impact_summary: impact.summary,
                }, t('assessed'))}>{t('sendAssessment')}</Button>
              </div>
            </section>
          ) : null}

          <ol className="space-y-1.5 border-t pt-3">
            {step(t('step.raised'), cr.requested_by, cr.requested_at)}
            {step(t('step.assessed'), cr.assessed_by, cr.assessed_at)}
            {step(t('step.agreed'), cr.agreed_by, cr.agreed_at)}
            {cr.decided_at && (
              <li className="flex gap-2 text-sm">
                {cr.status === 'rejected' ? <X className="mt-0.5 size-4 shrink-0 text-destructive" /> : <Check className="mt-0.5 size-4 shrink-0 text-[#00c875]" />}
                <div><span className="font-medium">{cr.status === 'rejected' ? t('step.rejected') : t('step.approved')}</span> <span className="text-xs text-muted-foreground">{profileName(cr.decided_by)} · {fmtDateTime(cr.decided_at)}</span></div>
              </li>
            )}
            {step(t('step.implemented'), null, cr.implemented_at, cr.implemented_note && <div className="text-xs whitespace-pre-wrap">{cr.implemented_note}</div>)}
            {cr.decision_comment && <li className="pl-6 text-xs whitespace-pre-wrap text-muted-foreground italic">“{cr.decision_comment}”</li>}
            {!cr.decided_at && OPEN.includes(cr.status) && <li className="pl-6 text-xs text-muted-foreground">{t(`next.${cr.status as 'submitted' | 'assessed' | 'agreed' | 'approved'}`)}</li>}
          </ol>

          {cr.status === 'approved' && targetMoves && perm.manage && (
            <p className="flex items-start gap-2 rounded-md bg-amber-50 p-2 text-xs text-amber-800">
              <CalendarClock className="size-4 shrink-0" />
              {revision ? t('revisionLinked', { status: revision.status }) : otherPending ? t('revisionBusy') : t('revisionHint', { date: fmtDate(cr.impact_target) })}
            </p>
          )}

          <DialogFooter className="flex-wrap gap-2">
            {can.withdraw && <Button variant="ghost" onClick={() => setPrompt('withdraw')}><Undo2 /> {t('withdraw')}</Button>}
            {can.assess && !assessing && <Button variant={cr.status === 'submitted' ? 'default' : 'outline'} onClick={() => setAssessing(true)}>{cr.status === 'submitted' ? t('assess') : t('reassess')}</Button>}
            {can.agree && <><Button variant="outline" onClick={() => setPrompt('disagree')}><ThumbsDown /> {t('disagree')}</Button><ActionButton tone="success" onClick={() => setPrompt('agree')}><ThumbsUp /> {t('agree')}</ActionButton></>}
            {can.decide && <><Button variant="outline" className="text-destructive" onClick={() => setPrompt('reject')}>{t('reject')}</Button><ActionButton tone="success" onClick={() => setPrompt('approve')}><Check /> {t('approve')}</ActionButton></>}
            {can.implement && targetMoves && !revision && !otherPending && <Button variant="outline" onClick={() => router.push(`/projects/${data.project.id}?tab=baseline&cr=${cr.id}`)}><CalendarClock /> {t('toBaseline')}</Button>}
            {can.implement && <ActionButton tone="success" onClick={() => setPrompt('implement')}><Hammer /> {t('implement')}</ActionButton>}
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {pr && (
        <CommentDialog open title={pr.title} description={`${cr.cr_no} — ${cr.title}`} confirmLabel={pr.confirm} required={pr.required} variant={pr.variant}
          onClose={() => setPrompt(null)} onConfirm={pr.run} />
      )}
    </>
  );
}
