import { createDb } from '@/lib/db/client';
import type { Profile } from '@/lib/types';
import { runQuery } from './data';
import { withCtx } from './db';
import { RPC } from './rpc';

/**
 * The browser query API executed in-process (scripts / tests). `me = null` = system (full access).
 * Same policies, hooks and workflow functions as the HTTP API.
 */
export function localDb(me: Profile | null) {
  const run = async <T>(fn: Parameters<typeof withCtx<T>>[1]) => {
    try {
      return { data: await withCtx(me, fn, { system: me === null }), error: null };
    } catch (e) {
      return { data: null, error: { message: e instanceof Error ? e.message : String(e) } };
    }
  };
  return createDb(
    async (q) => {
      const r = await run((ctx) => runQuery(ctx, q));
      return r.error ? { data: null, error: r.error, count: null } : { data: r.data!.data, error: null, count: r.data!.count ?? null };
    },
    async (fn, args = {}) => {
      const f = RPC[fn] ?? (me === null ? SYSTEM_RPC[fn] : undefined);
      if (!f) return { data: null as never, error: { message: `Unknown function ${fn}` } };
      return run((ctx) => f(ctx, args)) as never;
    },
  );
}

const SYSTEM_RPC: typeof RPC = {
  run_notification_scan: async (ctx) => (await import('./rpc/scan')).runNotificationScan(ctx),
  take_kpi_snapshot: async (ctx) => (await import('./rpc/kpi')).takeKpiSnapshot(ctx),
};
