import { SignJWT } from 'jose';
import { withUser } from '@/server/api';
import { AppError, withCtx } from '@/server/db';
import { loadDiagram, tabId } from '@/server/diagrams';
import { sessionSecret } from '@/server/session';

/**
 * Ticket into a diagram's live room on the realtime service (realtime/server.mjs: cursors and shapes being dragged).
 * The service has no database: this checks that the user may open the diagram and signs who they are, for this
 * diagram and editor tab only, valid for a few minutes (the editor fetches a new one when it reconnects).
 * url: REALTIME_PUBLIC_URL, else the app's host on port 3001 (local development).
 */
export const GET = withUser(async (me, req, params) => {
  const id = Number(params.id);
  const tab = tabId(new URL(req.url).searchParams.get('tab'));
  if (!tab) throw new AppError('tab is required');
  await withCtx(me, (ctx) => loadDiagram(ctx, id));
  const token = await new SignJWT({ d: id, tab, name: me.full_name })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(String(me.id))
    .setAudience('pcw-realtime')
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(sessionSecret());
  return { data: { token, url: realtimeUrl(req) } };
});

function realtimeUrl(req: Request) {
  if (process.env.REALTIME_PUBLIC_URL) return process.env.REALTIME_PUBLIC_URL;
  const u = new URL(req.url);
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? u.host;
  const https = (req.headers.get('x-forwarded-proto') ?? u.protocol.replace(':', '')) === 'https';
  return `${https ? 'wss' : 'ws'}://${host.replace(/:\d+$/, '')}:${process.env.REALTIME_PORT ?? 3001}/realtime`;
}
