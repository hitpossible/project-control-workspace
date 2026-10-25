import { jwtVerify } from 'jose';

/** Shared by the proxy (edge-safe: no DB access) and the auth module */
export const SESSION_COOKIE = 'pcw_session';

export function sessionSecret(): Uint8Array {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 32) throw new Error('AUTH_SECRET must be set (at least 32 characters)');
  return new TextEncoder().encode(s);
}

/**
 * User id + session version from the session, or null (sessions from before the INT ids carry a UUID and are rejected).
 * Signature and expiry only — whether the version is still current needs the database (currentUser in auth.ts).
 */
export async function readSession(token: string | undefined): Promise<{ uid: number; version: number } | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, sessionSecret());
    if (!payload.sub || !/^\d+$/.test(payload.sub)) return null;
    return { uid: Number(payload.sub), version: typeof payload.sv === 'number' ? payload.sv : 0 };
  } catch {
    return null;
  }
}

export async function verifySession(token: string | undefined): Promise<number | null> {
  return (await readSession(token))?.uid ?? null;
}
