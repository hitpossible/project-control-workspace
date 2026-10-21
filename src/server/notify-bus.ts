import 'server-only';
import { EventEmitter } from 'node:events';

export type LiveNotification = { id: number; title: string; body: string | null; link: string | null };

type G = typeof globalThis & { __pcwNotifyBus?: EventEmitter };

/**
 * In-process pub/sub for live (SSE) notifications. Kept on globalThis so route handlers, the scheduler
 * and dev hot reloads share one emitter. Single-instance only — with several app instances, swap this for
 * Redis pub/sub (or have the stream poll the notifications table).
 */
function bus(): EventEmitter {
  const g = globalThis as G;
  if (!g.__pcwNotifyBus) {
    g.__pcwNotifyBus = new EventEmitter();
    g.__pcwNotifyBus.setMaxListeners(0); // one listener per open browser tab
  }
  return g.__pcwNotifyBus;
}

export function publishNotification(userId: number, n: LiveNotification) {
  bus().emit(`user:${userId}`, n);
}

export function subscribeNotifications(userId: number, fn: (n: LiveNotification) => void): () => void {
  const key = `user:${userId}`;
  bus().on(key, fn);
  return () => bus().off(key, fn);
}
