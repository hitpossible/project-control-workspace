import { jwtVerify } from 'jose';

/** Shared by the proxy (edge-safe: no DB access) and the auth module */
export const SESSION_COOKIE = 'pcw_session';

export function sessionSecret(): Uint8Array {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 32) throw new Error('AUTH_SECRET must be set (at least 32 characters)');
  return new TextEncoder().encode(s);
}

export async function verifySession(token: string | undefined): Promise<string | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, sessionSecret());
    return payload.sub ?? null;
  } catch {
    return null;
  }
}
