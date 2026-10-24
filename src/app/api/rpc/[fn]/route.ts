import { withUser } from '@/server/api';
import { startAnalysis } from '@/server/analysis';
import { AppError, withCtx } from '@/server/db';
import { RPC } from '@/server/rpc';

/** Workflow / reporting functions (was supabase.rpc) */
export const POST = withUser(async (me, req, params) => {
  const fn = RPC[params.fn];
  if (!fn) throw new AppError(`Unknown function ${params.fn}`, 404);
  const args = await req.json().catch(() => ({}));
  const data = await withCtx(me, (ctx) => fn(ctx, args ?? {}));
  // a submitted (or resubmitted) request gets the AI's initial analysis for System Service
  if (params.fn === 'submit_request') await startAnalysis(me, Number(args.p_request_id)).catch((e) => console.warn('[ai] analysis not started:', e));
  return { data };
});
