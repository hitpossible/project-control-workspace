import type { DataQuery } from '@/lib/db/protocol';
import { withUser } from '@/server/api';
import { runQuery } from '@/server/data';
import { withCtx } from '@/server/db';

/** Generic table access for the browser client (policies enforced in src/server/policies.ts) */
export const POST = withUser(async (me, req) => {
  const q = (await req.json()) as DataQuery;
  return withCtx(me, (ctx) => runQuery(ctx, q));
});
