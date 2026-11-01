import { Readable } from 'node:stream';
import { withUser } from '@/server/api';
import { AppError, withCtx } from '@/server/db';
import { canViewProject } from '@/server/perms';
import { getObject } from '@/server/storage';

/** The acceptor's signature on an accepted closure (for the Closure PDF) — anyone who can see the project */
export const GET = withUser(async (me, _req, params) => {
  const id = Number(params.id);
  const path = await withCtx(me, async (ctx) => {
    const c = Number.isInteger(id) ? await ctx.one<{ project_id: number; signature_path: string | null }>('SELECT project_id, signature_path FROM project_closures WHERE id = ?', [id]) : null;
    if (!c || !(await canViewProject(ctx, c.project_id))) throw new AppError('Not found', 404);
    return c.signature_path;
  });
  if (!path) throw new AppError('No signature on this closure', 404);
  const obj = await getObject(path);
  return new Response(Readable.toWeb(obj.stream) as ReadableStream, {
    headers: { 'Content-Type': 'image/png', 'Content-Length': String(obj.size), 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' },
  });
});
