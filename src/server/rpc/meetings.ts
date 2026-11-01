import {
  buildIcs, formatWhen, INVITE_KINDS, isEmail, meetingDetailsText, parseMeetingInput, parseMomInput, normalizeAttendees,
  type Attendee, type InviteKind, type MailLang, type ProjectMeeting,
} from '@/lib/meetings';
import type { InternalTask } from '@/lib/types';
import { AppError, type Ctx } from '../db';
import { deleteRow, insertRow, updateRow } from '../engine';
import { nextSequence, notifyEvent } from '../logic/common';
import { canManageProject, isProjectMember } from '../perms';

/**
 * Project meetings: scheduled rounds with agenda and attendees, the invitation e-mails (queued in email_outbox, logged in
 * meeting_invitations), the MOM, and conversion of action items into tasks. Pure logic: src/lib/meetings.ts.
 * Writing = the project team or leader; reading = anyone who can see the project (policies.ts). The AI draft is a route
 * (/api/projects/[id]/meeting-ai) — nothing is sent until the user confirms the text here.
 */
const TEAM_ROLES = ['leader', 'developer', 'qa', 'support', 'supervisor', 'manager'];

export async function canWriteMeetings(ctx: Ctx, projectId: number) {
  return (await canManageProject(ctx, projectId)) || (await isProjectMember(ctx, projectId, TEAM_ROLES));
}

async function writable(ctx: Ctx, projectId: number) {
  if (!(await ctx.val('SELECT 1 FROM projects WHERE id = ?', [projectId]))) throw new AppError('Project not found', 404);
  if (!(await canWriteMeetings(ctx, projectId))) throw new AppError('Only the project team can manage meetings', 403);
}

async function lockMeeting(ctx: Ctx, id: unknown): Promise<ProjectMeeting> {
  const m = await ctx.one<ProjectMeeting>('SELECT * FROM project_meetings WHERE id = ? FOR UPDATE', [Number(id)]);
  if (!m) throw new AppError('Meeting not found', 404);
  await writable(ctx, m.project_id);
  return m;
}

const guard = <T>(fn: () => T): T => {
  try {
    return fn();
  } catch (e) {
    throw new AppError(e instanceof Error ? e.message : String(e));
  }
};

/** Internal attendees take their name and e-mail from the directory, never from the browser */
async function resolveAttendees(ctx: Ctx, list: Attendee[]): Promise<Attendee[]> {
  const out: Attendee[] = [];
  for (const a of list) {
    if (!a.user_id) { out.push(a); continue; }
    const p = await ctx.one<{ full_name: string; email: string | null }>('SELECT full_name, email FROM profiles WHERE id = ? AND is_active = 1', [a.user_id]);
    if (!p) throw new AppError(`User ${a.name} is not an active user`);
    out.push({ ...a, name: p.full_name, email: p.email?.toLowerCase() ?? null });
  }
  return out;
}

/** Create (no p_id) or update the plan of a meeting */
export async function saveMeeting(ctx: Ctx, a: Record<string, unknown> & { p_project_id?: number; p_id?: number }) {
  const row = guard(() => parseMeetingInput(a));
  const attendees = await resolveAttendees(ctx, row.attendees);
  if (a.p_id) {
    const cur = await lockMeeting(ctx, a.p_id);
    return ctx.asWorkflow(() => updateRow(ctx, 'project_meetings', cur.id, { ...row, attendees }));
  }
  const pid = Number(a.p_project_id);
  if (!pid) throw new AppError('p_project_id is required');
  await writable(ctx, pid);
  return ctx.asWorkflow(async () => insertRow(ctx, 'project_meetings', {
    ...row, attendees, project_id: pid, meeting_no: await nextSequence(ctx, `mtg:${pid}`), organizer_id: Number(a.p_organizer_id) || ctx.uid,
  }));
}

async function checkedActions(ctx: Ctx, actions: ReturnType<typeof parseMomInput>['actions']) {
  for (const x of actions) {
    if (x.owner_id && !(await ctx.val('SELECT 1 FROM profiles WHERE id = ? AND is_active = 1', [x.owner_id]))) x.owner_id = null;
  }
  return actions;
}

/** Record the MOM (and who attended); a planned meeting becomes "held" */
export async function saveMeetingMom(ctx: Ctx, a: Record<string, unknown> & { p_id: number }) {
  const cur = await lockMeeting(ctx, a.p_id);
  if (cur.status === 'cancelled') throw new AppError('A cancelled meeting has no minutes');
  const mom = guard(() => parseMomInput(a));
  const attendees = a.p_attendees === undefined ? cur.attendees : await resolveAttendees(ctx, guard(() => normalizeAttendees(a.p_attendees)));
  // keep the link to tasks already made from an action item
  const linked = new Map(cur.mom_actions.filter((x) => x.task_id).map((x) => [x.text, x.task_id]));
  const actions = (await checkedActions(ctx, mom.actions)).map((x) => ({ ...x, task_id: x.task_id ?? linked.get(x.text) ?? null }));
  return ctx.asWorkflow(() => updateRow(ctx, 'project_meetings', cur.id, {
    status: 'held', attendees, mom_summary: mom.summary, mom_discussion: mom.discussion, mom_decisions: mom.decisions,
    mom_actions: actions, mom_questions: mom.questions, mom_info: mom.info,
    mom_recorded_at: cur.mom_recorded_at ?? new Date().toISOString(), mom_recorded_by: ctx.uid,
  }));
}

export async function deleteMeeting(ctx: Ctx, a: { p_id: number }) {
  const m = await lockMeeting(ctx, a.p_id);
  if (m.mom_actions.some((x) => x.task_id)) throw new AppError('Tasks were created from this meeting — cancel it instead of deleting it');
  await ctx.asWorkflow(() => deleteRow(ctx, 'project_meetings', m.id));
  return { id: m.id };
}

type Recipient = { name: string; email: string };

/**
 * Queue the e-mail the user has reviewed — invitation / update / cancellation (with a calendar file) or the MOM — to the
 * chosen attendees, and log it. Only addresses of the meeting's attendees can be chosen.
 */
export async function sendMeetingEmail(ctx: Ctx, a: {
  p_id: number; p_kind: InviteKind; p_subject: string; p_body: string; p_recipients: Recipient[]; p_attach_ics?: boolean; p_ai_drafted?: boolean; p_lang?: MailLang;
}) {
  const m = await lockMeeting(ctx, a.p_id);
  const kind = a.p_kind;
  if (!(INVITE_KINDS as readonly string[]).includes(kind)) throw new AppError('Unknown e-mail kind');
  if (kind === 'mom' ? m.status !== 'held' : kind === 'cancel' ? m.status !== 'cancelled' : m.status !== 'planned') {
    throw new AppError(kind === 'mom' ? 'Record the minutes before sending them' : kind === 'cancel' ? 'Cancel the meeting first' : 'Only a planned meeting can be sent an invitation');
  }
  const subject = String(a.p_subject ?? '').trim();
  const body = String(a.p_body ?? '').trim();
  if (!subject || subject.length > 300) throw new AppError('Subject is required (max 300 characters)');
  if (!body || body.length > 20000) throw new AppError('Message is required (max 20000 characters)');

  const allowed = new Map(m.attendees.filter((x) => x.email && isEmail(x.email)).map((x) => [x.email!.toLowerCase(), x]));
  const seen = new Set<string>();
  const to: Recipient[] = [];
  for (const r of a.p_recipients ?? []) {
    const email = String(r?.email ?? '').trim().toLowerCase();
    const at = allowed.get(email);
    if (!at) throw new AppError(`${email || 'This address'} is not an attendee of the meeting`);
    if (!seen.has(email)) { seen.add(email); to.push({ name: at.name, email }); }
  }
  if (!to.length) throw new AppError('Choose at least one recipient with an e-mail address');

  const lang: MailLang = a.p_lang === 'en' ? 'en' : 'th';
  const project = (await ctx.one<{ project_code: string; project_name: string }>('SELECT project_code, project_name FROM projects WHERE id = ?', [m.project_id]))!;
  const organizer = await ctx.one<{ full_name: string; email: string | null }>('SELECT full_name, email FROM profiles WHERE id = ?', [m.organizer_id ?? ctx.uid]);
  const withIcs = a.p_attach_ics !== false && kind !== 'mom' && !!organizer?.email;
  const sequence = Number(await ctx.val('SELECT COUNT(*) FROM meeting_invitations WHERE meeting_id = ? AND kind <> \'mom\'', [m.id]));
  const ics = withIcs
    ? buildIcs({
      uid: `meeting-${m.id}@pcw`, method: kind === 'cancel' ? 'CANCEL' : 'REQUEST', sequence,
      title: `[${project.project_code}] ${m.title}`, description: `${project.project_name}\n${meetingDetailsText(m, lang)}`,
      location: [m.location, m.online_link].filter(Boolean).join(' | ') || null, start_at: m.start_at, end_at: m.end_at,
      organizer: { name: organizer!.full_name, email: organizer!.email! }, attendees: to,
    })
    : null;
  // a trailing /path line is turned into a full link by the mail sender
  const text = kind === 'cancel' ? body : `${body}\n\n/projects/${m.project_id}?tab=meetings`;

  return ctx.asWorkflow(async () => {
    for (const r of to) await ctx.exec('INSERT INTO email_outbox(to_email, subject, body, ics) VALUES (?,?,?,?)', [r.email, subject, text, ics]);
    const row = await insertRow(ctx, 'meeting_invitations', {
      meeting_id: m.id, project_id: m.project_id, kind, recipients: to, subject, body, with_ics: !!ics, ai_drafted: a.p_ai_drafted === true,
    });
    const internal = [...new Set(m.attendees.filter((x) => x.user_id && seen.has(x.email?.toLowerCase() ?? '') && x.user_id !== ctx.uid).map((x) => x.user_id!))];
    if (internal.length) {
      await notifyEvent(ctx, {
        event: `meeting_${kind}`, projectId: m.project_id, explicit: internal, title: `${subject}`,
        body: `${project.project_code} — ${formatWhen(m.start_at, m.end_at, lang)}`, link: `/projects/${m.project_id}?tab=meetings`,
      });
    }
    return { sent: to.length, invitation_id: (row as { id: number }).id };
  });
}

/** Turn action items of the MOM into tasks of the internal plan; the caller (dialog) has shown what will be created */
export async function convertMeetingActionsToTasks(ctx: Ctx, a: {
  p_id: number; p_indexes: number[]; p_activity_id: number; p_owner_id: number; p_due_date: string;
}) {
  const m = await lockMeeting(ctx, a.p_id);
  if (!(await canManageProject(ctx, m.project_id))) throw new AppError('Only the Project Leader can create tasks', 403);
  const idx = [...new Set((a.p_indexes ?? []).map(Number).filter((i) => Number.isInteger(i) && i >= 0 && i < m.mom_actions.length))];
  if (!idx.length) throw new AppError('Select at least one action item');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(a.p_due_date)) || Number.isNaN(Date.parse(a.p_due_date))) throw new AppError('Due date must be YYYY-MM-DD');
  if (a.p_due_date < ctx.today) throw new AppError('Due date cannot be in the past');
  if (!(await ctx.val('SELECT 1 FROM activities WHERE id = ? AND project_id = ?', [a.p_activity_id, m.project_id]))) throw new AppError('Choose an activity of this project');
  if (!(await ctx.val('SELECT 1 FROM profiles WHERE id = ? AND is_active = 1', [a.p_owner_id]))) throw new AppError('Choose an active owner');

  return ctx.asWorkflow(async () => {
    const actions = m.mom_actions.map((x) => ({ ...x }));
    const created: InternalTask[] = [];
    for (const i of idx) {
      const x = actions[i];
      if (x.task_id) continue;
      const task = (await insertRow(ctx, 'internal_tasks', {
        project_id: m.project_id, activity_id: Number(a.p_activity_id), owner_id: x.owner_id ?? Number(a.p_owner_id),
        due_date: x.due_date && x.due_date >= ctx.today ? x.due_date : a.p_due_date, name: x.text.split('\n')[0].slice(0, 300), task_type: 'other', priority: 'medium',
        description: `From meeting #${m.meeting_no} "${m.title}" (${m.start_at.slice(0, 10)}):\n${x.text}`, created_by: ctx.uid,
      })) as unknown as InternalTask;
      x.task_id = task.id;
      created.push(task);
    }
    if (created.length) await updateRow(ctx, 'project_meetings', m.id, { mom_actions: actions });
    return { created: created.length, skipped: idx.length - created.length, task_ids: created.map((t) => t.id) };
  });
}
