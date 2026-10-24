'use client';

import { GoogleGenAI, Modality, type LiveServerMessage, type Session } from '@google/genai';

/**
 * Browser side of a Gemini Live voice session: microphone → 16 kHz PCM → Gemini, Gemini's 24 kHz PCM → speakers,
 * plus the transcripts of both sides. The token comes from /api/requests/[id]/clarify/voice.
 */
export interface LiveHandlers {
  /** the user's words so far in the current turn (accumulated) */
  onUserText: (text: string) => void;
  /** the assistant's words so far in the current turn (accumulated) */
  onModelText: (text: string) => void;
  /** the assistant started answering: the user's turn is over */
  onModelStart: () => void;
  /** the assistant finished (or was interrupted) */
  onTurnComplete: () => void;
  /** microphone level 0–1, ~10× a second */
  onLevel: (level: number) => void;
  onSpeaking: (speaking: boolean) => void;
  onClose: (error?: string) => void;
}

export interface LiveCall {
  /** add a note to the model's context without making it answer */
  note: (text: string) => void;
  setMuted: (muted: boolean) => void;
  stop: () => void;
}

// 16 kHz mono Float32 → Int16 chunks of ~100 ms, plus the level
const CAPTURE = `
class Capture extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Int16Array(1600); this.n = 0; this.sum = 0; }
  process(inputs) {
    const ch = inputs[0][0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      const v = Math.max(-1, Math.min(1, ch[i]));
      this.buf[this.n++] = v < 0 ? v * 0x8000 : v * 0x7fff;
      this.sum += v * v;
      if (this.n === this.buf.length) {
        this.port.postMessage({ pcm: this.buf.buffer, level: Math.sqrt(this.sum / this.n) }, [this.buf.buffer]);
        this.buf = new Int16Array(1600); this.n = 0; this.sum = 0;
      }
    }
    return true;
  }
}
registerProcessor('pcw-capture', Capture);`;

function toBase64(buf: ArrayBuffer) {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromBase64Pcm(b64: string) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const pcm = new Int16Array(bytes.buffer, 0, bytes.length >> 1);
  const out = new Float32Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) out[i] = pcm[i] / 0x8000;
  return out;
}

export async function startLive(token: string, model: string, h: LiveHandlers): Promise<LiveCall> {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser cannot use the microphone here (it needs HTTPS)');
  const mic = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });

  const inCtx = new AudioContext({ sampleRate: 16000 });
  const outCtx = new AudioContext({ sampleRate: 24000 });
  const url = URL.createObjectURL(new Blob([CAPTURE], { type: 'application/javascript' }));
  await inCtx.audioWorklet.addModule(url);
  URL.revokeObjectURL(url);

  // playback queue: chunks are scheduled back to back; an interruption drops what is still queued
  const playing = new Set<AudioBufferSourceNode>();
  let playAt = 0;
  const flush = () => {
    for (const s of playing) s.stop();
    playing.clear();
    playAt = 0;
    h.onSpeaking(false);
  };
  const play = (b64: string) => {
    const data = fromBase64Pcm(b64);
    const buf = outCtx.createBuffer(1, data.length, 24000);
    buf.copyToChannel(data, 0);
    const src = outCtx.createBufferSource();
    src.buffer = buf;
    src.connect(outCtx.destination);
    playAt = Math.max(playAt, outCtx.currentTime + 0.05);
    src.start(playAt);
    playAt += buf.duration;
    playing.add(src);
    h.onSpeaking(true);
    src.onended = () => {
      playing.delete(src);
      if (!playing.size) h.onSpeaking(false);
    };
  };

  let userText = '', modelText = '', modelStarted = false, closed = false, muted = false;
  const onMessage = (m: LiveServerMessage) => {
    const c = m.serverContent;
    if (!c) return;
    if (c.inputTranscription?.text) {
      userText += c.inputTranscription.text;
      h.onUserText(userText);
    }
    const startModel = () => {
      if (modelStarted) return;
      modelStarted = true;
      userText = '';
      h.onModelStart();
    };
    for (const p of c.modelTurn?.parts ?? []) {
      if (p.inlineData?.data) {
        startModel();
        play(p.inlineData.data);
      }
    }
    if (c.outputTranscription?.text) {
      startModel();
      modelText += c.outputTranscription.text;
      h.onModelText(modelText);
    }
    if (c.interrupted) flush();
    if (c.turnComplete) {
      if (modelStarted) h.onTurnComplete();
      modelText = '';
      modelStarted = false;
    }
  };

  let session: Session | null = null;
  const cleanup = (error?: string) => {
    if (closed) return;
    closed = true;
    mic.getTracks().forEach((t) => t.stop());
    flush();
    void inCtx.close();
    void outCtx.close();
    session?.close();
    h.onClose(error);
  };

  try {
    const ai = new GoogleGenAI({ apiKey: token, httpOptions: { apiVersion: 'v1alpha' } });
    session = await ai.live.connect({
      model,
      // the real config is locked in the token; this only has to agree with it
      config: { responseModalities: [Modality.AUDIO], inputAudioTranscription: {}, outputAudioTranscription: {} },
      callbacks: {
        onmessage: onMessage,
        onerror: (e) => cleanup(e.message || 'Voice connection error'),
        onclose: (e) => cleanup(e.code === 1000 ? undefined : e.reason || 'Voice connection closed'),
      },
    });
  } catch (e) {
    cleanup();
    throw e;
  }

  const node = new AudioWorkletNode(inCtx, 'pcw-capture');
  node.port.onmessage = (e: MessageEvent<{ pcm: ArrayBuffer; level: number }>) => {
    if (closed) return;
    h.onLevel(muted ? 0 : Math.min(1, e.data.level * 4));
    if (!muted) session?.sendRealtimeInput({ audio: { data: toBase64(e.data.pcm), mimeType: 'audio/pcm;rate=16000' } });
  };
  inCtx.createMediaStreamSource(mic).connect(node);

  // nothing spoken yet: let the assistant open the conversation
  session.sendClientContent({ turns: [{ role: 'user', parts: [{ text: '[START] Begin or continue the conversation now.' }] }], turnComplete: true });

  return {
    note: (text) => session?.sendClientContent({ turns: [{ role: 'user', parts: [{ text }] }], turnComplete: false }),
    setMuted: (m) => { muted = m; },
    stop: () => cleanup(),
  };
}
