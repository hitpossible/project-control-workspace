import { aiEnabled, voiceInstruction } from '@/server/ai';
import { withUser } from '@/server/api';
import { chatLang, cleanMessages, intakeRequest, loadIntake } from '@/server/clarify';
import { AppError } from '@/server/db';
import { liveEnabled, liveToken } from '@/server/gemini';

/** Whether voice is set up for the intake chat */
export const GET = withUser(async () => ({ data: { enabled: liveEnabled() && aiEnabled() } }));

/**
 * Starts a spoken intake chat for a new (unsaved) request: a one-use Gemini Live token with the form so far, the
 * criteria and the conversation in its instruction. Body: { document_type_id, form, messages, lang }.
 */
export const POST = withUser(async (me, req) => {
  const body = await req.json().catch(() => ({}));
  const { criteria, department } = await loadIntake(me, body?.document_type_id);
  if (!liveEnabled() || !aiEnabled()) return { data: { off: true } };
  try {
    const r = intakeRequest(body?.form, department);
    return { data: await liveToken(voiceInstruction(r, criteria, null, cleanMessages(body?.messages), { intake: true, lang: chatLang(body?.lang) })) };
  } catch (e) {
    console.warn('[gemini] live token failed:', e instanceof Error ? e.message : e);
    throw new AppError('Voice is not available right now', 502);
  }
});
