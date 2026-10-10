import { Readable } from 'node:stream';
import { withUser } from '@/server/api';
import { AppError, withCtx } from '@/server/db';
import { canReadEvidence } from '@/server/policies';
import { getObject } from '@/server/storage';

const INLINE = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'text/plain']);

/** Stream an evidence file after checking the evidence row is visible to the user */
export const GET = withUser(async (me, _req, params) => {
  const ev = await withCtx(me, async (ctx) => {
    const e = await ctx.one<{ storage_path: string | null; file_name: string | null; mime_type: string | null; project_id: string | null; request_id: string | null; is_internal: boolean }>(
      'SELECT storage_path, file_name, mime_type, project_id, request_id, is_internal FROM evidence WHERE id = ?', [params.id]);
    if (!e || !e.storage_path || !(await canReadEvidence(ctx, e))) throw new AppError('File not found', 404);
    return e;
  });
  const obj = await getObject(ev.storage_path!);
  const name = encodeURIComponent(ev.file_name ?? 'evidence');
  // only render known-safe types inline; everything else (html, svg…) downloads to avoid script execution on our origin
  const type = ev.mime_type ?? obj.contentType ?? 'application/octet-stream';
  const inline = INLINE.has(type);
  return new Response(Readable.toWeb(obj.stream) as ReadableStream, {
    headers: {
      'Content-Type': inline ? (type === 'text/plain' ? 'text/plain; charset=utf-8' : type) : 'application/octet-stream',
      'Content-Length': String(obj.size),
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${name}`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
});
