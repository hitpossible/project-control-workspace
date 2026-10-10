import cron from 'node-cron';
import { withCtx } from './db';
import { sendQueuedEmails } from './mail';
import { takeKpiSnapshot } from './rpc/kpi';
import { runNotificationScan } from './rpc/scan';

type G = typeof globalThis & { __pcwScheduler?: boolean };

/**
 * Jobs (was pg_cron):
 *   hourly        notification scan (due / overdue / escalation, auto Delayed, health)
 *   Monday 06:00  KPI snapshot
 *   every minute  e-mail outbox delivery
 * Run exactly one scheduler per deployment (set DISABLE_SCHEDULER=true on extra app instances).
 */
export function startScheduler() {
  const g = globalThis as G;
  if (g.__pcwScheduler) return;
  g.__pcwScheduler = true;
  const job = (name: string, fn: () => Promise<unknown>) => async () => {
    try {
      const out = await fn();
      if (name !== 'email' || out) console.log(`[scheduler] ${name}`, out);
    } catch (e) {
      console.error(`[scheduler] ${name} failed`, e);
    }
  };
  cron.schedule(process.env.CRON_NOTIFICATION_SCAN ?? '0 * * * *', job('notification-scan', () => withCtx(null, runNotificationScan, { system: true })));
  cron.schedule(process.env.CRON_KPI_SNAPSHOT ?? '0 6 * * 1', job('kpi-snapshot', () => withCtx(null, takeKpiSnapshot, { system: true })));
  cron.schedule('* * * * *', job('email', () => sendQueuedEmails()));
  console.log('[scheduler] started');
}
