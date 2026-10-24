import type { AiCoverage } from '@/lib/clarify';
import { aiEnabled, chatTurn } from '@/server/ai';
import { withUser } from '@/server/api';
import { cleanMessages, loadForClarify } from '@/server/clarify';
import { withCtx } from '@/server/db';

const OPEN = `status IN ('draft','need_more_information')`;

/**
 * One AI turn of the clarification chat for the requestor's own draft, just before submit.
 * Body: { messages, turns, assess } — turns = AI messages so far in this conversation.
 * assess: true = the conversation is spoken (Gemini Live asks the questions): only check the criteria and say what is
 * still missing; the AI's own next message is not added to the transcript.
 * Saves the transcript (ai_chat) and the criteria check (ai_coverage) on the request.
 * off: true = AI not set up for this request (submit straight away); message: null = the AI failed this time.
 */
export const POST = withUser(async (me, req, params) => {
  const body = await req.json().catch(() => ({}));
  const messages = cleanMessages(body?.messages);
  const turns = Math.max(0, Number(body?.turns) || 0);
  const assess = body?.assess === true;

  const { r, criteria, moreInfo } = await loadForClarify(me, params.id);
  if (!aiEnabled() || !criteria.length) return { data: { off: true } };

  // outside a transaction: the model can take a while and must not hold a DB connection
  const turn = await chatTurn(r, criteria, moreInfo, messages, turns);
  if (!turn) return { data: { message: null } };

  const coverage: AiCoverage = { checked_at: new Date().toISOString(), criteria: turn.coverage };
  const transcript = assess ? messages : [...messages, turn.message];
  await withCtx(me, (ctx) => ctx.exec(`UPDATE project_requests SET ai_chat = ?, ai_coverage = ? WHERE id = ? AND requestor_id = ? AND ${OPEN}`,
    [JSON.stringify(transcript), JSON.stringify(coverage), r.id, me.id]));
  if (assess) return { data: { coverage, done: turn.done, asking: turn.done ? [] : turn.message.criteria ?? [] } };
  return { data: { message: turn.message, coverage, done: turn.done } };
});
