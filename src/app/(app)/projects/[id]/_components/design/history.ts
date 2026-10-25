import { type DiagramContent } from '@/lib/diagram';
import { toContent, toFlow } from './flow';

const MAX_HISTORY = 100;

/**
 * Undo history of MY edits: each step is the drawing before / after it (JSON of DiagramContent); `last` is the
 * drawing the steps were recorded up to. Undo / redo merge the step onto whatever is on screen now, so other
 * people's edits that arrived in between stay.
 */
type Step = { before: string; after: string };
export type History = { past: Step[]; future: Step[]; last: string };
export const pushed = (h: History, current: string): History =>
  (current === h.last ? h : { past: [...h.past.slice(-(MAX_HISTORY - 1)), { before: h.last, after: current }], future: [], last: current });
/** the drawing as the editor serialises it (same form as its `snap`) */
export const snapOf = (c: DiagramContent) => {
  const f = toFlow(c);
  return JSON.stringify(toContent(f.nodes, f.edges));
};
