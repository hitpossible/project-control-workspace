import type { AiCoverage } from '@/lib/clarify';
import { aiEnabled, chatTurn } from '@/server/ai';
import { withUser } from '@/server/api';
import { chatLang, cleanMessages, intakeRequest, loadIntake } from '@/server/clarify';

/** Whether a new request can be written with the AI — the new request page offers it only then */
export const GET = withUser(async () => ({ data: { enabled: aiEnabled() } }));

/**
 * One AI turn while a new request is written by talking to the AI (nothing is saved yet — the transcript and criteria
 * check go into the draft when the requestor saves it). Body: { document_type_id, form, messages, turns, assess, lang }.
 * Returns the AI message, the criteria check and the form fields it could fill (`form`).
 * assess: true = a voice conversation — only check the criteria / form and say what is still missing.
 * off: true = AI not set up (the requestor fills in the form); message: null = the AI failed this time.
 */
export const POST = withUser(async (me, req) => {
  const body = await req.json().catch(() => ({}));
  const messages = cleanMessages(body?.messages);
  const turns = Math.max(0, Number(body?.turns) || 0);
  const assess = body?.assess === true;

  const { criteria, department } = await loadIntake(me, body?.document_type_id);
  if (!aiEnabled()) return { data: { off: true } };

  const turn = await chatTurn(intakeRequest(body?.form, department), criteria, null, messages, turns, { intake: true, lang: chatLang(body?.lang) });
  if (!turn) return { data: { message: null } };

  const coverage: AiCoverage = { checked_at: new Date().toISOString(), criteria: turn.coverage };
  if (assess) return { data: { coverage, form: turn.form, done: turn.done, asking: turn.done ? [] : turn.message.criteria ?? [] } };
  return { data: { message: turn.message, coverage, form: turn.form, done: turn.done } };
});
