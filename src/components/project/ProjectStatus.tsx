'use client';

import { Ban, Check, ChevronDown, CircleCheckBig, RotateCcw, TriangleAlert, X } from 'lucide-react';
import { useState } from 'react';
import { dispatchEmails, useApp } from '@/components/AppProvider';
import { ActionButton, CommentDialog, StatusChip } from '@/components/common';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { PROJECT_STATUSES } from '@/lib/constants';
import { errMsg } from '@/lib/format';
import { dbClient } from '@/lib/db/client';
import { cn } from '@/lib/utils';
import type { TabProps } from './types';

const CLOSED = ['completed', 'cancelled'];
// Statuses a leader sets by hand; Delayed / At Risk are derived by the system, Done / Cancelled go through their own dialogs
const MANUAL = PROJECT_STATUSES.filter((s) => ['planning', 'in_progress', 'waiting', 'on_hold'].includes(s.value));

type Check = { label: string; ok: boolean; detail?: string; blocking: boolean };

/** What stops (or should give pause before) completing the project — mirrors the projects.beforeUpdate hook */
export function closeChecks({ data, perm }: Pick<TabProps, 'data' | 'perm'>): Check[] {
  const p = data.project;
  const openActs = data.activities.filter((a) => !CLOSED.includes(a.status));
  const hasEvidence = (id: number) => data.evidence.some((e) => e.requirement_id === id && e.verification_status !== 'rejected');
  const missing = data.requirements.filter((r) => r.is_mandatory && !hasEvidence(r.id));
  const missingProject = missing.filter((r) => r.entity_type === 'project');
  const openTasks = data.tasks.filter((t) => !CLOSED.includes(t.status));
  const openBugs = Math.max(0, p.open_bugs - p.critical_bugs);
  const list = (names: string[]) => names.slice(0, 5).join(', ') + (names.length > 5 ? ` +${names.length - 5} more` : '');
  return [
    { label: 'All activities done', ok: openActs.length === 0, blocking: true, detail: openActs.length ? `Still open: ${list(openActs.map((a) => a.name))}` : undefined },
    { label: 'Mandatory evidence attached', ok: missing.length === 0, blocking: missingProject.length > 0, detail: missing.length ? `Missing: ${list(missing.map((r) => r.name))}` : undefined },
    { label: 'No open critical bugs', ok: p.critical_bugs === 0, blocking: true, detail: p.critical_bugs ? `${p.critical_bugs} critical bug(s) open` : undefined },
    ...(perm.internal ? [
      { label: 'All internal tasks closed', ok: openTasks.length === 0, blocking: false, detail: openTasks.length ? `${openTasks.length} task(s) still open` : undefined },
      { label: 'No other open bugs', ok: openBugs === 0, blocking: false, detail: openBugs ? `${openBugs} bug(s) still open` : undefined },
    ] : []),
  ];
}

async function setStatus(id: number, patch: Record<string, unknown>) {
  const { error } = await dbClient().from('projects').update(patch).eq('id', id);
  if (error) throw new Error(errMsg(error));
  dispatchEmails();
}

export function CloseProjectDialog({ data, perm, reload, onClose }: Pick<TabProps, 'data' | 'perm' | 'reload'> & { onClose: () => void }) {
  const { notify } = useApp();
  const [busy, setBusy] = useState(false);
  const checks = closeChecks({ data, perm });
  const blocked = checks.some((c) => !c.ok && c.blocking);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Close project</DialogTitle>
          <DialogDescription>{data.project.project_code} will be marked Done and stop being tracked for delays and alerts.</DialogDescription>
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
          ? <p className="text-sm text-destructive">Fix the red items before closing.</p>
          : checks.some((c) => !c.ok) && <p className="text-sm text-amber-700">The yellow items do not block closing, but check them first.</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Not yet</Button>
          <ActionButton tone="success" disabled={blocked || busy} onClick={async () => {
            setBusy(true);
            try {
              await setStatus(data.project.id, { status: 'completed' });
              notify('Project closed');
              onClose();
              await reload();
            } catch (e) {
              notify(errMsg(e), 'error');
            } finally {
              setBusy(false);
            }
          }}><CircleCheckBig /> Close project</ActionButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Status chip in the project header; a menu to change it for whoever can manage the project */
export function ProjectStatusMenu({ data, perm, reload }: Pick<TabProps, 'data' | 'perm' | 'reload'>) {
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
          <button type="button" className="group inline-flex items-center gap-0.5 rounded outline-none focus-visible:ring-2 focus-visible:ring-ring" title="Change status">
            <StatusChip list={PROJECT_STATUSES} value={p.status} className="group-hover:brightness-95" />
            <ChevronDown className="size-4 text-muted-foreground group-hover:text-foreground" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-56">
          {closed ? (
            <DropdownMenuItem onSelect={() => change({ status: 'in_progress' }, 'Project reopened')}><RotateCcw /> Reopen project</DropdownMenuItem>
          ) : (
            <>
              <DropdownMenuLabel className="text-xs text-muted-foreground">Set status</DropdownMenuLabel>
              {MANUAL.map((s) => (
                <DropdownMenuItem key={s.value} disabled={s.value === p.status} onSelect={() => change({ status: s.value }, `Status: ${s.label}`)}>
                  <span className="size-3 rounded-sm" style={{ background: s.color }} /> {s.label}
                  {s.value === p.status && <Check className="ml-auto" />}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => setDialog('close')}><CircleCheckBig className="text-[#00c875]" /> Close project (Done)…</DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onSelect={() => setDialog('cancel')}><Ban /> Cancel project…</DropdownMenuItem>
            </>
          )}
          <DropdownMenuSeparator />
          <p className="px-1.5 py-1 text-xs text-muted-foreground">Delayed / At Risk are set automatically from the plan.</p>
        </DropdownMenuContent>
      </DropdownMenu>
      {dialog === 'close' && <CloseProjectDialog data={data} perm={perm} reload={reload} onClose={() => setDialog(null)} />}
      <CommentDialog open={dialog === 'cancel'} title="Cancel project" required variant="destructive" confirmLabel="Cancel project"
        description={`${p.project_code} will stop and be closed as Cancelled. The reason is added to the project remark.`}
        onClose={() => setDialog(null)}
        onConfirm={async (reason) => {
          setDialog(null);
          await change({ status: 'cancelled', remark: [p.remark, `Cancelled: ${reason.trim()}`].filter(Boolean).join('\n') }, 'Project cancelled');
        }} />
    </>
  );
}

/** Header button; solid green once every activity is closed */
export function CloseProjectButton({ data, perm, reload }: Pick<TabProps, 'data' | 'perm' | 'reload'>) {
  const [open, setOpen] = useState(false);
  if (!perm.manage || CLOSED.includes(data.project.status)) return null;
  const ready = data.activities.length > 0 && data.activities.every((a) => CLOSED.includes(a.status));
  return (
    <>
      {ready
        ? <ActionButton tone="success" onClick={() => setOpen(true)}><CircleCheckBig /> Close Project</ActionButton>
        : <Button variant="outline" onClick={() => setOpen(true)}><CircleCheckBig /> Close Project</Button>}
      {open && <CloseProjectDialog data={data} perm={perm} reload={reload} onClose={() => setOpen(false)} />}
    </>
  );
}

/** Overview banner once every activity is closed but the project is still open */
export function ReadyToCloseBanner({ data, perm, reload }: Pick<TabProps, 'data' | 'perm' | 'reload'>) {
  const [open, setOpen] = useState(false);
  const p = data.project;
  if (!perm.manage || CLOSED.includes(p.status) || !data.activities.length || data.activities.some((a) => !CLOSED.includes(a.status))) return null;
  return (
    <>
      <Alert className="mb-4 border-[#00c875] bg-[#00c875]/5">
        <CircleCheckBig className="text-[#00c875]" />
        <AlertTitle>All activities are done</AlertTitle>
        <AlertDescription className="flex flex-wrap items-center gap-3">
          <span>Check the closing list and mark the project Done.</span>
          <ActionButton tone="success" size="sm" onClick={() => setOpen(true)}><CircleCheckBig /> Close project</ActionButton>
        </AlertDescription>
      </Alert>
      {open && <CloseProjectDialog data={data} perm={perm} reload={reload} onClose={() => setOpen(false)} />}
    </>
  );
}
