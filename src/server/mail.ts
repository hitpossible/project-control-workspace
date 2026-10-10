import nodemailer from 'nodemailer';
import { pool } from './db';

/** Deliver queued e-mail notifications (email_outbox). Safe to run concurrently: rows are claimed first. */
export async function sendQueuedEmails(limit = 50): Promise<number> {
  const db = pool();
  const [rows] = await db.query(`SELECT * FROM email_outbox WHERE status = 'queued' ORDER BY created_at LIMIT ?`, [limit]);
  const queue = rows as { id: string; to_email: string; subject: string; body: string | null }[];
  if (!queue.length || !process.env.SMTP_HOST) return 0;

  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT ?? 25),
    secure: process.env.SMTP_SECURE === 'true',
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  });
  const appUrl = process.env.APP_URL ?? 'http://localhost:3000';
  let sent = 0;
  for (const m of queue) {
    // claim the row so parallel runs don't double-send
    const [claim] = await db.query(`UPDATE email_outbox SET status = 'sent', sent_at = UTC_TIMESTAMP(3) WHERE id = ? AND status = 'queued'`, [m.id]);
    if ((claim as { changedRows: number }).changedRows !== 1) continue;
    const body = String(m.body ?? '').replace(/(^|\n)(\/[^\s]*)$/, (_: string, p: string, path: string) => `${p}${appUrl}${path}`);
    try {
      await transport.sendMail({ from: process.env.MAIL_FROM, to: m.to_email, subject: m.subject, text: body });
      sent++;
    } catch (e) {
      await db.query(`UPDATE email_outbox SET status = 'failed', error = ? WHERE id = ?`, [String(e), m.id]);
    }
  }
  return sent;
}
