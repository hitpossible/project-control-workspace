import { NextResponse } from 'next/server';
import { errorResponse } from '@/server/api';
import { currentSession } from '@/server/auth';
import { withCtx } from '@/server/db';
import { loadSrs } from '@/server/srs';
import { subscribeSrs } from '@/server/srs-bus';
import { eventStream } from '@/server/sse';

// Server-Sent Events for an open SRS: tells the page to reload when someone signs, sends it back, or it is sent / cancelled
export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await currentSession();
  if (!session) return NextResponse.json({ error: { message: 'Not signed in', status: 401 } }, { status: 401 });
  const id = Number((await params).id);
  try {
    await withCtx(session.me, (ctx) => loadSrs(ctx, id));
  } catch (e) {
    return errorResponse(e);
  }
  return eventStream(req, session, (send) => subscribeSrs(id, (e) => send(e.type, e)));
}
