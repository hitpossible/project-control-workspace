import { withUser } from '@/server/api';
import { createToken, listTokens } from '@/server/api-tokens';

/** My personal access tokens. Cookie session only — a token cannot be used to mint more tokens. */
export const GET = withUser(async (me) => ({ data: await listTokens(me.id) }));

/** Create: JSON { name, days?, scope? ('read' | 'write') } → the token, shown once */
export const POST = withUser(async (me, req) => {
  const body = (await req.json().catch(() => ({}))) as { name?: string; days?: number | null; scope?: string };
  return { data: await createToken(me.id, body.name, body.days, body.scope) };
});
