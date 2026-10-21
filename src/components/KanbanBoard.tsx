'use client';

import {
  DndContext, DragOverlay, MouseSensor, TouchSensor, pointerWithin, rectIntersection, useDraggable, useDroppable, useSensor, useSensors,
  type Announcements, type CollisionDetection, type DragEndEvent,
} from '@dnd-kit/core';
import dayjs from 'dayjs';
import { AlertTriangle, CalendarClock, Check, MoreHorizontal } from 'lucide-react';
import { useState } from 'react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { optColor, optLabel, type Opt } from '@/lib/constants';
import { cn } from '@/lib/utils';

type Item = { id: number; status: string };

/**
 * Generic status board built on @dnd-kit.
 *   mouse: drag after moving 6px (a plain click opens the card)
 *   touch: long-press 200 ms to drag, so normal swipes still scroll
 *   menu:  the ⋯ button on a card moves it to any column without dragging
 *   keyboard: focus a card, Alt + ← / → moves it one column, Enter opens it
 * `onMove` persists the new status; the board re-renders from the reloaded data.
 */
export default function KanbanBoard<T extends Item>({
  columns, items, renderCard, onMove, canDrag = () => true, onOpen, emptyText = 'No items',
}: {
  columns: Opt[];
  items: T[];
  renderCard: (item: T) => React.ReactNode;
  onMove?: (item: T, status: string) => Promise<void> | void;
  canDrag?: (item: T) => boolean;
  onOpen?: (item: T) => void;
  emptyText?: string;
}) {
  const [activeId, setActiveId] = useState<number | null>(null);
  const [moving, setMoving] = useState<number | null>(null);
  const active = items.find((i) => i.id === activeId) ?? null;
  const label = (status: string) => columns.find((c) => c.value === status)?.label ?? status;

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
  );

  // the column under the pointer wins; fall back to overlap
  const collision: CollisionDetection = (args) => {
    const hits = pointerWithin(args);
    return hits.length ? hits : rectIntersection(args);
  };

  const announcements: Announcements = {
    onDragStart: ({ active: a }) => `Picked up ${a.data.current?.title ?? 'card'}.`,
    onDragOver: ({ over }) => (over ? `Over ${label(String(over.id))}.` : 'Not over a column.'),
    onDragEnd: ({ active: a, over }) => (over ? `Moved ${a.data.current?.title ?? 'card'} to ${label(String(over.id))}.` : 'Dropped.'),
    onDragCancel: () => 'Moving cancelled.',
  };

  const move = async (item: T | undefined, status: string | null) => {
    if (!item || !status || status === item.status || !onMove) return;
    setMoving(item.id);
    try {
      await onMove(item, status);
    } finally {
      setMoving(null);
    }
  };

  const end = ({ active: a, over }: DragEndEvent) => {
    setActiveId(null);
    return move(items.find((i) => i.id === a.id), over ? String(over.id) : null);
  };

  /** keyboard: move to the neighbouring column */
  const shift = async (item: T, dir: -1 | 1) => {
    const i = columns.findIndex((c) => c.value === item.status);
    const target = columns[i + dir];
    if (!target) return;
    await move(item, target.value);
    // the card re-mounts in its new column — keep keyboard focus on it
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-card-id="${item.id}"]`)?.focus());
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collision}
      accessibility={{
        announcements,
        screenReaderInstructions: { draggable: 'Press Enter to open. Alt plus left or right arrow moves the card to the previous or next column. Drag with mouse or long-press on touch.' },
      }}
      onDragStart={(e) => setActiveId(Number(e.active.id))}
      onDragEnd={end}
      onDragCancel={() => setActiveId(null)}
    >
      <div className="flex gap-3 overflow-x-auto pb-3">
        {columns.map((col) => {
          const colItems = items.filter((i) => i.status === col.value);
          return (
            <Column key={col.value} col={col} count={colItems.length} dragging={!!active}
              isTarget={!!active && active.status !== col.value} emptyText={emptyText}>
              {colItems.map((item) => {
                const draggable = !!onMove && canDrag(item) && moving !== item.id;
                return (
                  <Card key={item.id} id={item.id} title={(item as { name?: string }).name}
                    draggable={draggable} dimmed={activeId === item.id} busy={moving === item.id}
                    onOpen={() => onOpen?.(item)} onShift={(d) => shift(item, d)}
                    menu={draggable && <MoveMenu columns={columns} current={item.status} onPick={(s) => move(item, s)} />}>
                    {renderCard(item)}
                  </Card>
                );
              })}
            </Column>
          );
        })}
      </div>

      {/* card following the pointer */}
      <DragOverlay dropAnimation={null}>
        {active && (
          <div className="w-72 rotate-[1.5deg] cursor-grabbing rounded-lg border border-primary/30 bg-white p-3 text-sm shadow-2xl">{renderCard(active)}</div>
        )}
      </DragOverlay>
    </DndContext>
  );
}

function Column({ col, count, dragging, isTarget, emptyText, children }: {
  col: Opt; count: number; dragging: boolean; isTarget: boolean; emptyText: string; children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: col.value });
  const hot = isTarget && isOver;
  return (
    <div
      ref={setNodeRef}
      data-kanban-col={col.value}
      className={cn(
        // columns with cards share the width; empty ones stay narrow so the busy ones get room
        'flex max-h-[calc(100vh-16rem)] min-h-48 flex-col rounded-xl bg-[#f3f4f7] transition-[background-color,box-shadow]',
        count ? 'min-w-[240px] flex-1' : 'w-40 shrink-0',
        hot && 'bg-primary/[.07] ring-2 ring-primary/40',
      )}
    >
      <div className="flex items-center gap-2 px-3 pt-3 pb-2">
        <span className="size-2.5 shrink-0 rounded-full" style={{ background: col.color }} />
        <span className="truncate text-[13px] font-semibold text-foreground">{col.label}</span>
        <span className="rounded-full bg-white px-2 py-px text-xs font-medium text-muted-foreground shadow-[0_0_0_1px_rgba(0,0,0,.06)]">{count}</span>
      </div>
      <div className="mx-3 mb-2 h-0.5 rounded-full" style={{ background: col.color }} />
      <div className="flex-1 space-y-2 overflow-y-auto px-2 pb-2">
        {children}
        {count === 0 && (
          <div className={cn(
            'flex h-24 items-center justify-center rounded-lg border-2 border-dashed px-2 text-center text-xs transition-colors',
            hot ? 'border-primary/60 text-primary' : isTarget ? 'border-primary/30 text-muted-foreground' : 'border-black/[.07] text-muted-foreground/70',
          )}>
            {dragging && isTarget ? 'Drop here' : emptyText}
          </div>
        )}
      </div>
    </div>
  );
}

function Card({ id, title, draggable, dimmed, busy, onOpen, onShift, menu, children }: {
  id: number; title?: string; draggable: boolean; dimmed: boolean; busy: boolean; onOpen: () => void; onShift: (dir: -1 | 1) => void;
  menu?: React.ReactNode; children: React.ReactNode;
}) {
  const { setNodeRef, attributes, listeners } = useDraggable({ id, disabled: !draggable, data: { title } });
  return (
    <div
      ref={setNodeRef}
      data-card-id={id}
      {...attributes}
      {...listeners}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter') onOpen();
        if (draggable && e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
          e.preventDefault();
          onShift(e.key === 'ArrowLeft' ? -1 : 1);
        }
      }}
      className={cn(
        'group/card relative rounded-lg border border-black/[.08] bg-white p-3 text-sm shadow-[0_1px_2px_rgba(16,24,40,.05)] transition outline-none select-none',
        'hover:border-primary/30 hover:shadow-[0_4px_12px_rgba(16,24,40,.08)] focus-visible:ring-2 focus-visible:ring-primary/50',
        draggable ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer',
        dimmed && 'border-dashed opacity-40 shadow-none',
        busy && 'pointer-events-none animate-pulse',
      )}
    >
      {children}
      {menu && <div className="absolute top-2 right-2">{menu}</div>}
    </div>
  );
}

/** "⋯" on a card: move it to another column without dragging */
function MoveMenu({ columns, current, onPick }: { columns: Opt[]; current: string; onPick: (status: string) => void }) {
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  return (
    <div onMouseDown={stop} onTouchStart={stop} onClick={stop} onKeyDown={stop}>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label="Move to…"
          className="flex size-6 items-center justify-center rounded-md text-muted-foreground opacity-0 transition hover:bg-muted hover:text-foreground focus-visible:opacity-100 group-hover/card:opacity-100 data-[state=open]:bg-muted data-[state=open]:opacity-100"
        >
          <MoreHorizontal className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuLabel className="text-xs text-muted-foreground">Move to</DropdownMenuLabel>
          {columns.map((c) => (
            <DropdownMenuItem key={c.value} disabled={c.value === current} onSelect={() => onPick(c.value)} className="gap-2">
              <span className="size-2.5 rounded-full" style={{ background: c.color }} />
              <span className="flex-1">{c.label}</span>
              {c.value === current && <Check className="size-3.5" />}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

// ---------------------------------------------------------------------------
// small pieces for card bodies
// ---------------------------------------------------------------------------

/** soft tinted label (priority, severity) — lighter than a solid StatusChip */
export function KanbanTag({ list, value }: { list: Opt[]; value: string | null | undefined }) {
  const color = optColor(list, value);
  return (
    <span className="inline-flex h-5 items-center gap-1 rounded-full px-2 text-[11px] font-medium whitespace-nowrap" style={{ background: `${color}1a`, color }}>
      <span className="size-1.5 rounded-full" style={{ background: color }} />
      {optLabel(list, value)}
    </span>
  );
}

/** due date: red when late (with how many days), amber when due within 2 days, grey otherwise */
export function KanbanDue({ date, open }: { date: string | null | undefined; open: boolean }) {
  if (!date) return null;
  const d = dayjs(date);
  const days = d.startOf('day').diff(dayjs().startOf('day'), 'day');
  const text = d.format(d.year() === dayjs().year() ? 'DD MMM' : 'DD MMM YY');
  const late = open && days < 0;
  const soon = open && days >= 0 && days <= 2;
  return (
    <span
      title={late ? `Due ${d.format('DD MMM YYYY')} — ${-days} day(s) late` : `Due ${d.format('DD MMM YYYY')}`}
      className={cn(
        'inline-flex h-5 items-center gap-1 rounded-full px-1.5 text-[11px] font-medium whitespace-nowrap',
        late ? 'bg-red-50 text-red-600' : soon ? 'bg-amber-50 text-amber-700' : 'text-muted-foreground',
      )}
    >
      {late ? <AlertTriangle className="size-3" /> : <CalendarClock className="size-3" />}
      {text}
      {late && <span className="font-semibold">+{-days}d</span>}
    </span>
  );
}

/** slim progress line */
export function KanbanProgress({ value }: { value: number }) {
  const v = Math.min(100, Math.max(0, Number(value) || 0));
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-black/[.06]">
        <div className="h-full rounded-full bg-[#00c875] transition-[width]" style={{ width: `${v}%` }} />
      </div>
      <span className="w-8 text-right text-[11px] text-muted-foreground tabular-nums">{Math.round(v)}%</span>
    </div>
  );
}
