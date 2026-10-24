import 'server-only';
import { after } from 'next/server';
import type { AiAnalysis } from '@/lib/clarify';
import type { Profile, ProjectRequest } from '@/lib/types';
import { aiEnabled, analyzeRequest } from './ai';
import { withCtx } from './db';

const save = (me: Profile, id: number, a: AiAnalysis) =>
  withCtx(me, (ctx) => ctx.exec('UPDATE project_requests SET ai_analysis = ? WHERE id = ?', [JSON.stringify(a), id]));

/**
 * Mark the request's AI initial analysis as pending and write it once the response has gone out — the model can take
 * a while, and submit must not wait for it. No-op when AI is off.
 */
export async function startAnalysis(me: Profile, id: number) {
  if (!aiEnabled()) return false;
  await save(me, id, { status: 'pending', analyzed_at: new Date().toISOString() });
  after(async () => {
    try {
      const r = await withCtx(me, (ctx) => ctx.one<ProjectRequest>('SELECT * FROM project_requests WHERE id = ?', [id]));
      if (!r) return;
      const a = await analyzeRequest(r, r.ai_coverage, r.ai_chat ?? []);
      await save(me, id, a ?? { status: 'failed', analyzed_at: new Date().toISOString() });
    } catch (e) {
      console.warn('[ai] could not save the request analysis:', e instanceof Error ? e.message : e);
    }
  });
  return true;
}
