/** Starts the in-process scheduler (was pg_cron) when the Node.js server boots */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs' && process.env.DISABLE_SCHEDULER !== 'true') {
    const { startScheduler } = await import('./server/scheduler');
    startScheduler();
  }
}
