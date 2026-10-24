import 'server-only';
import { GoogleGenAI, Modality } from '@google/genai';

/**
 * Google Gemini Live for the spoken part of the clarification chat only (GEMINI_API_KEY / GEMINI_LIVE_MODEL /
 * GEMINI_LIVE_VOICE). The company LLM (./ai.ts) still checks the answers and writes the summaries.
 * GEMINI_API_KEY unset = voice is off. The key never leaves the server: the browser gets a one-use ephemeral token
 * locked to this model and system instruction.
 */
export const liveEnabled = () => !!process.env.GEMINI_API_KEY;
export const liveModel = () => process.env.GEMINI_LIVE_MODEL || 'gemini-3.8-live';

export async function liveToken(systemInstruction: string) {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY!, httpOptions: { apiVersion: 'v1alpha' } });
  const now = Date.now();
  const voice = process.env.GEMINI_LIVE_VOICE;
  const token = await ai.authTokens.create({
    config: {
      uses: 1,
      expireTime: new Date(now + 30 * 60_000).toISOString(),
      newSessionExpireTime: new Date(now + 60_000).toISOString(),
      liveConnectConstraints: {
        model: liveModel(),
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction,
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          ...(voice ? { speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } } : {}),
        },
      },
      // lock everything set above: the browser cannot swap the instruction or model
      lockAdditionalFields: [],
    },
  });
  if (!token.name) throw new Error('Gemini returned no token');
  return { token: token.name, model: liveModel() };
}
