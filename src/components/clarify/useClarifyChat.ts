'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { AiCoverage, ChatMessage, IntakeForm } from '@/lib/clarify';
import { errMsg } from '@/lib/format';
import { startLive, type LiveCall } from '@/lib/geminiLive';
import { useApp } from '../AppProvider';

/** What one AI turn returns (text turn, or `assess` for a voice conversation) */
export type ClarifyTurn = {
  off?: boolean;
  message?: ChatMessage | null;
  coverage?: AiCoverage;
  done?: boolean;
  /** criterion keys the AI would ask about next (voice: passed on to Gemini) */
  asking?: string[];
  /** intake: form fields the AI filled in */
  form?: IntakeForm;
};

/** Where the chat talks to: an existing draft's clarification, or the intake of a new request */
export interface ClarifyApi {
  /** throws when the call fails */
  turn(body: { messages: ChatMessage[]; turns: number; assess?: boolean }): Promise<ClarifyTurn>;
  voiceEnabled(): Promise<boolean>;
  voiceToken(messages: ChatMessage[]): Promise<{ token: string; model: string } | { off: true }>;
  /** keep a voice transcript (the server only saves it when it checks a spoken answer); omit when the caller saves it */
  saveTranscript?(messages: ChatMessage[]): Promise<void>;
}

const post = async <T,>(url: string, body: unknown): Promise<T> => {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const json = await res.json();
  if (!res.ok || json.error) throw new Error(json.error?.message ?? res.statusText);
  return json.data as T;
};
const enabled = (url: string) => fetch(url).then((r) => r.json()).then((j) => !!j.data?.enabled).catch(() => false);

/** Clarification of the requestor's own saved draft, just before submit */
export function requestClarifyApi(requestId: number, lang: string, save: (messages: ChatMessage[]) => Promise<void>): ClarifyApi {
  const base = `/api/requests/${requestId}/clarify`;
  return {
    turn: (b) => post(base, { ...b, lang }),
    voiceEnabled: () => enabled(`${base}/voice`),
    voiceToken: (messages) => post(`${base}/voice`, { messages, lang }),
    saveTranscript: save,
  };
}

/** A new request written by talking to the AI — `form` is read on every call so the AI sees the requestor's edits */
export function intakeApi(documentTypeId: number, form: () => Record<string, unknown>, lang: string): ClarifyApi {
  const base = '/api/requests/intake';
  return {
    turn: (b) => post(base, { ...b, document_type_id: documentTypeId, form: form(), lang }),
    voiceEnabled: () => enabled(`${base}/voice`),
    voiceToken: (messages) => post(`${base}/voice`, { messages, document_type_id: documentTypeId, form: form(), lang }),
  };
}

/**
 * The AI chat itself — text turns, the criteria check, and the Gemini Live voice call — shared by the pre-submit
 * dialog (AiClarifyDialog) and the intake on the new request page (AiIntake). Layout is up to the caller.
 */
export function useClarifyChat({ api, initialMessages, initialCoverage, start, onOff, onResult }: {
  api: ClarifyApi;
  initialMessages: ChatMessage[];
  initialCoverage: AiCoverage | null;
  /** ask for the first AI message on mount */
  start: boolean;
  /** AI is off, or failed on the very first message */
  onOff: () => void;
  /** every successful turn (text or voice check) — e.g. to apply the intake form fields */
  onResult?: (data: ClarifyTurn) => void;
}) {
  const t = useTranslations('ai.clarify');
  useLocale(); // the API carries the language; re-render on a switch
  const { notify } = useApp();
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [coverage, setCoverage] = useState<AiCoverage | null>(initialCoverage);
  const [turns, setTurns] = useState(0);
  const [thinking, setThinking] = useState(false);
  const [failed, setFailed] = useState(false);
  const [done, setDone] = useState(false);
  const [typing, setTyping] = useState<number | null>(null);
  const [flash, setFlash] = useState<Set<string>>(new Set());
  const [input, setInput] = useState('');
  // voice (Gemini Live): it talks and asks; the company LLM still checks every spoken answer
  const [voiceOk, setVoiceOk] = useState(false);
  const [voice, setVoice] = useState<'off' | 'connecting' | 'live'>('off');
  const [liveUser, setLiveUser] = useState('');
  const [liveModel, setLiveModel] = useState('');
  const [speaking, setSpeaking] = useState(false);
  const [level, setLevel] = useState(0);
  const [muted, setMuted] = useState(false);
  const ctrl = useRef<AbortController | null>(null);
  const call = useRef<LiveCall | null>(null);
  const msgsRef = useRef(messages);
  const covRef = useRef(coverage);
  const draft = useRef({ user: '', model: '' });
  const assessing = useRef<{ busy: boolean; again: boolean }>({ busy: false, again: false });
  const scroller = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  // callback refs for the parts that render the chat (a ref object must not be read while rendering)
  const attachScroller = useCallback((el: HTMLDivElement | null) => { scroller.current = el; }, []);
  const attachInput = useCallback((el: HTMLTextAreaElement | null) => { inputRef.current = el; }, []);
  const focusInput = useCallback(() => inputRef.current?.focus(), []);
  // latest callbacks / api without restarting effects
  const cb = useRef({ api, onOff, onResult });
  useEffect(() => {
    cb.current = { api, onOff, onResult };
  });

  const scrollDown = (behavior: ScrollBehavior = 'smooth') => {
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior });
  };

  const commit = (next: ChatMessage[]) => {
    msgsRef.current = next;
    setMessages(next);
  };

  /** Show a new criteria check, briefly highlighting what the last answer covered */
  const applyCoverage = (next: AiCoverage) => {
    // a ref, not `coverage`: voice checks finish inside callbacks created before the last update
    const before = new Map(covRef.current?.criteria.map((x) => [x.key, x.status]));
    const changed = next.criteria.filter((x) => x.status !== 'missing' && before.get(x.key) !== x.status).map((x) => x.key);
    covRef.current = next;
    setCoverage(next);
    if (changed.length) {
      setFlash(new Set(changed));
      setTimeout(() => setFlash(new Set()), 1800);
    }
  };

  /** Ask the AI for its next message, given the conversation so far */
  const ask = async (msgs: ChatMessage[], n: number) => {
    const c = (ctrl.current = new AbortController());
    setThinking(true);
    setFailed(false);
    let data: ClarifyTurn;
    try {
      data = await cb.current.api.turn({ messages: msgs, turns: n });
    } catch {
      data = { message: null };
    } finally {
      if (ctrl.current === c) ctrl.current = null;
    }
    if (c.signal.aborted) return;
    setThinking(false);
    if (data.off || (!data.message && !msgs.length)) return cb.current.onOff();
    if (!data.message) return setFailed(true);

    if (data.coverage) applyCoverage(data.coverage);
    cb.current.onResult?.(data);
    commit([...msgs, data.message]);
    setTyping(msgs.length);
    setTurns(n + 1);
    setDone(!!data.done);
  };

  useEffect(() => {
    if (start) void ask(msgsRef.current, 0);
    requestAnimationFrame(() => scrollDown('auto'));
    return () => ctrl.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- start once
  }, []);

  useEffect(() => {
    scrollDown();
  }, [messages.length, thinking, failed, done, liveUser, liveModel]);

  useEffect(() => {
    let live = true;
    cb.current.api.voiceEnabled().then((ok) => live && setVoiceOk(ok));
    return () => {
      live = false;
      call.current?.stop();
    };
  }, []);

  /**
   * The company LLM checks the spoken conversation so far; the result goes to the checklist and, as a note, to Gemini
   * so its next question is about what is still missing. One check at a time — a newer answer re-runs it afterwards.
   */
  const assess = async () => {
    if (assessing.current.busy) {
      assessing.current.again = true;
      return;
    }
    assessing.current = { busy: true, again: false };
    try {
      const msgs = msgsRef.current;
      const data = await cb.current.api.turn({ messages: msgs, turns: msgs.filter((m) => m.role === 'assistant').length, assess: true });
      if (!data?.coverage) return;
      applyCoverage(data.coverage);
      cb.current.onResult?.(data);
      const missing = data.coverage.criteria.filter((c) => c.status === 'missing');
      const name = (k: string) => data.coverage!.criteria.find((c) => c.key === k)?.label ?? k;
      // notes for Gemini (never read out) — kept in English, its instructions are
      if (data.done) {
        setDone(true);
        call.current?.note('[DONE] Everything needed is covered.');
      } else {
        call.current?.note(`[CHECKLIST] Still missing: ${missing.map((c) => `${c.label}${c.required ? ' (required)' : ''}`).join(', ') || 'nothing'}.`
          + (data.asking?.length ? ` Ask next about: ${data.asking.map(name).join(', ')}.` : ''));
      }
    } catch {
      // the next answer is checked again anyway
    } finally {
      const again = assessing.current.again;
      assessing.current = { busy: false, again: false };
      if (again) void assess();
    }
  };

  const say = (role: ChatMessage['role'], text: string) => {
    const content = text.trim();
    if (content) commit([...msgsRef.current, { role, content, at: new Date().toISOString(), voice: true }]);
    return !!content;
  };

  const startVoice = async () => {
    if (voice !== 'off') return;
    ctrl.current?.abort();
    setThinking(false);
    setVoice('connecting');
    setMuted(false);
    draft.current = { user: '', model: '' };
    try {
      const tok = await cb.current.api.voiceToken(msgsRef.current);
      if ('off' in tok) throw new Error(t('voiceOff'));
      call.current = await startLive(tok.token, tok.model, {
        onUserText: (text) => { draft.current.user = text; setLiveUser(text); },
        onModelStart: () => {
          // the user's answer is complete: show it and have it checked while the assistant talks
          if (say('user', draft.current.user)) void assess();
          draft.current.user = '';
          setLiveUser('');
        },
        onModelText: (text) => { draft.current.model = text; setLiveModel(text); },
        onTurnComplete: () => {
          if (say('assistant', draft.current.model)) setTurns((n) => n + 1);
          draft.current.model = '';
          setLiveModel('');
        },
        onLevel: setLevel,
        onSpeaking: setSpeaking,
        onClose: (error) => {
          call.current = null;
          // keep whatever was said before the call ended
          say('assistant', draft.current.model);
          if (say('user', draft.current.user)) void assess();
          draft.current = { user: '', model: '' };
          setLiveUser('');
          setLiveModel('');
          setSpeaking(false);
          setLevel(0);
          setVoice('off');
          if (error) notify(t('voiceStopped', { error }), 'error');
        },
      });
      setVoice('live');
    } catch (e) {
      call.current = null;
      setVoice('off');
      notify(e instanceof Error && e.name === 'NotAllowedError' ? t('allowMic') : t('voiceUnavailable', { error: errMsg(e) }), 'error');
    }
  };

  const stopVoice = () => call.current?.stop();

  /**
   * End a voice call and keep the transcript: the server only saves it when it checks a spoken answer, so the
   * assistant's last words (e.g. the thank-you after [DONE]) would otherwise be lost. Text chats are already saved.
   */
  const endVoice = async () => {
    call.current?.stop(); // closes synchronously: the unfinished turn is added to msgsRef
    if (!msgsRef.current.some((m) => m.voice) || !cb.current.api.saveTranscript) return;
    try {
      await cb.current.api.saveTranscript(msgsRef.current);
    } catch (e) {
      notify(errMsg(e), 'error');
    }
  };

  /** stop whatever is running (pending turn, voice call) */
  const halt = () => {
    ctrl.current?.abort();
    call.current?.stop();
    setThinking(false);
  };

  const send = (text: string) => {
    const content = text.trim();
    if (!content || thinking || typing !== null) return;
    const next = [...msgsRef.current, { role: 'user' as const, content, at: new Date().toISOString() }];
    commit(next);
    setInput('');
    setDone(false);
    void ask(next, turns);
  };

  const toggleMute = () => {
    const m = !muted;
    setMuted(m);
    call.current?.setMuted(m);
  };

  return {
    messages, coverage, turns, thinking, failed, done, typing, setTyping, flash, input, setInput,
    voiceOk, voice, liveUser, liveModel, speaking, level, muted, toggleMute,
    /** the transcript right now, including a voice turn cut short by halt() */
    getMessages: () => msgsRef.current,
    attachScroller, attachInput, focusInput, scrollDown, retry: () => ask(msgsRef.current, turns), send, startVoice, stopVoice, endVoice, halt,
  };
}

export type ClarifyChat = ReturnType<typeof useClarifyChat>;
