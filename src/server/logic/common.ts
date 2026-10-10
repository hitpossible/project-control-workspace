import type { Ctx } from '../db';
import { inList, uuid } from '../db';

// ---------------------------------------------------------------------
// Numbering (was next_sequence / generate_code)
// ---------------------------------------------------------------------
export async function nextSequence(ctx: Ctx, scope: string): Promise<number> {
  await ctx.exec(
    'INSERT INTO doc_sequences(scope, last_value) VALUES (?, LAST_INSERT_ID(1)) ON DUPLICATE KEY UPDATE last_value = LAST_INSERT_ID(last_value + 1)',
    [scope]);
  return Number(await ctx.val('SELECT LAST_INSERT_ID()'));
}

/** Format tokens: {TYPE} {YYYY} {YY} {SEQ:n}. Sequence scope = format with SEQ removed. */
export async function generateCode(ctx: Ctx, format: string, type: string | null): Promise<string> {
  const width = Number(/\{SEQ:(\d+)\}/.exec(format)?.[1] ?? 3);
  const yyyy = ctx.today.slice(0, 4);
  let fmt = format.replaceAll('{YYYY}', yyyy).replaceAll('{YY}', yyyy.slice(2));
  fmt = type ? fmt.replaceAll('{TYPE}', type) : fmt.replaceAll('-{TYPE}', '').replaceAll('{TYPE}', '');
  const scope = fmt.replace(/\{SEQ:\d+\}/g, '#');
  const seq = await nextSequence(ctx, scope);
  return fmt.replace(/\{SEQ:\d+\}/g, String(seq).padStart(width, '0'));
}

export async function settingValue<T>(ctx: Ctx, key: string, fallback: T): Promise<T> {
  const v = await ctx.val<T>('SELECT value FROM app_settings WHERE `key` = ?', [key]);
  return v ?? fallback;
}

// ---------------------------------------------------------------------
// Notification engine (was notify_event) — in-app + e-mail outbox, rule based, with escalation
// ---------------------------------------------------------------------
type Rule = { recipient_roles: string[]; channels: string[]; is_active: boolean; escalate_roles: string[] };

export async function notifyEvent(ctx: Ctx, e: {
  event: string; projectId?: string | null; requestId?: string | null; explicit?: (string | null | undefined)[] | null;
  title: string; body?: string | null; link?: string | null; dedupe?: string | null; escalate?: boolean;
}): Promise<number> {
  const rule = (await ctx.one<Rule>('SELECT recipient_roles, channels, is_active, escalate_roles FROM notification_rules WHERE event_code = ?', [e.event]))
    ?? { recipient_roles: ['explicit'], channels: ['in_app'], is_active: true, escalate_roles: [] };
  if (!rule.is_active) return 0;

  const roles = [...rule.recipient_roles, ...(e.escalate ? rule.escalate_roles ?? [] : [])];
  const users = new Set<string>();
  if (roles.includes('explicit')) for (const u of e.explicit ?? []) if (u) users.add(u);
  if (e.projectId) {
    const memberRoles = roles.filter((r) => r !== 'explicit');
    if (memberRoles.length) {
      const [ph, params] = inList(memberRoles);
      for (const m of await ctx.q<{ user_id: string }>(
        `SELECT DISTINCT user_id FROM project_members WHERE project_id = ? AND notify = 1 AND member_role IN (${ph})`, [e.projectId, ...params])) users.add(m.user_id);
    }
    if (roles.includes('leader')) {
      const leader = await ctx.val<string>('SELECT leader_id FROM projects WHERE id = ?', [e.projectId]);
      if (leader) users.add(leader);
    }
  }

  const title = e.escalate ? `⚠ ESCALATION — ${e.title}` : e.title;
  let count = 0;
  for (const uid of users) {
    const id = uuid();
    // IGNORE: the (user_id, dedupe_key) unique key drops repeats (affectedRows 0)
    const res = await ctx.exec(
      `INSERT IGNORE INTO notifications(id, user_id, event_code, project_id, request_id, title, body, link, dedupe_key)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [id, uid, e.event, e.projectId ?? null, e.requestId ?? null, title, e.body ?? null, e.link ?? null, e.dedupe ?? null]);
    if (res.affectedRows !== 1) continue; // deduplicated
    count++;
    if (rule.channels.includes('email')) {
      const email = await ctx.val<string>('SELECT email FROM profiles WHERE id = ?', [uid]);
      if (email) {
        await ctx.exec('INSERT INTO email_outbox(id, notification_id, to_email, subject, body) VALUES (?,?,?,?,?)',
          [uuid(), id, email, `[Project Control] ${e.escalate ? 'ESCALATION — ' : ''}${e.title}`, `${e.body ?? ''}\n\n${e.link ?? ''}`]);
      }
    }
  }
  return count;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** 'YYYY-MM-DD' → 'DD Mon YYYY' (was to_char(d, 'DD Mon YYYY')) */
export function fmtD(d: string | null | undefined, withYear = true): string {
  if (!d) return '-';
  const [y, m, day] = d.slice(0, 10).split('-');
  return `${day} ${MONTHS[Number(m) - 1]}${withYear ? ` ${y}` : ''}`;
}
