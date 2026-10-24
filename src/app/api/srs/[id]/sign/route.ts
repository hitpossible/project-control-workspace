import { withUser } from '@/server/api';
import { withCtx } from '@/server/db';
import { pngFromDataUrl, signSrs } from '@/server/srs';

/** Approve and sign: JSON { name_image } (the signer's name + position drawn by the browser as PNG) */
export const POST = withUser(async (me, req, params) => {
  const body = (await req.json().catch(() => ({}))) as { name_image?: string | null };
  const nameImage = body.name_image ? pngFromDataUrl(body.name_image) : null;
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || null;
  const data = await withCtx(me, (ctx) => signSrs(ctx, { srsId: Number(params.id), nameImage, ip, userAgent: req.headers.get('user-agent') }));
  return { data };
});
