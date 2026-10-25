import { NextResponse } from 'next/server';
import { errorResponse } from '@/server/api';
import { currentSession } from '@/server/auth';
import { AppError, withCtx } from '@/server/db';
import { openDiagram } from '@/server/diagram-bus';
import { loadDiagram, tabId } from '@/server/diagrams';
import { eventStream } from '@/server/sse';

// Server-Sent Events for one open diagram editor: who else has it open, and saves / deletes by others.
export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await currentSession();
  if (!session) return NextResponse.json({ error: { message: 'Not signed in', status: 401 } }, { status: 401 });
  const { me } = session;
  const id = Number((await params).id);
  const tab = tabId(new URL(req.url).searchParams.get('tab'));
  try {
    if (!tab) throw new AppError('tab is required');
    await withCtx(me, (ctx) => loadDiagram(ctx, id));
  } catch (e) {
    return errorResponse(e);
  }
  return eventStream(req, session, (send) => openDiagram(id, { tab: tab!, userId: me.id, name: me.full_name }, (e) => send(e.type, e)));
}
