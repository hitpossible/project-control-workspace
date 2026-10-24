import { Readable } from 'node:stream';
import { withUser } from '@/server/api';
import { AppError, withCtx } from '@/server/db';
import { loadSrs } from '@/server/srs';
import { getObject } from '@/server/storage';

/** The SRS PDF: with the signatures so far (default), or the untouched upload (?original=1) */
export const GET = withUser(async (me, req, params) => {
  const doc = await withCtx(me, (ctx) => loadSrs(ctx, Number(params.id)));
  const original = new URL(req.url).searchParams.get('original') === '1';
  const key = original ? doc.original_path : doc.stamped_path ?? doc.original_path;
  if (!key) throw new AppError('File not found', 404);
  const obj = await getObject(key);
  const signed = !original && doc.stamped_path;
  const name = encodeURIComponent(`${doc.file_name.replace(/\.pdf$/i, '')}${signed ? ' (signed)' : ''}.pdf`);
  return new Response(Readable.toWeb(obj.stream) as ReadableStream, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Length': String(obj.size),
      'Content-Disposition': `${new URL(req.url).searchParams.get('download') === '1' ? 'attachment' : 'inline'}; filename*=UTF-8''${name}`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
});
