import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CRITERIA } from '@/lib/clarify';
import type { ProjectRequest } from '@/lib/types';
import { chatTurn } from './ai';

const reply = (o: unknown) => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(o) } }] }), { status: 200 });
const request = { project_name: 'Repair requests', req_department: 'Production', priority: 'medium', date_required: null, ai_clarifications: null, description: 'x', reason: 'y', expectation: 'z' } as unknown as ProjectRequest;

describe('chatTurn requirements', () => {
  beforeEach(() => { process.env.OPENAI_BASE_URL = 'http://llm.test/v1'; });
  afterEach(() => { vi.unstubAllGlobals(); delete process.env.OPENAI_BASE_URL; });

  it('returns the requirements the model drafted, cleaned', async () => {
    vi.stubGlobal('fetch', async () => reply({
      assessment: DEFAULT_CRITERIA.map((c) => ({ key: c.key, status: 'missing', note: null, summary: null })),
      asking: ['users'], message: 'Who reports a breakdown?', done: false,
      requirements: [{ title: ' Operator reports a breakdown ', category: 'Request', priority: 'must', acceptance_criteria: 'Saved in 2 s' }, { title: '' }, { title: 'Operator reports a breakdown' }],
    }));
    const turn = await chatTurn(request, DEFAULT_CRITERIA, null, [], 0);
    expect(turn?.requirements).toEqual([{ title: 'Operator reports a breakdown', category: 'Request', description: null, priority: 'must', acceptance_criteria: 'Saved in 2 s' }]);
  });

  it('has no requirements when the model leaves them out', async () => {
    vi.stubGlobal('fetch', async () => reply({
      assessment: DEFAULT_CRITERIA.map((c) => ({ key: c.key, status: 'missing' })), asking: ['users'], message: 'Who?', done: false,
    }));
    expect((await chatTurn(request, DEFAULT_CRITERIA, null, [], 0))?.requirements).toEqual([]);
  });
});
