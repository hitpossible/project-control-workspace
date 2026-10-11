'use client';

import { CalendarClock, GitBranch } from 'lucide-react';
import { TASK_STATUSES, TASK_TYPES, optLabel } from '@/lib/constants';
import { dbClient } from '@/lib/db/client';
import { errMsg, fmtDate, isOverdue } from '@/lib/format';
import type { InternalTask } from '@/lib/types';
import { cn } from '@/lib/utils';
import { useApp } from './AppProvider';
import KanbanBoard from './KanbanBoard';
import { Person, PriorityChip, ProgressBar } from './common';

/**
 * Internal tasks as a board. Dropping a card changes the task status on the server, where the usual
 * rules apply (permissions, mandatory evidence before Done, progress roll-up to the activity).
 */
export default function TaskKanban({ tasks, canEdit, onOpen, onChanged, subtitle }: {
  tasks: InternalTask[];
  canEdit: (t: InternalTask) => boolean;
  onOpen: (t: InternalTask) => void;
  onChanged: () => Promise<void> | void;
  /** second line on the card, e.g. activity or project name */
  subtitle?: (t: InternalTask) => React.ReactNode;
}) {
  const { profileName, notify } = useApp();
  // Cancelled is only shown when something is in it
  const columns = TASK_STATUSES.filter((c) => c.value !== 'cancelled' || tasks.some((t) => t.status === 'cancelled'));
  const subCount = (t: InternalTask) => tasks.filter((x) => x.parent_task_id === t.id).length;

  const move = async (t: InternalTask, status: string) => {
    const { data, error } = await dbClient().from('internal_tasks').update({ status }).eq('id', t.id).select('status').single();
    if (error) {
      notify(errMsg(error), 'error');
    } else if (data.status !== status) {
      notify(`${t.task_no} moved to "${optLabel(TASK_STATUSES, data.status)}" (progress is 100% / workflow rule)`, 'info');
    }
    await onChanged();
  };

  return (
    <KanbanBoard
      columns={columns}
      items={tasks}
      canDrag={canEdit}
      onOpen={onOpen}
      onMove={move}
      emptyText="No tasks"
      renderCard={(t) => {
        const od = isOverdue(t.due_date, t.status);
        const subs = subCount(t);
        return (
          <div className="space-y-2">
            <div>
              <div className="leading-snug font-medium">{t.name}</div>
              <div className="mt-0.5 flex items-center gap-1 truncate text-xs text-muted-foreground">
                <span>{t.task_no}</span>
                <span>·</span>
                <span>{optLabel(TASK_TYPES, t.task_type)}</span>
                {subtitle && <><span>·</span><span className="truncate">{subtitle(t)}</span></>}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-20"><PriorityChip value={t.priority} fullWidth /></div>
              <span className={cn('flex items-center gap-1 text-xs whitespace-nowrap', od ? 'font-semibold text-destructive' : 'text-muted-foreground')}>
                <CalendarClock className="size-3.5" />{od && '⚠ '}{fmtDate(t.due_date)}
              </span>
              {subs > 0 && (
                <span className="flex items-center gap-0.5 text-xs text-muted-foreground" title={`${subs} sub-task(s)`}><GitBranch className="size-3.5" />{subs}</span>
              )}
              <span className="ml-auto"><Person name={profileName(t.owner_id)} showName={false} size={24} /></span>
            </div>
            {t.status !== 'todo' && <ProgressBar value={t.progress} className="min-w-0" />}
          </div>
        );
      }}
    />
  );
}
