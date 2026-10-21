import { NextResponse } from 'next/server';
import { currentUser } from '@/server/auth';
import { subscribeNotifications } from '@/server/notify-bus';

// Server-Sent Events: pushes the signed-in user's new notifications as they are created.
// The browser reconnects on its own (EventSource); the 30 s unread poll stays as the fallback.
export const dynamic = 'force-dynamic';

const encoder = new TextEncoder();

export async function GET(req: Request) {
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: { message: 'Not signed in', status: 401 } }, { status: 401 });

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
      const unsubscribe = subscribeNotifications(me.id, (n) => send(`event: notification\ndata: ${JSON.stringify(n)}\n\n`));
      // comment line keeps proxies from closing an idle connection
      const ping = setInterval(() => send(': ping\n\n'), 25000);
      cleanup = () => {
        clearInterval(ping);
        unsubscribe();
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
