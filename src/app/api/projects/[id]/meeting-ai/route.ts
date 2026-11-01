import { fallbackInvitation, momEmail, type MailLang, type ProjectMeeting } from '@/lib/meetings';
import { aiEnabled, draftMeetingMail, structureMom } from '@/server/ai';
import { withUser } from '@/server/api';
import { AppError, withCtx } from '@/server/db';
import { canWriteMeetings } from '@/server/rpc/meetings';

/**
 * AI help for meetings. Nothing is saved or sent here — the browser shows the draft and the user edits it first.
 *   kind "invitation": subject + body of the invitation / update / cancellation e-mail (the plain template when the AI is off or plain: true)
 *   kind "mom_mail":   the e-mail that sends the minutes (always the plain template)
 *   kind "mom":        structured MOM suggested from rough notes; { off: true } when the AI is not set up
 */
export const POST = withUser(async (me, req, params) => {
  const pid = Number(params.id);
  const b = (await req.json().catch(() => ({}))) as { kind?: string; meeting_id?: unknown; mail_kind?: string; plain?: boolean; lang?: string; notes?: unknown };
  const lang: MailLang = b.lang === 'en' ? 'en' : 'th';
  const c = await withCtx(me, async (ctx) => {
    if (!(await canWriteMeetings(ctx, pid))) throw new AppError('Only the project team can manage meetings', 403);
    const m = await ctx.one<ProjectMeeting>('SELECT * FROM project_meetings WHERE id = ? AND project_id = ?', [Number(b.meeting_id), pid]);
    if (!m) throw new AppError('Meeting not found', 404);
    const p = await ctx.one<{ project_code: string; project_name: string; request_id: number | null }>('SELECT project_code, project_name, request_id FROM projects WHERE id = ?', [pid]);
    const organizer = await ctx.val<string>('SELECT full_name FROM profiles WHERE id = ?', [m.organizer_id ?? ctx.uid]);
    const request = p?.request_id ? await ctx.one<{ description: string | null }>('SELECT description FROM project_requests WHERE id = ?', [p.request_id]) : null;
    return { m, project: { code: p!.project_code, name: p!.project_name }, organizer: organizer ?? me.full_name, summary: request?.description?.slice(0, 600) ?? null, today: ctx.today };
  });

  if (b.kind === 'mom_mail') return { data: momEmail({ ...c.m, summary: c.m.mom_summary, discussion: c.m.mom_discussion, decisions: c.m.mom_decisions, actions: c.m.mom_actions, questions: c.m.mom_questions }, c.project, c.organizer, lang) };
  if (b.kind === 'invitation') {
    const kind = b.mail_kind === 'update' || b.mail_kind === 'cancel' ? b.mail_kind : 'invite';
    if (b.plain === true) return { data: { ...fallbackInvitation(kind, c.m, c.project, c.organizer, lang), ai: false } };
    return { data: await draftMeetingMail({ kind, lang, project: c.project, summary: c.summary, meeting: c.m, organizer: c.organizer }) };
  }
  if (b.kind === 'mom') {
    const notes = typeof b.notes === 'string' ? b.notes.trim().slice(0, 20000) : '';
    if (!notes) throw new AppError('Write some rough notes first');
    if (!aiEnabled()) return { data: { off: true } };
    const out = await structureMom({ lang, today: c.today, project: c.project, meeting: c.m, attendees: c.m.attendees, notes });
    if (!out) throw new AppError('The AI could not structure the notes — please try again', 502);
    return { data: out };
  }
  throw new AppError('Unknown request');
});
