import { AppError } from './db';

/**
 * Login throttling: failed attempts are counted per username and per client IP in a sliding window; past the limit
 * that key is locked until the oldest counted failure leaves the window. In memory — the app runs as one instance;
 * a restart clears it. A successful login clears the username's count (not the IP's, so one known account
 * cannot be used to keep guessing others from the same machine).
 *
 *   LOGIN_MAX_FAILS (default 5) per username · LOGIN_MAX_FAILS_IP (default 30) per IP · LOGIN_WINDOW_MINUTES (default 15)
 */
const WINDOW_MS = Number(process.env.LOGIN_WINDOW_MINUTES ?? 15) * 60_000;
const MAX_USER = Number(process.env.LOGIN_MAX_FAILS ?? 5);
const MAX_IP = Number(process.env.LOGIN_MAX_FAILS_IP ?? 30);

// kept on globalThis so dev hot reloads don't reset it
const g = globalThis as unknown as { __loginFails?: Map<string, number[]> };
const fails = (g.__loginFails ??= new Map<string, number[]>());

function recent(key: string, now: number): number[] {
  const list = (fails.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  if (list.length) fails.set(key, list);
  else fails.delete(key);
  return list;
}

const keys = (username: string, ip: string | null) => ({ user: `u:${username.trim().toLowerCase()}`, ip: ip ? `ip:${ip}` : null });

/** Throws 429 (with seconds until retry) when this username or IP has too many recent failures */
export function assertLoginAllowed(username: string, ip: string | null) {
  const now = Date.now();
  const k = keys(username, ip);
  for (const [key, max] of [[k.user, MAX_USER], [k.ip, MAX_IP]] as const) {
    if (!key) continue;
    const list = recent(key, now);
    if (list.length >= max) {
      const retryAfter = Math.max(1, Math.ceil((list[list.length - max] + WINDOW_MS - now) / 1000));
      const minutes = Math.ceil(retryAfter / 60);
      throw new LoginLockedError(`Too many failed sign-in attempts. Please try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`, retryAfter);
    }
  }
}

export function recordLoginFailure(username: string, ip: string | null) {
  const now = Date.now();
  const k = keys(username, ip);
  for (const key of [k.user, k.ip]) if (key) fails.set(key, [...recent(key, now), now]);
  // stop the map growing without bound under a spray of random usernames
  if (fails.size > 10_000) for (const key of fails.keys()) recent(key, now);
}

export function recordLoginSuccess(username: string) {
  fails.delete(keys(username, null).user);
}

export class LoginLockedError extends AppError {
  constructor(message: string, readonly retryAfter: number) {
    super(message, 429);
  }
}

/** Client IP: the right-most X-Forwarded-For entry is the one our reverse proxy added (earlier ones are client-supplied) */
export function clientIp(req: Request): string | null {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',').map((s) => s.trim()).filter(Boolean).pop() ?? null;
  return req.headers.get('x-real-ip');
}
