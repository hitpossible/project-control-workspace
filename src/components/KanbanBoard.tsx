'use client';

import {
  DndContext, DragOverlay, MouseSensor, TouchSensor, pointerWithin, rectIntersection, useDraggable, useDroppable, useSensor, useSensors,
  type Announcements, type CollisionDetection, type DragEndEvent,
} from '@dnd-kit/core';
import { useState } from 'react';
import type { Opt } from '@/lib/constants';
import { cn } from '@/lib/utils';

type Item = { id: string; status: string };

/**
 * Generic status board (monday.com style) built on @dnd-kit.
 *   mouse: drag after moving 6px (a plain click opens the card)
 *   touch: long-press 200 ms to drag, so normal swipes still scroll
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
  const [activeId, setActiveId] = useState<string | null>(null);
  const [moving, setMoving] = useState<string | null>(null);
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
      onDragStart={(e) => setActiveId(String(e.active.id))}
      onDragEnd={end}
      onDragCancel={() => setActiveId(null)}
    >
      <div className="flex gap-3 overflow-x-auto pb-3">
        {columns.map((col) => (
          <Column key={col.value} col={col} count={items.filter((i) => i.status === col.value).length}
            isTarget={!!active && active.status !== col.value} emptyText={emptyText}>
            {items.filter((i) => i.status === col.value).map((item) => (
              <Card key={item.id} id={item.id} title={(item as { name?: string }).name}
                draggable={!!onMove && canDrag(item) && moving !== item.id}
                dimmed={activeId === item.id} busy={moving === item.id} onOpen={() => onOpen?.(item)} onShift={(d) => shift(item, d)}>
                {renderCard(item)}
              </Card>
            ))}
          </Column>
        ))}
      </div>

      {/* card following the pointer */}
      <DragOverlay dropAnimation={null}>
        {active && (
          <div className="rotate-2 cursor-grabbing rounded-md border border-primary/40 bg-white p-2.5 text-sm shadow-xl">{renderCard(active)}</div>
        )}
      </DragOverlay>
    </DndContext>
  );
}

function Column({ col, count, isTarget, emptyText, children }: {
  col: Opt; count: number; isTarget: boolean; emptyText: string; children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: col.value });
  return (
    <div
      ref={setNodeRef}
      data-kanban-col={col.value}
      className={cn(
        'flex max-h-[calc(100vh-16rem)] min-h-40 w-64 shrink-0 flex-col rounded-lg bg-[#f5f6f8] transition-colors',
        isTarget && isOver && 'bg-selected ring-2 ring-primary/40',
      )}
    >
      <div className="flex items-center gap-2 rounded-t-lg px-3 py-2 text-sm font-semibold text-white" style={{ background: col.color }}>
        <span className="truncate">{col.label}</span>
        <span className="ml-auto rounded-full bg-white/25 px-2 text-xs">{count}</span>
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto p-2">
        {children}
        {count === 0 && (
          <div className={cn('rounded-md border border-dashed border-grid px-2 py-6 text-center text-xs text-muted-foreground', isTarget && 'border-primary/50')}>
            {isTarget ? 'Drop here' : emptyText}
          </div>
        )}
      </div>
    </div>
  );
}

function Card({ id, title, draggable, dimmed, busy, onOpen, onShift, children }: {
  id: string; title?: string; draggable: boolean; dimmed: boolean; busy: boolean; onOpen: () => void; onShift: (dir: -1 | 1) => void; children: React.ReactNode;
}) {
  const { setNodeRef, attributes, listeners } = useDraggable({ id, disabled: !draggable, data: { title } });
  return (
    <div
      ref={setNodeRef}
      data-card-id={id}
      {...attributes}
      {...listeners}
      onClick={onOpen}
      title={draggable ? 'Drag to change status · Alt + ← / → to move with the keyboard' : undefined}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onOpen();
        if (draggable && e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
          e.preventDefault();
          onShift(e.key === 'ArrowLeft' ? -1 : 1);
        }
      }}
      className={cn(
        'rounded-md border border-grid bg-white p-2.5 text-sm shadow-[0_1px_2px_rgba(0,0,0,.06)] transition-shadow outline-none select-none hover:shadow-md focus-visible:ring-2 focus-visible:ring-primary/50',
        draggable ? 'cursor-grab' : 'cursor-pointer',
        dimmed && 'opacity-40',
        busy && 'animate-pulse',
      )}
    >
      {children}
    </div>
  );
}
