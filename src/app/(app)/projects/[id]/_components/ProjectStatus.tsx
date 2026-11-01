'use client';

import { Ban, Check, ChevronDown, CircleCheckBig, Hourglass, RotateCcw, TriangleAlert, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { dispatchEmails, useApp } from '@/providers/AppProvider';
import { ActionButton, CommentDialog } from '@/components/shared/form';
import { StatusChip } from '@/components/shared/labels';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useOptions } from '@/i18n/useOptions';
import { PROJECT_STATUSES } from '@/lib/constants';
import { errMsg } from '@/lib/format';
import { dbClient } from '@/lib/db/client';
import { cn } from '@/lib/utils';
import { SendForAcceptance, pendingClosure } from './ClosureSignoff';
import type { TabProps } from './types';

const CLOSED = ['completed', 'cancelled'];
// Statuses a leader sets by hand; Delayed / At Risk are derived by the system, Done / Cancelled go through their own dialogs
const MANUAL = PROJECT_STATUSES.filter((s) => ['planning', 'in_progress', 'waiting', 'on_hold'].includes(s.value));

type Check = { label: string; ok: boolean; detail?: string; blocking: boolean };
type CloseT = ReturnType<typeof useTranslations<'project.close'>>;

/** What stops (or should give pause before) completing the project — mirrors the projects.beforeUpdate hook */
export function closeChecks({ data, perm }: Pick<TabProps, 'data' | 'perm'>, t: CloseT): Check[] {
  const p = data.project;
  const openActs = data.activities.filter((a) => !CLOSED.includes(a.status));
  const hasEvidence = (id: number) => data.evidence.some((e) => e.requirement_id === id && e.verification_status !== 'rejected');
  const missing = data.requirements.filter((r) => r.is_mandatory && !hasEvidence(r.id));
  const missingProject = missing.filter((r) => r.entity_type === 'project');
  const openTasks = data.tasks.filter((t) => !CLOSED.includes(t.status));
  const openBugs = Math.max(0, p.open_bugs - p.critical_bugs);
  const list = (names: string[]) => names.slice(0, 5).join(', ') + (names.length > 5 ? ` ${t('more', { count: names.length - 5 })}` : '');
  return [
    { label: t('check.activities'), ok: openActs.length === 0, blocking: true, detail: openActs.length ? t('check.stillOpen', { items: list(openActs.map((a) => a.name)) }) : undefined },
    { label: t('check.evidence'), ok: missing.length === 0, blocking: missingProject.length > 0, detail: missing.length ? t('check.missing', { items: list(missing.map((r) => r.name)) }) : undefined },
    { label: t('check.criticalBugs'), ok: p.critical_bugs === 0, blocking: true, detail: p.critical_bugs ? t('check.criticalOpen', { count: p.critical_bugs }) : undefined },
    ...(perm.internal ? [
      { label: t('check.tasks'), ok: openTasks.length === 0, blocking: false, detail: openTasks.length ? t('check.tasksOpen', { count: openTasks.length }) : undefined },
      { label: t('check.otherBugs'), ok: openBugs === 0, blocking: false, detail: openBugs ? t('check.bugsOpen', { count: openBugs }) : undefined },
    ] : []),
  ];
}

async function setStatus(id: number, patch: Record<string, unknown>) {
  const { error } = await dbClient().from('projects').update(patch).eq('id', id);
  if (error) throw new Error(errMsg(error));
  dispatchEmails();
}

export function CloseProjectDialog({ data, perm, reload, onClose }: Pick<TabProps, 'data' | 'perm' | 'reload'> & { onClose: () => void }) {
  const t = useTranslations('project.close');
  const { notify } = useApp();
  const [busy, setBusy] = useState(false);
  const checks = closeChecks({ data, perm }, t);
  const blocked = checks.some((c) => !c.ok && c.blocking);
  // a project from a request is completed by the requestor's acceptance (ClosureSignoff)
  const viaAcceptance = !!data.project.request_id;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{viaAcceptance ? t('acceptanceTitle') : t('title')}</DialogTitle>
          <DialogDescription>{viaAcceptance ? t('acceptanceDescription', { code: data.project.project_code }) : t('description', { code: data.project.project_code })}</DialogDescription>
        </DialogHeader>
        <ul className="flex flex-col gap-2">
          {checks.map((c) => (
            <li key={c.label} className="flex gap-2 text-sm">
              <span className={cn('mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-white',
                c.ok ? 'bg-[#00c875]' : c.blocking ? 'bg-destructive' : 'bg-amber-500')}>
                {c.ok ? <Check className="size-3.5" /> : c.blocking ? <X className="size-3.5" /> : <TriangleAlert className="size-3" />}
              </span>
              <div>
                <div className="font-medium">{c.label}</div>
                {c.detail && <div className="text-xs text-muted-foreground">{c.detail}</div>}
              </div>
            </li>
          ))}
        </ul>
        {blocked
          ? <p className="text-sm text-destructive">{t('blocked')}</p>
          : checks.some((c) => !c.ok) && <p className="text-sm text-amber-700">{t('warnings')}</p>}
        {viaAcceptance ? <SendForAcceptance data={data} reload={reload} blocked={blocked} onDone={onClose} /> : <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('notYet')}</Button>
          <ActionButton tone="success" disabled={blocked || busy} onClick={async () => {
            setBusy(true);
            try {
              await setStatus(data.project.id, { status: 'completed' });
              notify(t('closed'));
              onClose();
              await reload();
            } catch (e) {
              notify(errMsg(e), 'error');
            } finally {
              setBusy(false);
            }
          }}><CircleCheckBig /> {t('title')}</ActionButton>
        </DialogFooter>}
      </DialogContent>
    </Dialog>
  );
}

/** Status chip in the project header; a menu to change it for whoever can manage the project */
export function ProjectStatusMenu({ data, perm, reload }: Pick<TabProps, 'data' | 'perm' | 'reload'>) {
  const t = useTranslations('project.status');
  const { label } = useOptions();
  const { notify } = useApp();
  const p = data.project;
  const [dialog, setDialog] = useState<'close' | 'cancel' | null>(null);
  if (!perm.manage) return <StatusChip list={PROJECT_STATUSES} value={p.status} />;

  const change = async (patch: Record<string, unknown>, msg: string) => {
    try {
      await setStatus(p.id, patch);
      notify(msg);
      await reload();
    } catch (e) {
      notify(errMsg(e), 'error');
    }
  };
  const closed = CLOSED.includes(p.status);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className="group inline-flex items-center gap-0.5 rounded outline-none focus-visible:ring-2 focus-visible:ring-ring" title={t('change')}>
            <StatusChip list={PROJECT_STATUSES} value={p.status} className="group-hover:brightness-95" />
            <ChevronDown className="size-4 text-muted-foreground group-hover:text-foreground" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-56">
          {closed ? (
            <DropdownMenuItem onSelect={() => change({ status: 'in_progress' }, t('reopened'))}><RotateCcw /> {t('reopen')}</DropdownMenuItem>
          ) : (
            <>
              <DropdownMenuLabel className="text-xs text-muted-foreground">{t('set')}</DropdownMenuLabel>
              {MANUAL.map((s) => (
                <DropdownMenuItem key={s.value} disabled={s.value === p.status} onSelect={() => change({ status: s.value }, t('changed', { status: label(PROJECT_STATUSES, s.value) }))}>
                  <span className="size-3 rounded-sm" style={{ background: s.color }} /> {label(PROJECT_STATUSES, s.value)}
                  {s.value === p.status && <Check className="ml-auto" />}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled={!!pendingClosure(data)} onSelect={() => setDialog('close')}><CircleCheckBig className="text-[#00c875]" /> {t('closeDone')}</DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onSelect={() => setDialog('cancel')}><Ban /> {t('cancelEllipsis')}</DropdownMenuItem>
            </>
          )}
          <DropdownMenuSeparator />
          <p className="px-1.5 py-1 text-xs text-muted-foreground">{t('autoNote')}</p>
        </DropdownMenuContent>
      </DropdownMenu>
      {dialog === 'close' && <CloseProjectDialog data={data} perm={perm} reload={reload} onClose={() => setDialog(null)} />}
      <CommentDialog open={dialog === 'cancel'} title={t('cancel')} required variant="destructive" confirmLabel={t('cancel')}
        description={t('cancelDescription', { code: p.project_code })}
        onClose={() => setDialog(null)}
        onConfirm={async (reason) => {
          setDialog(null);
          await change({ status: 'cancelled', remark: [p.remark, t('cancelRemark', { reason: reason.trim() })].filter(Boolean).join('\n') }, t('cancelled'));
        }} />
    </>
  );
}

/** Header button; solid green once every activity is closed */
export function CloseProjectButton({ data, perm, reload }: Pick<TabProps, 'data' | 'perm' | 'reload'>) {
  const t = useTranslations('project.close');
  const [open, setOpen] = useState(false);
  if (!perm.manage || CLOSED.includes(data.project.status)) return null;
  if (pendingClosure(data)) return <Button variant="outline" disabled><Hourglass /> {t('waiting')}</Button>;
  const ready = data.activities.length > 0 && data.activities.every((a) => CLOSED.includes(a.status));
  return (
    <>
      {ready
        ? <ActionButton tone="success" onClick={() => setOpen(true)}><CircleCheckBig /> {t('button')}</ActionButton>
        : <Button variant="outline" onClick={() => setOpen(true)}><CircleCheckBig /> {t('button')}</Button>}
      {open && <CloseProjectDialog data={data} perm={perm} reload={reload} onClose={() => setOpen(false)} />}
    </>
  );
}

/** Overview banner once every activity is closed but the project is still open */
export function ReadyToCloseBanner({ data, perm, reload }: Pick<TabProps, 'data' | 'perm' | 'reload'>) {
  const t = useTranslations('project.close');
  const [open, setOpen] = useState(false);
  const p = data.project;
  if (!perm.manage || CLOSED.includes(p.status) || pendingClosure(data) || !data.activities.length || data.activities.some((a) => !CLOSED.includes(a.status))) return null;
  return (
    <>
      <Alert className="mb-4 border-[#00c875] bg-[#00c875]/5">
        <CircleCheckBig className="text-[#00c875]" />
        <AlertTitle>{t('bannerTitle')}</AlertTitle>
        <AlertDescription className="flex flex-wrap items-center gap-3">
          <span>{p.request_id ? t('bannerTextAcceptance') : t('bannerText')}</span>
          <ActionButton tone="success" size="sm" onClick={() => setOpen(true)}><CircleCheckBig /> {p.request_id ? t('acceptanceTitle') : t('title')}</ActionButton>
        </AlertDescription>
      </Alert>
      {open && <CloseProjectDialog data={data} perm={perm} reload={reload} onClose={() => setOpen(false)} />}
    </>
  );
}
