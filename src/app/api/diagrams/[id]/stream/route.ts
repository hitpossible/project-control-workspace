import { NextResponse } from 'next/server';
import { currentUser } from '@/server/auth';
import { AppError, withCtx } from '@/server/db';
import { openDiagram } from '@/server/diagram-bus';
import { loadDiagram, tabId } from '@/server/diagrams';
import { errorResponse } from '@/server/api';

// Server-Sent Events for one open diagram editor: who else has it open, and saves / deletes by others.
export const dynamic = 'force-dynamic';

const encoder = new TextEncoder();

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: { message: 'Not signed in', status: 401 } }, { status: 401 });
  const id = Number((await params).id);
  const tab = tabId(new URL(req.url).searchParams.get('tab'));
  try {
    if (!tab) throw new AppError('tab is required');
    await withCtx(me, (ctx) => loadDiagram(ctx, id));
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
      const close = openDiagram(id, { tab, userId: me.id, name: me.full_name }, (e) => send(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`));
      // comment line keeps proxies from closing an idle connection
      const ping = setInterval(() => send(': ping\n\n'), 25000);
      cleanup = () => {
        clearInterval(ping);
        close();
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
