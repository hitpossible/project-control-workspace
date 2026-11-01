import { describe, expect, it } from 'vitest';
import {
  buildIcs, fallbackInvitation, foldIcsLine, formatWhen, meetingsForAnalysis, momToText, normalizeAttendees, parseAiInvitation, parseAiMom,
  parseMeetingInput, type Attendee,
} from './meetings';

const base = { p_title: ' Kickoff ', p_start_at: '2026-11-03T03:00:00.000Z', p_end_at: '2026-11-03T04:30:00.000Z' };
const meeting = { title: 'Requirement workshop', meeting_no: 2, start_at: '2026-11-03T03:00:00.000Z', end_at: '2026-11-03T04:30:00.000Z', location: 'Room 3', online_link: null, purpose: 'Confirm scope', agenda: [{ title: 'Scope', minutes: 30 }, { title: 'Reports', minutes: null }] };

describe('parseMeetingInput', () => {
  it('cleans the fields and defaults type, status and agenda', () => {
    const m = parseMeetingInput({ ...base, p_agenda: [{ title: ' Scope ', minutes: '30' }, { title: '' }, 'Reports'], p_online_link: ' https://teams.example/x ' });
    expect(m).toMatchObject({ title: 'Kickoff', meeting_type: 'requirement', status: 'planned', online_link: 'https://teams.example/x' });
    expect(m.agenda).toEqual([{ title: 'Scope', minutes: 30 }, { title: 'Reports', minutes: null }]);
  });
  it('defaults the end to one hour after the start', () => {
    expect(parseMeetingInput({ p_title: 'x', p_start_at: '2026-11-03T03:00:00.000Z' }).end_at).toBe('2026-11-03T04:00:00.000Z');
  });
  it.each([
    [{ ...base, p_title: ' ' }, /Title/],
    [{ ...base, p_start_at: '' }, /Start/],
    [{ ...base, p_end_at: '2026-11-03T02:00:00.000Z' }, /after it starts/],
    [{ ...base, p_meeting_type: 'party' }, /Type/],
    [{ ...base, p_online_link: 'javascript:alert(1)' }, /http/],
  ])('rejects %j', (a, msg) => {
    expect(() => parseMeetingInput(a)).toThrow(msg);
  });
});

describe('normalizeAttendees', () => {
  it('keeps one entry per user or e-mail and lower-cases addresses', () => {
    const list = normalizeAttendees([{ user_id: 3, name: 'A' }, { user_id: 3, name: 'A again' }, { name: 'Ext', email: 'Ext@Client.com' }, { email: 'ext@client.com' }, {}]);
    expect(list).toEqual([
      { user_id: 3, name: 'A', email: null, attended: false },
      { user_id: null, name: 'Ext', email: 'ext@client.com', attended: false },
    ]);
  });
  it('rejects a bad address', () => {
    expect(() => normalizeAttendees([{ name: 'x', email: 'nope' }])).toThrow(/valid e-mail/);
  });
});

describe('invitation text', () => {
  it('formats the time in Bangkok', () => {
    expect(formatWhen(meeting.start_at, meeting.end_at, 'en')).toMatch(/10:00–11:30/);
  });
  it('builds a template with when, where and a numbered agenda, in both languages', () => {
    const en = fallbackInvitation('invite', meeting, { code: 'P-1', name: 'Repairs' }, 'Somchai', 'en');
    expect(en.subject).toBe('[P-1] Invitation: Requirement workshop');
    expect(en.body).toContain('Where: Room 3');
    expect(en.body).toContain('1. Scope (30 min)\n2. Reports');
    expect(fallbackInvitation('cancel', meeting, { code: 'P-1', name: 'Repairs' }, 'Somchai', 'th').body).toContain('ยกเลิก');
  });
});

describe('ics', () => {
  const ics = buildIcs({
    uid: 'meeting-1@pcw', method: 'REQUEST', sequence: 1, title: 'Plan, review; "now"', description: 'Line 1\nLine 2', location: 'Room 3',
    start_at: meeting.start_at, end_at: meeting.end_at, organizer: { name: 'Somchai', email: 's@x.com' }, attendees: [{ name: 'Ann', email: 'a@x.com' }], now: new Date('2026-11-01T00:00:00Z'),
  });
  it('has the event in UTC with escaped text and CRLF lines', () => {
    expect(ics).toContain('DTSTART:20261103T030000Z');
    expect(ics).toContain('DTSTAMP:20261101T000000Z');
    expect(ics).toContain('SUMMARY:Plan\\, review\\; "now"');
    expect(ics).toContain('DESCRIPTION:Line 1\\nLine 2');
    expect(ics).toContain('ATTENDEE;CN=Ann;ROLE=REQ-PARTICIPANT;RSVP=TRUE:mailto:a@x.com');
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(ics).not.toMatch(/[^\r]\n/);
  });
  it('marks a cancellation', () => {
    expect(buildIcs({ ...{ uid: 'u', sequence: 2, title: 't', description: '', location: null, start_at: meeting.start_at, end_at: meeting.end_at, organizer: { name: 'o', email: 'o@x.com' }, attendees: [] }, method: 'CANCEL' })).toMatch(/METHOD:CANCEL[\s\S]*STATUS:CANCELLED/);
  });
  it('folds long lines at 75 bytes without splitting Thai characters', () => {
    const folded = foldIcsLine(`SUMMARY:${'ประชุม'.repeat(30)}`);
    for (const l of folded.split('\r\n')) expect(new TextEncoder().encode(l).length).toBeLessThanOrEqual(75);
    expect(folded.replace(/\r\n /g, '')).toBe(`SUMMARY:${'ประชุม'.repeat(30)}`);
  });
});

describe('AI replies', () => {
  it('reads the invitation JSON, even inside a code fence', () => {
    expect(parseAiInvitation('```json\n{"subject":" Hello\\nthere ","body":"Dear all"}\n```')).toEqual({ subject: 'Hello there', body: 'Dear all' });
  });
  it('rejects a reply without subject or body, or without JSON', () => {
    expect(parseAiInvitation('{"subject":"x"}')).toBeNull();
    expect(parseAiInvitation('sorry')).toBeNull();
  });
  const people: Attendee[] = [{ user_id: 7, name: 'Somchai Jai', email: null, attended: true }, { user_id: null, name: 'Ann (client)', email: 'a@c.com', attended: true }];
  it('structures a MOM, matching owners to attendees and dropping bad dates', () => {
    const mom = parseAiMom(JSON.stringify({
      summary: ' Agreed scope ', discussion: [{ topic: 'scope', notes: 'Only repairs' }], decisions: ['Use SSO', 'use sso', ''],
      action_items: [{ text: 'Send mockup', owner: 'somchai', due_date: '2026-11-10' }, { text: 'Check data', owner: 'Nobody', due_date: 'next week' }, { text: '' }],
      open_questions: ['Who owns the master data?'], information: [{ topic: 'Volume', detail: '200 repairs a day' }],
    }), people, [{ title: 'Scope', minutes: null }]);
    expect(mom?.summary).toBe('Agreed scope');
    expect(mom?.discussion).toEqual([{ topic: 'Scope', notes: 'Only repairs' }]);
    expect(mom?.decisions).toEqual(['Use SSO']);
    expect(mom?.actions).toEqual([
      { text: 'Send mockup', owner_id: 7, owner_name: 'Somchai Jai', due_date: '2026-11-10', task_id: null },
      { text: 'Check data', owner_id: null, owner_name: 'Nobody', due_date: null, task_id: null },
    ]);
    expect(mom?.info).toEqual([{ topic: 'Volume', detail: '200 repairs a day' }]);
  });
  it('returns null when the reply has nothing usable', () => {
    expect(parseAiMom('{"summary":"","decisions":[]}', people)).toBeNull();
  });
});

describe('MOM text and analysis input', () => {
  const mom = { summary: 'Done', discussion: [], decisions: ['A'], actions: [{ text: 'Do X', owner_id: null, owner_name: 'Ann', due_date: '2026-11-10', task_id: null }], questions: ['Q?'] };
  it('lists decisions, action items with owner and due date, and open questions', () => {
    const t = momToText(mom, 'en');
    expect(t).toContain('1. A');
    expect(t).toContain('1. Do X — Owner: Ann (due 2026-11-10)');
    expect(t).toContain('- Q?');
  });
  it('gives the analysis only held meetings with content', () => {
    const held = { meeting_no: 1, title: 'W', start_at: '2026-11-03T03:00:00.000Z', status: 'held' as const, mom_summary: null, mom_decisions: ['Use SSO'], mom_info: [{ topic: 'Users', detail: '30 operators' }], mom_questions: [] };
    const text = meetingsForAnalysis([held, { ...held, meeting_no: 2, status: 'planned' }, { ...held, meeting_no: 3, mom_decisions: [], mom_info: [] }]);
    expect(text).toContain('Meeting #1');
    expect(text).toContain('Information — Users: 30 operators');
    expect(text).toContain('Decision: Use SSO');
    expect(text).not.toContain('#2');
    expect(text).not.toContain('#3');
  });
});
