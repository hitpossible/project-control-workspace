import { createHash, randomBytes } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { AppError } from './db';

/**
 * "Sign in with Microsoft" (Entra ID, OpenID Connect authorization-code flow with PKCE).
 * Turned on by MICROSOFT_CLIENT_ID + MICROSOFT_CLIENT_SECRET + MICROSOFT_TENANT_ID. Only people who already have an
 * active profile (matched by e-mail / user principal name) can sign in this way — nobody is created from a Microsoft login.
 */
export const MS_COOKIE = 'pcw_ms';

export function msConfig() {
  const clientId = process.env.MICROSOFT_CLIENT_ID;
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;
  const tenant = process.env.MICROSOFT_TENANT_ID;
  if (!clientId || !clientSecret || !tenant) return null;
  const base = (process.env.APP_URL ?? 'http://localhost:3000').replace(/\/$/, '');
  return { clientId, clientSecret, tenant, redirectUri: `${base}/api/auth/microsoft/callback` };
}

const authority = (tenant: string) => `https://login.microsoftonline.com/${tenant}`;
const b64url = (b: Buffer) => b.toString('base64url');

/** Random state / nonce / PKCE verifier for one sign-in attempt (kept in a short-lived httpOnly cookie) */
export function newAttempt(next: string) {
  const verifier = b64url(randomBytes(32));
  return { state: b64url(randomBytes(16)), nonce: b64url(randomBytes(16)), verifier, next: safeNext(next) };
}

/** Only same-site paths: never redirect to an address handed in through the query string */
export function safeNext(next: string | null | undefined): string {
  return next && /^\/(?![/\\])/.test(next) ? next : '/';
}

export function authorizeUrl(c: NonNullable<ReturnType<typeof msConfig>>, a: ReturnType<typeof newAttempt>) {
  const q = new URLSearchParams({
    client_id: c.clientId, response_type: 'code', redirect_uri: c.redirectUri, response_mode: 'query',
    scope: 'openid profile email', state: a.state, nonce: a.nonce, prompt: 'select_account',
    code_challenge: b64url(createHash('sha256').update(a.verifier).digest()), code_challenge_method: 'S256',
  });
  return `${authority(c.tenant)}/oauth2/v2.0/authorize?${q}`;
}

/** Trade the code for tokens and return the verified e-mail / UPN of the signed-in person */
export async function emailFromCode(c: NonNullable<ReturnType<typeof msConfig>>, code: string, a: { verifier: string; nonce: string }): Promise<string> {
  const res = await fetch(`${authority(c.tenant)}/oauth2/v2.0/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: c.clientId, client_secret: c.clientSecret, grant_type: 'authorization_code', code,
      redirect_uri: c.redirectUri, code_verifier: a.verifier,
    }),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
  const body = (await res?.json().catch(() => null)) as { id_token?: string } | null;
  if (!res?.ok || !body?.id_token) throw new AppError('Microsoft sign-in failed', 401);

  const jwks = createRemoteJWKSet(new URL(`${authority(c.tenant)}/discovery/v2.0/keys`));
  const { payload } = await jwtVerify(body.id_token, jwks, { audience: c.clientId }).catch(() => {
    throw new AppError('Microsoft sign-in failed', 401);
  });
  const tid = String(payload.tid ?? '');
  const tenantOk = ['common', 'organizations', 'consumers'].includes(c.tenant) || c.tenant.toLowerCase() === tid.toLowerCase() || !/^[0-9a-f-]{36}$/i.test(c.tenant);
  if (payload.nonce !== a.nonce || payload.iss !== `https://login.microsoftonline.com/${tid}/v2.0` || !tenantOk) throw new AppError('Microsoft sign-in failed', 401);
  const email = String(payload.preferred_username ?? payload.email ?? '').trim().toLowerCase();
  if (!email) throw new AppError('Your Microsoft account has no e-mail address', 403);
  return email;
}
