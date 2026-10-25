import type { GanttRow } from './GanttChart';
import { entityKey } from '@/lib/ids';
import type { OptionLabels } from '@/i18n/useOptions';
import { ACTIVITY_STATUSES, TASK_STATUSES, optColor } from '@/lib/constants';
import { isOverdue } from '@/lib/format';
import type { Activity, InternalTask } from '@/lib/types';

export function buildGanttRows(opts: {
  activities: Activity[];
  tasks: InternalTask[];
  /** entityKey() of expanded rows */
  expanded: Set<string>;
  name: (id: number | null) => string;
  taskFilter?: (t: InternalTask) => boolean;
  showTasks: boolean;
  /** status labels in the UI language (useOptions().label) */
  optLabel: OptionLabels['label'];
}): GanttRow[] {
  const { activities, tasks, expanded, name, taskFilter, showTasks, optLabel } = opts;
  const rows: GanttRow[] = [];
  const visibleTasks = taskFilter ? tasks.filter(taskFilter) : tasks;

  const taskRow = (t: InternalTask, level: number): GanttRow => {
    const children = visibleTasks.filter((c) => c.parent_task_id === t.id);
    return {
      id: entityKey('task', t.id), entityId: t.id, level, label: t.name, code: t.task_no, pic: name(t.owner_id),
      planStart: t.planned_start ?? t.due_date, planFinish: t.due_date, actualStart: t.actual_start, actualFinish: t.actual_finish,
      progress: Number(t.progress), status: t.status, statusColor: optColor(TASK_STATUSES, t.status), statusLabel: optLabel(TASK_STATUSES, t.status),
      overdue: isOverdue(t.due_date, t.status), hasChildren: children.length > 0, expanded: expanded.has(entityKey('task', t.id)), recovery: t.recovery_action,
    };
  };

  for (const a of activities) {
    const top = visibleTasks.filter((t) => t.activity_id === a.id && !t.parent_task_id);
    const overdue = isOverdue(a.plan_finish, a.status);
    rows.push({
      id: entityKey('activity', a.id), entityId: a.id, level: 0, label: a.name, pic: a.pic_user_id ? name(a.pic_user_id) : a.pic_label ?? '-',
      planStart: a.plan_start, planFinish: a.plan_finish, actualStart: a.actual_start, actualFinish: a.actual_finish,
      forecastFinish: a.forecast_finish, progress: Number(a.progress), status: a.status,
      statusColor: optColor(ACTIVITY_STATUSES, a.status), statusLabel: optLabel(ACTIVITY_STATUSES, a.status),
      milestone: a.is_milestone && !top.length, overdue, risk: ['delayed', 'at_risk'].includes(a.status),
      hasChildren: showTasks && top.length > 0, expanded: expanded.has(entityKey('activity', a.id)), recovery: a.recovery_plan,
    });
    if (!showTasks || !expanded.has(entityKey('activity', a.id))) continue;
    for (const t of top) {
      const r = taskRow(t, 1);
      rows.push(r);
      if (expanded.has(entityKey('task', t.id))) visibleTasks.filter((c) => c.parent_task_id === t.id).forEach((c) => rows.push(taskRow(c, 2)));
    }
  }
  return rows;
}

/** Gantt dependency arrows (task → task) */
export const ganttDeps = (deps: { predecessor_id: number; successor_id: number }[]) =>
  deps.map((d) => ({ from: entityKey('task', d.predecessor_id), to: entityKey('task', d.successor_id) }));

/** every row key, for "Expand all" */
export const allGanttKeys = (activities: { id: number }[], tasks: { id: number }[]) =>
  new Set([...activities.map((a) => entityKey('activity', a.id)), ...tasks.map((t) => entityKey('task', t.id))]);
