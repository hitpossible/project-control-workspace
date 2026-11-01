import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { draftMeetingMail, structureMom } from './ai';

const reply = (o: unknown) => new Response(JSON.stringify({ choices: [{ message: { content: typeof o === 'string' ? o : JSON.stringify(o) } }] }), { status: 200 });
const meeting = { title: 'Workshop', meeting_no: 1, start_at: '2026-11-03T03:00:00.000Z', end_at: '2026-11-03T04:00:00.000Z', location: 'Room 3', online_link: null, purpose: null, agenda: [{ title: 'Scope', minutes: null }] };
const ctx = { kind: 'invite' as const, lang: 'en' as const, project: { code: 'P-1', name: 'Repairs' }, summary: null, meeting, organizer: 'Somchai' };

describe('meeting AI', () => {
  beforeEach(() => { process.env.OPENAI_BASE_URL = 'http://llm.test/v1'; });
  afterEach(() => { vi.unstubAllGlobals(); delete process.env.OPENAI_BASE_URL; });

  it('drafts the invitation from the model and sends it the facts', async () => {
    let sent = '';
    vi.stubGlobal('fetch', async (_u: string, init: RequestInit) => { sent = String(init.body); return reply({ subject: 'Invitation: Workshop', body: 'Dear all, ...' }); });
    const d = await draftMeetingMail(ctx);
    expect(d).toEqual({ subject: 'Invitation: Workshop', body: 'Dear all, ...', ai: true });
    expect(sent).toContain('Room 3');
    expect(sent).toContain('OUTPUT LANGUAGE: English');
  });

  it('falls back to the plain template when the AI is off, fails or answers badly', async () => {
    delete process.env.OPENAI_BASE_URL;
    expect((await draftMeetingMail(ctx)).ai).toBe(false);
    process.env.OPENAI_BASE_URL = 'http://llm.test/v1';
    vi.stubGlobal('fetch', async () => new Response('down', { status: 500 }));
    const failed = await draftMeetingMail(ctx);
    expect(failed.ai).toBe(false);
    expect(failed.body).toContain('Room 3');
    vi.stubGlobal('fetch', async () => reply('no json here'));
    expect((await draftMeetingMail({ ...ctx, lang: 'th' })).subject).toContain('เชิญประชุม');
  });

  it('structures rough notes into a MOM', async () => {
    vi.stubGlobal('fetch', async () => reply({ summary: 'ok', decisions: ['Go'], action_items: [{ text: 'Mockup', owner: 'Ann', due_date: '2026-11-10' }] }));
    const out = await structureMom({ lang: 'en', today: '2026-11-01', project: ctx.project, meeting, attendees: [{ user_id: 4, name: 'Ann', email: null, attended: true }], notes: 'we agreed' });
    expect(out?.decisions).toEqual(['Go']);
    expect(out?.actions[0]).toMatchObject({ owner_id: 4, due_date: '2026-11-10' });
  });

  it('returns null for the MOM when the AI is off or fails', async () => {
    delete process.env.OPENAI_BASE_URL;
    expect(await structureMom({ lang: 'en', today: '2026-11-01', project: ctx.project, meeting, attendees: [], notes: 'x' })).toBeNull();
    process.env.OPENAI_BASE_URL = 'http://llm.test/v1';
    vi.stubGlobal('fetch', async () => reply('garbage'));
    expect(await structureMom({ lang: 'en', today: '2026-11-01', project: ctx.project, meeting, attendees: [], notes: 'x' })).toBeNull();
  });
});
