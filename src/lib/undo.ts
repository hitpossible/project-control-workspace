import { toast } from 'sonner';

/**
 * Delete with an Undo window: the caller hides the item right away, the real delete runs
 * after `ms` unless Undo is clicked. Deletes still pending when the page is closed are sent
 * then (best effort) — if that fails the item simply stays, nothing is lost.
 * Only for small, self-contained rows; cascading deletes keep their confirm dialog.
 */
const pending = new Map<number, () => void>();
let seq = 0;
let bound = false;

export function deleteWithUndo({ message, commit, undo, ms = 5000 }: {
  message: string;
  /** the real delete (handles its own errors / reload) */
  commit: () => Promise<unknown>;
  /** put the hidden item back */
  undo: () => void;
  ms?: number;
}) {
  if (!bound && typeof window !== 'undefined') {
    bound = true;
    window.addEventListener('pagehide', () => pending.forEach((run) => run()));
  }
  const id = ++seq;
  let settled = false;
  const run = () => {
    if (settled) return;
    settled = true;
    pending.delete(id);
    void commit();
  };
  pending.set(id, run);
  const timer = setTimeout(run, ms);
  toast(message, {
    duration: ms,
    action: {
      label: 'Undo',
      onClick: () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        pending.delete(id);
        undo();
      },
    },
  });
}
