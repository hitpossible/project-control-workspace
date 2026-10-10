import { NextResponse } from 'next/server';
import nodemailer from 'nodemailer';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { supabaseServer } from '@/lib/supabase/server';

// Delivers queued e-mail notifications (email_outbox). Callable by any signed-in user
// (fire-and-forget after actions) or by a scheduler with header x-cron-secret.
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  const viaCron = !!secret && req.headers.get('x-cron-secret') === secret;
  if (!viaCron) {
    const { data } = await (await supabaseServer()).auth.getUser();
    if (!data.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = supabaseAdmin();
  const { data: queue } = await admin.from('email_outbox').select('*').eq('status', 'queued').order('created_at').limit(50);
  if (!queue?.length) return NextResponse.json({ sent: 0 });

  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT ?? 25),
    secure: false,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  });
  const appUrl = process.env.APP_URL ?? 'http://localhost:3000';

  let sent = 0;
  for (const m of queue) {
    // claim the row so parallel calls don't double-send
    const { data: claimed } = await admin.from('email_outbox').update({ status: 'sent', sent_at: new Date().toISOString() })
      .eq('id', m.id).eq('status', 'queued').select('id');
    if (!claimed?.length) continue;
    const body = String(m.body ?? '').replace(/(^|\n)(\/[^\s]*)$/, (_: string, p: string, path: string) => `${p}${appUrl}${path}`);
    try {
      await transport.sendMail({ from: process.env.MAIL_FROM, to: m.to_email, subject: m.subject, text: body });
      sent++;
    } catch (e) {
      await admin.from('email_outbox').update({ status: 'failed', error: String(e) }).eq('id', m.id);
    }
  }
  return NextResponse.json({ sent });
}
