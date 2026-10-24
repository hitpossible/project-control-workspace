import { Readable } from 'node:stream';
import { withUser } from '@/server/api';
import { AppError, withCtx } from '@/server/db';
import { pngFromDataUrl, saveMySignature } from '@/server/srs';
import { getObject } from '@/server/storage';

/** My signature image — only ever shown to its owner; others see it only stamped into a signed SRS. ?check=1 → { has_signature } */
export const GET = withUser(async (me, req) => {
  const path = await withCtx(me, (ctx) => ctx.val<string>('SELECT signature_path FROM profiles WHERE id = ?', [me.id]));
  if (new URL(req.url).searchParams.get('check') === '1') return { data: { has_signature: !!path } };
  if (!path) throw new AppError('No signature yet', 404);
  const obj = await getObject(path);
  return new Response(Readable.toWeb(obj.stream) as ReadableStream, {
    headers: { 'Content-Type': 'image/png', 'Content-Length': String(obj.size), 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' },
  });
});

/** Save my signature: JSON { image: "data:image/png;base64,…" } */
export const PUT = withUser(async (me, req) => {
  const body = (await req.json().catch(() => ({}))) as { image?: string };
  const png = pngFromDataUrl(body.image);
  return { data: await withCtx(me, (ctx) => saveMySignature(ctx, png)) };
});

export const DELETE = withUser(async (me) => ({ data: await withCtx(me, (ctx) => saveMySignature(ctx, null)) }));
