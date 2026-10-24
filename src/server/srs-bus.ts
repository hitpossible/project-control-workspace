import 'server-only';
import { EventEmitter } from 'node:events';

/**
 * "This SRS changed" events (signed / sent back / sent / cancelled) pushed over SSE to everyone who has it open,
 * so a new signature shows up without reloading. In-process like notify-bus.ts — single instance only.
 */
export type SrsEvent = { type: 'changed'; by: number; action: 'sent' | 'signed' | 'rejected' | 'cancelled' | 'layout' };

type G = typeof globalThis & { __pcwSrsBus?: EventEmitter };

function bus(): EventEmitter {
  const g = globalThis as G;
  if (!g.__pcwSrsBus) {
    g.__pcwSrsBus = new EventEmitter();
    g.__pcwSrsBus.setMaxListeners(0); // one listener per open page
  }
  return g.__pcwSrsBus;
}

export function publishSrs(id: number, e: SrsEvent) {
  bus().emit(`srs:${id}`, e);
}

export function subscribeSrs(id: number, fn: (e: SrsEvent) => void): () => void {
  const key = `srs:${id}`;
  bus().on(key, fn);
  return () => bus().off(key, fn);
}
