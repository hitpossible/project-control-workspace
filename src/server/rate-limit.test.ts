import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { assertLoginAllowed, clientIp, LoginLockedError, recordLoginFailure, recordLoginSuccess } from './rate-limit';

const fail = (user: string, ip: string | null, times: number) => {
  for (let i = 0; i < times; i++) recordLoginFailure(user, ip);
};

describe('login rate limit', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-25T08:00:00Z'));
    (globalThis as { __loginFails?: Map<string, number[]> }).__loginFails?.clear();
  });
  afterEach(() => vi.useRealTimers());

  it('allows the first 4 failures and locks the username on the 5th', () => {
    fail('dev1', null, 4);
    expect(() => assertLoginAllowed('dev1', null)).not.toThrow();
    recordLoginFailure('dev1', null);
    expect(() => assertLoginAllowed('dev1', null)).toThrow(LoginLockedError);
  });

  it('answers 429 with the seconds until the oldest failure leaves the 15-minute window', () => {
    fail('dev1', null, 5);
    vi.advanceTimersByTime(5 * 60_000);
    try {
      assertLoginAllowed('dev1', null);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(LoginLockedError);
      expect((e as LoginLockedError).status).toBe(429);
      expect((e as LoginLockedError).retryAfter).toBe(10 * 60);
    }
  });

  it('unlocks once the window has passed', () => {
    fail('dev1', null, 5);
    vi.advanceTimersByTime(15 * 60_000);
    expect(() => assertLoginAllowed('dev1', null)).not.toThrow();
  });

  it('treats usernames case- and space-insensitively', () => {
    fail(' DEV1 ', null, 5);
    expect(() => assertLoginAllowed('dev1', null)).toThrow(LoginLockedError);
  });

  it('does not lock other usernames', () => {
    fail('dev1', null, 5);
    expect(() => assertLoginAllowed('dev2', null)).not.toThrow();
  });

  it('a successful login clears the username count but not the IP count', () => {
    fail('dev1', '10.0.0.1', 4);
    recordLoginSuccess('dev1');
    fail('dev1', '10.0.0.1', 4);
    expect(() => assertLoginAllowed('dev1', '10.0.0.1')).not.toThrow();
    // 8 failures from the IP so far; 30 locks it whatever the username
    for (let i = 0; i < 22; i++) recordLoginFailure(`user${i}`, '10.0.0.1');
    expect(() => assertLoginAllowed('someone-new', '10.0.0.1')).toThrow(LoginLockedError);
    expect(() => assertLoginAllowed('someone-new', '10.0.0.2')).not.toThrow();
  });
});

describe('clientIp', () => {
  const req = (headers: Record<string, string>) => new Request('http://localhost/api/auth/login', { headers });

  it('takes the right-most X-Forwarded-For entry (the one our proxy added)', () => {
    expect(clientIp(req({ 'x-forwarded-for': '1.2.3.4, 192.168.1.20' }))).toBe('192.168.1.20');
  });

  it('falls back to X-Real-IP, then null', () => {
    expect(clientIp(req({ 'x-real-ip': '192.168.1.30' }))).toBe('192.168.1.30');
    expect(clientIp(req({}))).toBeNull();
  });
});
