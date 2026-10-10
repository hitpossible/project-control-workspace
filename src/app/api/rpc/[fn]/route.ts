import { withUser } from '@/server/api';
import { AppError, withCtx } from '@/server/db';
import { RPC } from '@/server/rpc';

/** Workflow / reporting functions (was supabase.rpc) */
export const POST = withUser(async (me, req, params) => {
  const fn = RPC[params.fn];
  if (!fn) throw new AppError(`Unknown function ${params.fn}`, 404);
  const args = await req.json().catch(() => ({}));
  return { data: await withCtx(me, (ctx) => fn(ctx, args ?? {})) };
});
