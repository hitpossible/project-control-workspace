'use client';

import { useEffect, useRef, useState } from 'react';
import type { Opt } from '@/lib/constants';
import { cn } from '@/lib/utils';

type Drag = { id: string; x: number; y: number; dx: number; dy: number; w: number; active: boolean };

/**
 * Generic status board (monday.com style). Cards are dragged between columns with pointer events
 * (mouse, touch and pen); a short click still opens the card. `onMove` persists the change.
 */
export default function KanbanBoard<T extends { id: string; status: string }>({
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
  const [drag, setDrag] = useState<Drag | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [moving, setMoving] = useState<string | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const board = useRef<HTMLDivElement>(null);
  const edge = useRef(0); // auto-scroll speed while dragging near the board's left / right edge
  const dragging = drag?.active ? items.find((i) => i.id === drag.id) ?? null : null;

  // window listeners while a card is pressed
  useEffect(() => {
    if (!drag) return;
    const columnAt = (x: number, y: number) =>
      (document.elementFromPoint(x, y)?.closest('[data-kanban-col]') as HTMLElement | null)?.dataset.kanbanCol ?? null;
    const move = (e: PointerEvent) => {
      const s = start.current;
      const active = drag.active || (!!s && Math.hypot(e.clientX - s.x, e.clientY - s.y) > 6);
      if (!active) return;
      e.preventDefault();
      if (!drag.active) window.getSelection()?.removeAllRanges();
      setDrag((d) => d && { ...d, x: e.clientX, y: e.clientY, active: true });
      setOver(columnAt(e.clientX, e.clientY));
      const r = board.current?.getBoundingClientRect();
      edge.current = !r ? 0 : e.clientX > r.right - 60 ? 14 : e.clientX < r.left + 60 ? -14 : 0;
    };
    let raf = 0;
    const tick = () => {
      if (edge.current && board.current) board.current.scrollLeft += edge.current;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const up = async (e: PointerEvent) => {
      const item = items.find((i) => i.id === drag.id);
      const target = drag.active ? columnAt(e.clientX, e.clientY) : null;
      const wasDrag = drag.active;
      setDrag(null);
      setOver(null);
      start.current = null;
      edge.current = 0;
      if (!item) return;
      // a press without a drag is a click — unless the pointer travelled (attempted drag of a locked card)
      if (!wasDrag) return Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 6 ? undefined : onOpen?.(item);
      if (!target || target === item.status || !onMove) return;
      setMoving(item.id);
      try {
        await onMove(item, target);
      } finally {
        setMoving(null);
      }
    };
    const cancel = () => {
      setDrag(null);
      setOver(null);
      edge.current = 0;
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
    };
  }, [drag, items, onMove, onOpen]);

  return (
    <div ref={board} className={cn('flex gap-3 overflow-x-auto pb-3', dragging && 'cursor-grabbing select-none')}>
      {columns.map((col) => {
        const list = items.filter((i) => i.status === col.value);
        const target = !!dragging && dragging.status !== col.value;
        return (
          <div
            key={col.value}
            data-kanban-col={col.value}
            className={cn(
              'flex max-h-[calc(100vh-16rem)] min-h-40 w-64 shrink-0 flex-col rounded-lg bg-[#f5f6f8] transition-colors',
              target && over === col.value && 'bg-selected ring-2 ring-primary/40',
            )}
          >
            <div className="flex items-center gap-2 rounded-t-lg px-3 py-2 text-sm font-semibold text-white" style={{ background: col.color }}>
              <span className="truncate">{col.label}</span>
              <span className="ml-auto rounded-full bg-white/25 px-2 text-xs">{list.length}</span>
            </div>
            <div className="flex-1 space-y-2 overflow-y-auto p-2">
              {list.map((item) => {
                const draggable = !!onMove && canDrag(item) && moving !== item.id;
                return (
                  <div
                    key={item.id}
                    role="button"
                    tabIndex={0}
                    onPointerDown={(e) => {
                      if (e.button !== 0) return;
                      const r = e.currentTarget.getBoundingClientRect();
                      start.current = { x: e.clientX, y: e.clientY };
                      // non-draggable cards still open on click (drag never activates)
                      setDrag({ id: item.id, x: e.clientX, y: e.clientY, dx: e.clientX - r.left, dy: e.clientY - r.top, w: r.width, active: false });
                      if (!draggable) start.current = null;
                    }}
                    onKeyDown={(e) => e.key === 'Enter' && onOpen?.(item)}
                    className={cn(
                      'rounded-md border border-grid bg-white p-2.5 text-sm shadow-[0_1px_2px_rgba(0,0,0,.06)] transition-shadow select-none hover:shadow-md',
                      draggable ? 'cursor-grab touch-none' : 'cursor-pointer',
                      dragging?.id === item.id && 'opacity-40',
                      moving === item.id && 'animate-pulse',
                    )}
                  >
                    {renderCard(item)}
                  </div>
                );
              })}
              {list.length === 0 && (
                <div className={cn('rounded-md border border-dashed border-grid px-2 py-6 text-center text-xs text-muted-foreground', target && 'border-primary/50')}>
                  {target ? 'Drop here' : emptyText}
                </div>
              )}
            </div>
          </div>
        );
      })}

      {/* card following the pointer */}
      {dragging && drag && (
        <div
          className="pointer-events-none fixed z-50 rotate-2 rounded-md border border-primary/40 bg-white p-2.5 text-sm shadow-xl"
          style={{ left: drag.x - drag.dx, top: drag.y - drag.dy, width: drag.w }}
        >
          {renderCard(dragging)}
        </div>
      )}
    </div>
  );
}
