import { MAX_CHAT_MESSAGE, type AiCoverage, type ChatMessage, type ClarifyCriterion } from '@/lib/clarify';
import type { ProjectRequest } from '@/lib/types';
import { aiEnabled, chatTurn } from '@/server/ai';
import { withUser } from '@/server/api';
import { AppError, withCtx } from '@/server/db';

const OPEN = `status IN ('draft','need_more_information')`;

/** The browser sends the conversation; keep only well-formed messages */
function cleanMessages(v: unknown): ChatMessage[] {
  if (!Array.isArray(v)) return [];
  return v.slice(-60).flatMap((m): ChatMessage[] => {
    if (!m || (m.role !== 'assistant' && m.role !== 'user') || typeof m.content !== 'string' || !m.content.trim()) return [];
    return [{
      role: m.role,
      content: m.content.trim().slice(0, MAX_CHAT_MESSAGE),
      at: typeof m.at === 'string' ? m.at : new Date().toISOString(),
      ...(m.role === 'assistant' && Array.isArray(m.criteria) ? { criteria: m.criteria.map(String).slice(0, 5) } : {}),
    }];
  });
}

/**
 * One AI turn of the clarification chat for the requestor's own draft, just before submit.
 * Body: { messages, turns } — turns = AI messages so far in this conversation.
 * Saves the transcript (ai_chat) and the criteria check (ai_coverage) on the request.
 * off: true = AI not set up for this request (submit straight away); message: null = the AI failed this time.
 */
export const POST = withUser(async (me, req, params) => {
  const body = await req.json().catch(() => ({}));
  const messages = cleanMessages(body?.messages);
  const turns = Math.max(0, Number(body?.turns) || 0);

  const { r, criteria, moreInfo } = await withCtx(me, async (ctx) => {
    const r = await ctx.one<ProjectRequest>('SELECT * FROM project_requests WHERE id = ?', [params.id]);
    if (!r || r.requestor_id !== me.id) throw new AppError('Request not found', 404);
    if (!['draft', 'need_more_information'].includes(r.status)) throw new AppError(`Request cannot be submitted from status ${r.status}`);
    const criteria = (await ctx.val<ClarifyCriterion[]>('SELECT clarify_criteria FROM document_types WHERE id = ?', [r.document_type_id])) ?? [];
    const moreInfo = r.status === 'need_more_information'
      ? await ctx.val<string>(`SELECT comment FROM approval_steps WHERE request_id = ? AND status = 'more_info' LIMIT 1`, [r.id])
      : null;
    return { r, criteria, moreInfo };
  });
  if (!aiEnabled() || !criteria.length) return { data: { off: true } };

  // outside a transaction: the model can take a while and must not hold a DB connection
  const turn = await chatTurn(r, criteria, moreInfo, messages, turns);
  if (!turn) return { data: { message: null } };

  const coverage: AiCoverage = { checked_at: new Date().toISOString(), criteria: turn.coverage };
  await withCtx(me, (ctx) => ctx.exec(`UPDATE project_requests SET ai_chat = ?, ai_coverage = ? WHERE id = ? AND requestor_id = ? AND ${OPEN}`,
    [JSON.stringify([...messages, turn.message]), JSON.stringify(coverage), r.id, me.id]));
  return { data: { message: turn.message, coverage, done: turn.done } };
});
