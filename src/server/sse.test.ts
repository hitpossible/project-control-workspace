import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { profile } from '../../test/fake-ctx';
import type { Session } from './auth';

const valid = vi.fn<(s: Session) => Promise<boolean>>();
vi.mock('./auth', () => ({ sessionStillValid: (s: Session) => valid(s) }));
const { eventStream } = await import('./sse');

const session: Session = { me: profile(11, ['developer']), version: 0, expiresAt: null };

/** opens a stream; returns everything written so far and whether the stream has ended */
type Subscribe = (send: (event: string, data: unknown) => void) => () => void;

function open(subscribe: Subscribe = () => () => {}) {
  const ac = new AbortController();
  const res = eventStream(new Request('http://localhost/api/x/stream', { signal: ac.signal }), session, subscribe);
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  const state = { text: '', done: false };
  (async () => {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return void (state.done = true);
      state.text += decoder.decode(value);
    }
  })();
  return { res, state, ac, subscribe };
}

const flush = () => vi.advanceTimersByTimeAsync(0);

describe('eventStream', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    valid.mockReset().mockResolvedValue(true);
  });
  afterEach(() => vi.useRealTimers());

  it('sends SSE headers, the retry hint and subscribed events', async () => {
    const { res, state } = open((send) => {
      send('notification', { id: 1 });
      return () => {};
    });
    await flush();
    expect(res.headers.get('Content-Type')).toBe('text/event-stream; charset=utf-8');
    expect(state.text).toBe('retry: 5000\n\nevent: notification\ndata: {"id":1}\n\n');
  });

  it('pings every 25 s and keeps going while the session is valid', async () => {
    const { state } = open();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(state.text.match(/: ping/g)).toHaveLength(4);
    expect(valid).toHaveBeenCalledTimes(2);
    expect(state.done).toBe(false);
  });

  it('says signed-out, unsubscribes and closes once the session is revoked', async () => {
    const off = vi.fn();
    const { state } = open(vi.fn(() => off));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(state.done).toBe(false);
    valid.mockResolvedValue(false);
    await vi.advanceTimersByTimeAsync(60_000);
    await flush();
    expect(state.text).toContain('event: signed-out\n');
    expect(off).toHaveBeenCalledOnce();
    expect(state.done).toBe(true);
    // no timers left behind
    valid.mockClear();
    await vi.advanceTimersByTimeAsync(300_000);
    expect(valid).not.toHaveBeenCalled();
  });

  it('keeps the stream when the session check itself fails (e.g. a DB hiccup)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    valid.mockRejectedValue(new Error('ECONNRESET'));
    const { state } = open();
    await vi.advanceTimersByTimeAsync(60_000);
    await flush();
    expect(state.done).toBe(false);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('unsubscribes when the client disconnects', async () => {
    const off = vi.fn();
    const { ac } = open(vi.fn(() => off));
    await flush();
    ac.abort();
    expect(off).toHaveBeenCalledOnce();
  });
});
