import 'server-only';
import { EventEmitter } from 'node:events';

/**
 * Live state of Design-tab diagrams: who has a diagram open (one entry per browser tab) and save / delete events,
 * pushed to the open editors over SSE. In-process like notify-bus.ts — single instance only; with several app
 * instances swap this for Redis pub/sub.
 */
export type DiagramViewer = { tab: string; userId: number; name: string };
export type DiagramEvent =
  | { type: 'presence'; viewers: DiagramViewer[] }
  | { type: 'saved'; tab: string; userId: number; name: string; updated_at: string; title: string }
  | { type: 'deleted'; userId: number; name: string };

type G = typeof globalThis & { __pcwDiagramBus?: { emitter: EventEmitter; viewers: Map<number, Map<string, DiagramViewer>> } };

function bus() {
  const g = globalThis as G;
  if (!g.__pcwDiagramBus) {
    const emitter = new EventEmitter();
    emitter.setMaxListeners(0); // one listener per open editor
    g.__pcwDiagramBus = { emitter, viewers: new Map() };
  }
  return g.__pcwDiagramBus;
}

export function publishDiagram(id: number, e: DiagramEvent) {
  bus().emitter.emit(`diagram:${id}`, e);
}

function publishPresence(id: number) {
  publishDiagram(id, { type: 'presence', viewers: [...(bus().viewers.get(id)?.values() ?? [])] });
}

/** register an open editor; returns the unsubscribe, which also removes it from the viewers */
export function openDiagram(id: number, viewer: DiagramViewer, fn: (e: DiagramEvent) => void): () => void {
  const b = bus();
  const key = `diagram:${id}`;
  b.emitter.on(key, fn);
  const list = b.viewers.get(id) ?? new Map<string, DiagramViewer>();
  b.viewers.set(id, list);
  list.set(viewer.tab, viewer);
  publishPresence(id);
  return () => {
    b.emitter.off(key, fn);
    list.delete(viewer.tab);
    if (!list.size) b.viewers.delete(id);
    publishPresence(id);
  };
}
