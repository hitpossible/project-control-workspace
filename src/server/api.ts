import { NextResponse } from 'next/server';
import type { Profile } from '@/lib/types';
import { bearerToken, userFromToken } from './api-tokens';
import { currentUser } from './auth';
import { AppError } from './db';

/** JSON route wrapper: requires a signed-in user and maps errors to { error: { message } } */
export function withUser(fn: (me: Profile, req: Request, params: Record<string, string>) => Promise<unknown>) {
  return async (req: Request, ctx: { params: Promise<Record<string, string>> }) => {
    try {
      const me = await currentUser();
      if (!me) return NextResponse.json({ error: { message: 'Not signed in', status: 401 } }, { status: 401 });
      const out = await fn(me, req, await ctx.params);
      return out instanceof Response ? out : NextResponse.json(out ?? { data: null });
    } catch (e) {
      return errorResponse(e);
    }
  };
}

/**
 * Like withUser, but also accepts a personal access token (Authorization: Bearer pcw_…) — for routes that a user's
 * own tools may call. A request that sends a token is judged by the token alone; `write` routes need a write-scope token.
 */
export function withApiUser(fn: (me: Profile, req: Request, params: Record<string, string>) => Promise<unknown>, opts: { write?: boolean } = {}) {
  return async (req: Request, ctx: { params: Promise<Record<string, string>> }) => {
    try {
      const token = bearerToken(req);
      const auth = token ? await userFromToken(token) : null;
      const me = token ? auth?.me : req.headers.has('authorization') ? null : await currentUser();
      if (!me) return NextResponse.json({ error: { message: token ? 'Invalid or expired token' : 'Not signed in', status: 401 } }, { status: 401 });
      if (opts.write && auth && auth.scope !== 'write') {
        return NextResponse.json({ error: { message: 'This token is read-only — create a token with write access on the Profile page', status: 403 } }, { status: 403 });
      }
      const out = await fn(me, req, await ctx.params);
      return out instanceof Response ? out : NextResponse.json(out ?? { data: null }, { headers: { 'Cache-Control': 'private, no-store' } });
    } catch (e) {
      return errorResponse(e);
    }
  };
}

export function errorResponse(e: unknown) {
  if (e instanceof AppError) return NextResponse.json({ error: { message: e.message, status: e.status } }, { status: e.status });
  console.error('[api]', e);
  const msg = process.env.NODE_ENV === 'production' ? 'Unexpected server error' : e instanceof Error ? e.message : String(e);
  return NextResponse.json({ error: { message: msg, status: 500 } }, { status: 500 });
}
