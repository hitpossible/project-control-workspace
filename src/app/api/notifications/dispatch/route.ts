import { NextResponse } from 'next/server';
import { errorResponse } from '@/server/api';
import { currentUser } from '@/server/auth';
import { sendQueuedEmails } from '@/server/mail';

// Delivers queued e-mail notifications. Callable by any signed-in user (fire-and-forget after actions)
// or by an external scheduler with header x-cron-secret. The in-process scheduler also runs it every minute.
export async function POST(req: Request) {
  try {
    const secret = process.env.CRON_SECRET;
    const viaCron = !!secret && req.headers.get('x-cron-secret') === secret;
    if (!viaCron && !(await currentUser())) return NextResponse.json({ error: { message: 'Unauthorized' } }, { status: 401 });
    return NextResponse.json({ sent: await sendQueuedEmails() });
  } catch (e) {
    return errorResponse(e);
  }
}
