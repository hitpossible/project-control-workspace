import { aiEnabled, voiceInstruction } from '@/server/ai';
import { withUser } from '@/server/api';
import { chatLang, cleanMessages, loadForClarify } from '@/server/clarify';
import { AppError } from '@/server/db';
import { liveEnabled, liveToken } from '@/server/gemini';

/** Whether the voice chat is set up — the dialog shows the microphone button only then */
export const GET = withUser(async () => ({ data: { enabled: liveEnabled() && aiEnabled() } }));

/**
 * Starts a spoken clarification chat: a one-use Gemini Live token for the requestor's own open request, with the form,
 * the criteria and the conversation so far in its system instruction. Body: { messages, lang }.
 * off: true = voice is not set up (the text chat still works).
 */
export const POST = withUser(async (me, req, params) => {
  const body = await req.json().catch(() => ({}));
  const { r, criteria, moreInfo } = await loadForClarify(me, params.id);
  // the company LLM still checks the spoken answers, so voice needs it too
  if (!liveEnabled() || !aiEnabled() || !criteria.length) return { data: { off: true } };
  try {
    return { data: await liveToken(voiceInstruction(r, criteria, moreInfo, cleanMessages(body?.messages), { lang: chatLang(body?.lang) })) };
  } catch (e) {
    console.warn('[gemini] live token failed:', e instanceof Error ? e.message : e);
    throw new AppError('Voice is not available right now', 502);
  }
});
