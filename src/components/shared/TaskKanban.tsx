'use client';

import { GitBranch } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useOptions } from '@/i18n/useOptions';
import { PRIORITIES, TASK_STATUSES, TASK_TYPES } from '@/lib/constants';
import { dbClient } from '@/lib/db/client';
import { errMsg } from '@/lib/format';
import type { InternalTask } from '@/lib/types';
import { cn } from '@/lib/utils';
import { useApp } from '@/providers/AppProvider';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { TextField } from './form';
import KanbanBoard, { KanbanDue, KanbanProgress, KanbanTag } from './KanbanBoard';
import { Person } from './labels';

/**
 * Internal tasks as a board. Dropping a card changes the task status on the server, where the usual
 * rules apply (permissions, mandatory evidence before Done, progress roll-up to the activity).
 */
/**
 * Order inside a column: the team's arrangement (board_rank), else by due date. Both share one
 * scale — days since epoch, ties broken by id — so a dropped card's midpoint rank lands
 * correctly between arranged and never-arranged neighbours.
 */
// a date-only string parses as UTC, so every time zone computes the same default
const rankOf = (t: InternalTask) => t.board_rank ?? Date.parse(String(t.due_date).slice(0, 10)) / 86_400_000 + t.id * 1e-6;

export default function TaskKanban({ tasks, canEdit, onOpen, onChanged, subtitle }: {
  tasks: InternalTask[];
  canEdit: (t: InternalTask) => boolean;
  onOpen: (t: InternalTask) => void;
  onChanged: () => Promise<void> | void;
  /** second line on the card, e.g. activity or project name */
  subtitle?: (t: InternalTask) => React.ReactNode;
}) {
  const tk = useTranslations('kanban.task');
  const { label: optLabel, options } = useOptions();
  const { profileName, notify } = useApp();
  // Cancelled is only shown when something is in it
  const columns = options(TASK_STATUSES).filter((c) => c.value !== 'cancelled' || tasks.some((t) => t.status === 'cancelled'));
  const subCount = (t: InternalTask) => tasks.filter((x) => x.parent_task_id === t.id).length;
  // dropping into Done asks for the man-days the task took (a parent task sums its sub-tasks)
  const [ask, setAsk] = useState<{ task: InternalTask; resolve: (md: number | null) => void } | null>(null);
  const askEffort = (task: InternalTask) => new Promise<number | null>((resolve) => setAsk({ task, resolve }));

  const move = async (t: InternalTask, status: string, rank?: number) => {
    let actualMd: number | undefined;
    if (status === 'completed' && t.status !== 'completed' && !subCount(t)) {
      const md = await askEffort(t);
      if (md === null) return false;
      actualMd = md;
    }
    const patch = { ...(status !== t.status && { status }), ...(rank !== undefined && { board_rank: rank }), ...(actualMd !== undefined && { actual_md: actualMd }) };
    const { data, error } = await dbClient().from('internal_tasks').update(patch).eq('id', t.id).select('status').single();
    if (error) {
      notify(errMsg(error), 'error');
    } else if (data.status !== status) {
      notify(tk('autoMoved', { no: t.task_no ?? '', status: optLabel(TASK_STATUSES, data.status) }), 'info');
    }
    await onChanged();
    // false: no "Moved … Undo" toast when the task did not land where it was dropped
    return !error && data.status === status;
  };

  return (
    <>
    {ask && <EffortPrompt task={ask.task} onDone={(md) => { ask.resolve(md); setAsk(null); }} />}
    <KanbanBoard
      columns={columns}
      items={tasks}
      rankOf={rankOf}
      canDrag={canEdit}
      onOpen={onOpen}
      onMove={move}
      emptyText={tk('empty')}
      renderCard={(t) => {
        const subs = subCount(t);
        const open = !['completed', 'cancelled'].includes(t.status);
        return (
          <div className="space-y-2.5">
            <div className="space-y-1 pr-5">
              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <span className="font-mono">{t.task_no}</span>
                <span className="rounded bg-muted px-1.5 py-px font-medium">{optLabel(TASK_TYPES, t.task_type)}</span>
              </div>
              <div className={cn('line-clamp-2 leading-snug font-medium', !open && 'text-muted-foreground')}>{t.name}</div>
              {subtitle && <div className="truncate text-xs text-muted-foreground">{subtitle(t)}</div>}
            </div>
            {open && t.status !== 'todo' && <KanbanProgress value={t.progress} />}
            {/* tags wrap to a second line on narrow cards; the avatar stays pinned right */}
            <div className="flex items-end gap-1.5">
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
                <KanbanTag list={PRIORITIES} value={t.priority} />
                <KanbanDue date={t.due_date} open={open} />
                {subs > 0 && (
                  <span className="flex items-center gap-0.5 text-[11px] text-muted-foreground" title={tk('subTasks', { count: subs })}><GitBranch className="size-3" />{subs}</span>
                )}
              </div>
              <span className="shrink-0"><Person name={profileName(t.owner_id)} showName={false} size={22} /></span>
            </div>
          </div>
        );
      }}
    />
    </>
  );
}

function EffortPrompt({ task, onDone }: { task: InternalTask; onDone: (md: number | null) => void }) {
  const tk = useTranslations('kanban.task');
  const [md, setMd] = useState(task.actual_md ? String(task.actual_md) : '');
  const ok = Number(md) > 0 && Number(md) <= 999;
  return (
    <Dialog open onOpenChange={(o) => !o && onDone(null)}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{tk('effortTitle')}</DialogTitle>
          <DialogDescription>{tk('effortText', { no: task.task_no ?? '', name: task.name })}</DialogDescription>
        </DialogHeader>
        <form onSubmit={(e) => { e.preventDefault(); if (ok) onDone(Number(md)); }}>
          <TextField type="number" label={tk('effortLabel')} required value={md} onChange={setMd} helperText={tk('effortHelp')} />
          <DialogFooter className="mt-4">
            <Button type="button" variant="outline" onClick={() => onDone(null)}>{tk('effortCancel')}</Button>
            <Button type="submit" disabled={!ok}>{tk('effortConfirm')}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
