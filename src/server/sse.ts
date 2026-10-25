import type { Session } from './auth';
import { sessionStillValid } from './auth';

/**
 * Server-Sent Events response shared by the live streams (notifications, diagram editor, SRS).
 * `subscribe` gets a `send(event, data)` and returns its unsubscribe. Besides the keep-alive ping, the session is
 * re-checked every minute: once it is revoked, expired or the user deactivated, the stream says `signed-out` and closes
 * (the browser's reconnect then gets 401).
 */
const encoder = new TextEncoder();
const PING_MS = 25_000;
const SESSION_CHECK_MS = Number(process.env.SSE_SESSION_CHECK_SECONDS ?? 60) * 1000;

export function eventStream(req: Request, session: Session, subscribe: (send: (event: string, data: unknown) => void) => () => void): Response {
  let cleanup = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const write = (chunk: string) => {
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          cleanup(); // stream already closed
        }
      };
      write('retry: 5000\n\n');
      const unsubscribe = subscribe((event, data) => write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      // comment line keeps proxies from closing an idle connection
      const ping = setInterval(() => write(': ping\n\n'), PING_MS);
      const check = setInterval(() => {
        sessionStillValid(session).then((ok) => {
          if (ok) return;
          write('event: signed-out\ndata: {}\n\n');
          cleanup();
        }, (e) => console.warn('[sse] session check failed:', e instanceof Error ? e.message : e)); // DB hiccup: keep the stream, try again next time
      }, SESSION_CHECK_MS);
      cleanup = () => {
        clearInterval(ping);
        clearInterval(check);
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
