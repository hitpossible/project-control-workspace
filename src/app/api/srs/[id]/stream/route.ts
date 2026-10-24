import { NextResponse } from 'next/server';
import { errorResponse } from '@/server/api';
import { currentUser } from '@/server/auth';
import { withCtx } from '@/server/db';
import { loadSrs } from '@/server/srs';
import { subscribeSrs } from '@/server/srs-bus';

// Server-Sent Events for an open SRS: tells the page to reload when someone signs, sends it back, or it is sent / cancelled
export const dynamic = 'force-dynamic';

const encoder = new TextEncoder();

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: { message: 'Not signed in', status: 401 } }, { status: 401 });
  const id = Number((await params).id);
  try {
    await withCtx(me, (ctx) => loadSrs(ctx, id));
  } catch (e) {
    return errorResponse(e);
  }

  let cleanup = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (chunk: string) => {
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          cleanup(); // stream already closed
        }
      };
      send('retry: 5000\n\n');
      const off = subscribeSrs(id, (e) => send(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`));
      // comment line keeps proxies from closing an idle connection
      const ping = setInterval(() => send(': ping\n\n'), 25000);
      cleanup = () => {
        clearInterval(ping);
        off();
        cleanup = () => {};
        try {
          controller.close();
        } catch {
          // already closed
        }
      };
      req.signal.addEventListener('abort', () => cleanup());
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // disable nginx buffering
    },
  });
}
