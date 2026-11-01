/**
 * Project meetings — pure logic shared by the server (validation, e-mail, calendar file, AI replies) and the UI.
 * Stored in project_meetings (db/migrations/029); workflow in src/server/rpc/meetings.ts.
 */
export const MEETING_TYPES = ['kickoff', 'requirement', 'review', 'uat', 'status', 'other'] as const;
export const MEETING_STATUSES = ['planned', 'held', 'cancelled'] as const;
export const INVITE_KINDS = ['invite', 'update', 'cancel', 'mom'] as const;
export type MeetingType = (typeof MEETING_TYPES)[number];
export type MeetingStatus = (typeof MEETING_STATUSES)[number];
export type InviteKind = (typeof INVITE_KINDS)[number];
export type MailLang = 'th' | 'en';

export interface AgendaItem { title: string; minutes: number | null }
export interface Attendee { user_id: number | null; name: string; email: string | null; attended: boolean }
export interface DiscussionPoint { topic: string; notes: string }
export interface ActionItem { text: string; owner_id: number | null; owner_name: string | null; due_date: string | null; task_id: number | null }
export interface InfoItem { topic: string; detail: string }

export interface ProjectMeeting {
  id: number;
  project_id: number;
  meeting_no: number;
  title: string;
  meeting_type: MeetingType;
  status: MeetingStatus;
  start_at: string;
  end_at: string;
  location: string | null;
  online_link: string | null;
  organizer_id: number | null;
  purpose: string | null;
  agenda: AgendaItem[];
  attendees: Attendee[];
  mom_summary: string | null;
  mom_discussion: DiscussionPoint[];
  mom_decisions: string[];
  mom_actions: ActionItem[];
  mom_questions: string[];
  mom_info: InfoItem[];
  mom_recorded_at: string | null;
  mom_recorded_by: number | null;
  created_at: string;
  updated_at: string;
}

export interface MeetingInvitation {
  id: number;
  meeting_id: number;
  project_id: number;
  kind: InviteKind;
  recipients: { name: string; email: string }[];
  subject: string;
  body: string;
  with_ics: boolean;
  ai_drafted: boolean;
  sent_by: number | null;
  sent_at: string;
}

export const MAX_ATTENDEES = 60;
const MAX_LIST = 50;
const EMAIL = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;
export const isEmail = (s: string) => s.length <= 191 && EMAIL.test(s);

const clip = (v: unknown, max: number): string => (v === null || v === undefined ? '' : String(v).trim().slice(0, max));
const orNull = (s: string) => (s === '' ? null : s);
const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const rec = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});
const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

/** Agenda: ordered topics with an optional time box in minutes; blank titles dropped */
export function normalizeAgenda(v: unknown): AgendaItem[] {
  const out: AgendaItem[] = [];
  for (const raw of asArray(v).slice(0, MAX_LIST)) {
    const o = typeof raw === 'string' ? { title: raw } : rec(raw);
    const title = clip(o.title, 300);
    if (!title) continue;
    const m = Number(o.minutes);
    out.push({ title, minutes: Number.isFinite(m) && m > 0 && m <= 1440 ? Math.round(m) : null });
  }
  return out;
}

/** Attendees: internal users (user_id) and external e-mails; one entry per user / e-mail; an invalid e-mail is an error */
export function normalizeAttendees(v: unknown): Attendee[] {
  const out: Attendee[] = [];
  const seen = new Set<string>();
  for (const raw of asArray(v)) {
    const o = rec(raw);
    const userId = Number(o.user_id) || null;
    const email = clip(o.email, 191).toLowerCase();
    const name = clip(o.name, 200);
    if (email && !isEmail(email)) throw new Error(`"${email}" is not a valid e-mail address`);
    if (!userId && !email) continue;
    if (!userId && !name && !email) continue;
    const key = userId ? `u${userId}` : `e${email}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ user_id: userId, name: name || email, email: orNull(email), attended: o.attended === true });
  }
  if (out.length > MAX_ATTENDEES) throw new Error(`At most ${MAX_ATTENDEES} attendees`);
  return out;
}

export function normalizeDiscussion(v: unknown): DiscussionPoint[] {
  return asArray(v).slice(0, MAX_LIST).map((raw) => rec(raw)).map((o) => ({ topic: clip(o.topic, 300), notes: clip(o.notes, 6000) }))
    .filter((d) => d.topic || d.notes);
}

export function normalizeStrings(v: unknown, max = 1000): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of asArray(v).slice(0, MAX_LIST)) {
    const s = clip(typeof raw === 'object' && raw ? rec(raw).text : raw, max);
    if (s && !seen.has(s.toLowerCase())) { seen.add(s.toLowerCase()); out.push(s); }
  }
  return out;
}

export function normalizeInfo(v: unknown): InfoItem[] {
  return asArray(v).slice(0, MAX_LIST).map((raw) => rec(raw)).map((o) => ({ topic: clip(o.topic, 300), detail: clip(o.detail, 4000) }))
    .filter((i) => i.topic || i.detail);
}

export function normalizeActions(v: unknown): ActionItem[] {
  const out: ActionItem[] = [];
  for (const raw of asArray(v).slice(0, MAX_LIST)) {
    const o = typeof raw === 'string' ? { text: raw } : rec(raw);
    const text = clip(o.text, 1000);
    if (!text) continue;
    const due = clip(o.due_date, 10);
    if (due && !isDate(due)) throw new Error(`Due date "${due}" must be YYYY-MM-DD`);
    out.push({ text, owner_id: Number(o.owner_id) || null, owner_name: orNull(clip(o.owner_name, 200)), due_date: orNull(due), task_id: Number(o.task_id) || null });
  }
  return out;
}

export interface MeetingInput {
  title: string; meeting_type: MeetingType; status: MeetingStatus; start_at: string; end_at: string;
  location: string | null; online_link: string | null; purpose: string | null; agenda: AgendaItem[]; attendees: Attendee[];
}

/** Validate the planning fields of a meeting; throws an Error with a message fit for the user */
export function parseMeetingInput(a: Record<string, unknown>): MeetingInput {
  const title = clip(a.p_title, 300);
  if (!title) throw new Error('Title is required');
  const type = clip(a.p_meeting_type, 20) || 'requirement';
  if (!(MEETING_TYPES as readonly string[]).includes(type)) throw new Error(`Type must be one of ${MEETING_TYPES.join(', ')}`);
  const status = clip(a.p_status, 20) || 'planned';
  if (!(MEETING_STATUSES as readonly string[]).includes(status)) throw new Error(`Status must be one of ${MEETING_STATUSES.join(', ')}`);
  const start = new Date(String(a.p_start_at ?? ''));
  if (!a.p_start_at || Number.isNaN(start.getTime())) throw new Error('Start time is required');
  const end = a.p_end_at ? new Date(String(a.p_end_at)) : new Date(start.getTime() + 3600_000);
  if (Number.isNaN(end.getTime())) throw new Error('End time is not valid');
  if (end <= start) throw new Error('The meeting must end after it starts');
  if (end.getTime() - start.getTime() > 24 * 3600_000) throw new Error('A meeting is at most 24 hours long');
  const link = clip(a.p_online_link, 500);
  if (link && !/^https?:\/\/\S+$/i.test(link)) throw new Error('The online link must start with http:// or https://');
  return {
    title, meeting_type: type as MeetingType, status: status as MeetingStatus,
    start_at: start.toISOString(), end_at: end.toISOString(),
    location: orNull(clip(a.p_location, 300)), online_link: orNull(link), purpose: orNull(clip(a.p_purpose, 4000)),
    agenda: normalizeAgenda(a.p_agenda), attendees: normalizeAttendees(a.p_attendees),
  };
}

export interface MomInput {
  summary: string | null; discussion: DiscussionPoint[]; decisions: string[]; actions: ActionItem[]; questions: string[]; info: InfoItem[];
}

export function parseMomInput(a: Record<string, unknown>): MomInput {
  return {
    summary: orNull(clip(a.p_summary, 8000)), discussion: normalizeDiscussion(a.p_discussion), decisions: normalizeStrings(a.p_decisions),
    actions: normalizeActions(a.p_actions), questions: normalizeStrings(a.p_questions), info: normalizeInfo(a.p_info),
  };
}

// ---------------------------------------------------------------------
// Dates and e-mail text
// ---------------------------------------------------------------------
export const MAIL_TZ = 'Asia/Bangkok';

/** "Mon, 3 Nov 2026 10:00–11:30" in the company time zone */
export function formatWhen(startIso: string, endIso: string, lang: MailLang, tz = MAIL_TZ): string {
  const locale = lang === 'th' ? 'th-TH' : 'en-GB';
  const day = new Intl.DateTimeFormat(locale, { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  const time = new Intl.DateTimeFormat(locale, { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const s = new Date(startIso);
  const e = new Date(endIso);
  const sameDay = day.format(s) === day.format(e);
  return `${day.format(s)} ${time.format(s)}–${sameDay ? '' : `${day.format(e)} `}${time.format(e)}`;
}

export interface MailMeeting {
  title: string; start_at: string; end_at: string; location: string | null; online_link: string | null; purpose: string | null;
  agenda: AgendaItem[]; meeting_no: number;
}

const L = {
  en: {
    invite: 'Invitation', update: 'Updated', cancel: 'Cancelled', hello: 'Dear all,', when: 'When', where: 'Where', online: 'Online', purpose: 'Purpose', agenda: 'Agenda', min: 'min',
    inviteLine: (t: string, p: string) => `You are invited to the meeting "${t}" for project ${p}.`,
    updateLine: (t: string, p: string) => `The meeting "${t}" for project ${p} has been updated. Please note the details below.`,
    cancelLine: (t: string, p: string) => `The meeting "${t}" for project ${p} has been cancelled.`,
    momLine: (t: string, p: string) => `Please find the minutes of the meeting "${t}" for project ${p} below.`,
    thanks: 'Best regards,', mom: 'Minutes', summary: 'Summary', discussion: 'Discussion', decisions: 'Decisions', actions: 'Action items', questions: 'Open questions', owner: 'Owner', due: 'due',
  },
  th: {
    invite: 'เชิญประชุม', update: 'แก้ไขนัดหมาย', cancel: 'ยกเลิกการประชุม', hello: 'เรียน ผู้เกี่ยวข้องทุกท่าน', when: 'วัน-เวลา', where: 'สถานที่', online: 'ออนไลน์', purpose: 'วัตถุประสงค์', agenda: 'วาระการประชุม', min: 'นาที',
    inviteLine: (t: string, p: string) => `ขอเรียนเชิญเข้าร่วมประชุม "${t}" ของโครงการ ${p}`,
    updateLine: (t: string, p: string) => `มีการแก้ไขรายละเอียดการประชุม "${t}" ของโครงการ ${p} กรุณาตรวจสอบรายละเอียดด้านล่าง`,
    cancelLine: (t: string, p: string) => `ขอแจ้งยกเลิกการประชุม "${t}" ของโครงการ ${p}`,
    momLine: (t: string, p: string) => `ขอส่งรายงานการประชุม "${t}" ของโครงการ ${p} ตามด้านล่าง`,
    thanks: 'ขอแสดงความนับถือ', mom: 'รายงานการประชุม', summary: 'สรุป', discussion: 'ประเด็นที่หารือ', decisions: 'มติ / ข้อตกลง', actions: 'งานที่ต้องทำต่อ', questions: 'คำถามที่ยังค้าง', owner: 'ผู้รับผิดชอบ', due: 'กำหนด',
  },
} as const;

const subjectPrefix = (kind: InviteKind, lang: MailLang) => (kind === 'mom' ? L[lang].mom : L[lang][kind]);

export function inviteSubject(kind: InviteKind, m: Pick<MailMeeting, 'title'>, project: { code: string }, lang: MailLang): string {
  return `[${project.code}] ${subjectPrefix(kind, lang)}: ${m.title}`;
}

/** The fixed part of an invitation: when, where, agenda. Used as the AI's input and as the whole text when the AI is off. */
export function meetingDetailsText(m: MailMeeting, lang: MailLang, tz = MAIL_TZ): string {
  const t = L[lang];
  const lines = [`${t.when}: ${formatWhen(m.start_at, m.end_at, lang, tz)}`];
  if (m.location) lines.push(`${t.where}: ${m.location}`);
  if (m.online_link) lines.push(`${t.online}: ${m.online_link}`);
  if (m.purpose) lines.push(`${t.purpose}: ${m.purpose}`);
  if (m.agenda.length) lines.push('', `${t.agenda}:`, ...m.agenda.map((a, i) => `${i + 1}. ${a.title}${a.minutes ? ` (${a.minutes} ${t.min})` : ''}`));
  return lines.join('\n');
}

/** Plain template used when the AI is off or fails — the user can still edit it before sending */
export function fallbackInvitation(kind: Exclude<InviteKind, 'mom'>, m: MailMeeting, project: { code: string; name: string }, organizer: string, lang: MailLang, tz = MAIL_TZ) {
  const t = L[lang];
  const intro = kind === 'invite' ? t.inviteLine(m.title, project.name) : kind === 'update' ? t.updateLine(m.title, project.name) : t.cancelLine(m.title, project.name);
  const details = kind === 'cancel' ? '' : `\n\n${meetingDetailsText(m, lang, tz)}`;
  return { subject: inviteSubject(kind, m, project, lang), body: `${t.hello}\n\n${intro}${details}\n\n${t.thanks}\n${organizer}` };
}

export interface MomContent {
  summary: string | null; discussion: DiscussionPoint[]; decisions: string[]; actions: ActionItem[]; questions: string[];
}

/** The minutes as plain text (e-mail body, copy) */
export function momToText(m: MomContent, lang: MailLang): string {
  const t = L[lang];
  const out: string[] = [];
  if (m.summary) out.push(`${t.summary}:`, m.summary, '');
  if (m.discussion.length) out.push(`${t.discussion}:`, ...m.discussion.map((d) => `- ${d.topic}${d.topic && d.notes ? ': ' : ''}${d.notes}`), '');
  if (m.decisions.length) out.push(`${t.decisions}:`, ...m.decisions.map((d, i) => `${i + 1}. ${d}`), '');
  if (m.actions.length) {
    out.push(`${t.actions}:`, ...m.actions.map((a, i) => `${i + 1}. ${a.text}${a.owner_name ? ` — ${t.owner}: ${a.owner_name}` : ''}${a.due_date ? ` (${t.due} ${a.due_date})` : ''}`), '');
  }
  if (m.questions.length) out.push(`${t.questions}:`, ...m.questions.map((q) => `- ${q}`), '');
  return out.join('\n').trim();
}

export function momEmail(m: MailMeeting & MomContent, project: { code: string; name: string }, organizer: string, lang: MailLang) {
  const t = L[lang];
  return {
    subject: inviteSubject('mom', m, project, lang),
    body: `${t.hello}\n\n${t.momLine(m.title, project.name)}\n\n${momToText(m, lang)}\n\n${t.thanks}\n${organizer}`,
  };
}

// ---------------------------------------------------------------------
// iCalendar (.ics)
// ---------------------------------------------------------------------
const icsEscape = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const icsDate = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

/** Fold a content line at 75 octets (RFC 5545) without splitting a UTF-8 character */
export function foldIcsLine(line: string): string {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const parts: string[] = [];
  let cur = '';
  let bytes = 0;
  let limit = 75;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (bytes + n > limit) { parts.push(cur); cur = ''; bytes = 0; limit = 74; }
    cur += ch;
    bytes += n;
  }
  parts.push(cur);
  return parts.join('\r\n ');
}

export interface IcsInput {
  uid: string; method: 'REQUEST' | 'CANCEL'; sequence: number; title: string; description: string; location: string | null;
  start_at: string; end_at: string; organizer: { name: string; email: string }; attendees: { name: string; email: string }[]; now?: Date;
}

export function buildIcs(i: IcsInput): string {
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//TBKK PCW//Meetings//EN', 'CALSCALE:GREGORIAN', `METHOD:${i.method}`,
    'BEGIN:VEVENT', `UID:${i.uid}`, `SEQUENCE:${i.sequence}`, `DTSTAMP:${icsDate((i.now ?? new Date()).toISOString())}`,
    `DTSTART:${icsDate(i.start_at)}`, `DTEND:${icsDate(i.end_at)}`, `SUMMARY:${icsEscape(i.title)}`,
    `DESCRIPTION:${icsEscape(i.description)}`,
    ...(i.location ? [`LOCATION:${icsEscape(i.location)}`] : []),
    `STATUS:${i.method === 'CANCEL' ? 'CANCELLED' : 'CONFIRMED'}`,
    `ORGANIZER;CN=${icsEscape(i.organizer.name).replace(/[":]/g, '')}:mailto:${i.organizer.email}`,
    ...i.attendees.map((a) => `ATTENDEE;CN=${icsEscape(a.name).replace(/[":]/g, '')};ROLE=REQ-PARTICIPANT;RSVP=TRUE:mailto:${a.email}`),
    'END:VEVENT', 'END:VCALENDAR',
  ];
  return `${lines.map(foldIcsLine).join('\r\n')}\r\n`;
}

// ---------------------------------------------------------------------
// AI replies (untrusted text → clean data)
// ---------------------------------------------------------------------
function jsonObject(text: string): Record<string, unknown> | null {
  const a = text.indexOf('{');
  const b = text.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try {
    const v = JSON.parse(text.slice(a, b + 1));
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** { subject, body } from the model's reply, or null when it is unusable */
export function parseAiInvitation(text: string): { subject: string; body: string } | null {
  const o = jsonObject(text);
  if (!o) return null;
  const subject = clip(o.subject, 300).replace(/\s*\n\s*/g, ' ');
  const body = clip(o.body, 8000);
  return subject && body ? { subject, body } : null;
}

/** Structured MOM from rough notes; owners are matched to attendees by name. Null when the reply has no usable content. */
export function parseAiMom(text: string, attendees: Attendee[], agenda: AgendaItem[] = []): (MomInput & { suggested: true }) | null {
  const o = jsonObject(text);
  if (!o) return null;
  const byName = (name: string) => {
    const n = name.trim().toLowerCase();
    if (!n) return null;
    return attendees.find((a) => a.name.toLowerCase() === n) ?? attendees.find((a) => a.name.toLowerCase().includes(n) || n.includes(a.name.toLowerCase())) ?? null;
  };
  const actions: ActionItem[] = [];
  for (const raw of asArray(o.action_items).slice(0, MAX_LIST)) {
    const x = typeof raw === 'string' ? { text: raw } : rec(raw);
    const textVal = clip(x.text, 1000);
    if (!textVal) continue;
    const ownerName = clip(x.owner, 200);
    const match = byName(ownerName);
    const due = clip(x.due_date, 10);
    actions.push({ text: textVal, owner_id: match?.user_id ?? null, owner_name: match?.name ?? orNull(ownerName), due_date: isDate(due) ? due : null, task_id: null });
  }
  const known = new Set(agenda.map((a) => a.title.toLowerCase()));
  const discussion = normalizeDiscussion(o.discussion).map((d) => ({ ...d, topic: known.has(d.topic.toLowerCase()) ? agenda.find((a) => a.title.toLowerCase() === d.topic.toLowerCase())!.title : d.topic }));
  const res = {
    summary: orNull(clip(o.summary, 8000)), discussion, decisions: normalizeStrings(o.decisions), actions,
    questions: normalizeStrings(o.open_questions), info: normalizeInfo(o.information), suggested: true as const,
  };
  const empty = !res.summary && !res.discussion.length && !res.decisions.length && !res.actions.length && !res.questions.length && !res.info.length;
  return empty ? null : res;
}

/** Text of the meetings' decisions and information, as extra input for the AI analysis / definition draft */
export function meetingsForAnalysis(ms: Pick<ProjectMeeting, 'meeting_no' | 'title' | 'start_at' | 'status' | 'mom_summary' | 'mom_decisions' | 'mom_info' | 'mom_questions'>[], maxChars = 6000): string {
  const out: string[] = [];
  for (const m of ms) {
    if (m.status !== 'held') continue;
    const parts: string[] = [];
    if (m.mom_summary) parts.push(`Summary: ${m.mom_summary}`);
    for (const i of m.mom_info) parts.push(`Information — ${i.topic}${i.topic && i.detail ? ': ' : ''}${i.detail}`);
    for (const d of m.mom_decisions) parts.push(`Decision: ${d}`);
    for (const q of m.mom_questions) parts.push(`Open question: ${q}`);
    if (!parts.length) continue;
    out.push(`Meeting #${m.meeting_no} "${m.title}" (${m.start_at.slice(0, 10)})`, ...parts.map((p) => `- ${p}`));
  }
  const text = out.join('\n');
  return text.length > maxChars ? `${text.slice(0, maxChars)}…` : text;
}
