import { NextResponse } from 'next/server';
import { currentSession } from '@/server/auth';
import { subscribeNotifications } from '@/server/notify-bus';
import { eventStream } from '@/server/sse';

// Server-Sent Events: pushes the signed-in user's new notifications as they are created.
// The browser reconnects on its own (EventSource); the 30 s unread poll stays as the fallback.
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const session = await currentSession();
  if (!session) return NextResponse.json({ error: { message: 'Not signed in', status: 401 } }, { status: 401 });
  return eventStream(req, session, (send) => subscribeNotifications(session.me.id, (n) => send('notification', n)));
}
