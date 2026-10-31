import { createHash, randomBytes } from 'node:crypto';
import type { Profile } from '@/lib/types';
import { AppError, pool } from './db';
import { loadProfile } from './users';

/**
 * Personal access tokens (table api_tokens). Format: "pcw_" + 43 base64url characters (256 random bits).
 * Only the SHA-256 is stored — a random token that long needs no slow hash.
 */
const PREFIX = 'pcw_';
const MAX_PER_USER = 10;
const MAX_DAYS = 365;

export type TokenScope = 'read' | 'write';
export const TOKEN_SCOPES: TokenScope[] = ['read', 'write'];

export type ApiToken = { id: number; name: string; scope: TokenScope; token_prefix: string; expires_at: string | null; last_used_at: string | null; created_at: string };

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export function newToken(): string {
  return PREFIX + randomBytes(32).toString('base64url');
}

/** The bearer token from an Authorization header, or null when there is none / it is not one of ours */
export function bearerToken(req: Request): string | null {
  const m = /^Bearer\s+(\S+)$/i.exec(req.headers.get('authorization') ?? '');
  return m && m[1].startsWith(PREFIX) ? m[1] : null;
}

export async function listTokens(userId: number): Promise<ApiToken[]> {
  const [rows] = await pool().query(
    `SELECT id, name, scope, token_prefix, expires_at, last_used_at, created_at FROM api_tokens
      WHERE user_id = ? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > UTC_TIMESTAMP(3)) ORDER BY id DESC`,
    [userId]);
  return rows as ApiToken[];
}

/** Create a token; the plain value is returned here only — it cannot be read back later */
export async function createToken(userId: number, nameRaw: unknown, daysRaw: unknown, scopeRaw: unknown = 'read'): Promise<ApiToken & { token: string }> {
  const name = String(nameRaw ?? '').trim().slice(0, 100);
  if (!name) throw new AppError('Enter a name for the token', 400);
  const days = daysRaw === null || daysRaw === undefined || daysRaw === '' ? null : Number(daysRaw);
  if (days !== null && (!Number.isInteger(days) || days < 1 || days > MAX_DAYS)) throw new AppError(`Expiry must be 1–${MAX_DAYS} days`, 400);
  const scope = String(scopeRaw ?? 'read') as TokenScope;
  if (!TOKEN_SCOPES.includes(scope)) throw new AppError('Scope must be read or write', 400);
  if ((await listTokens(userId)).length >= MAX_PER_USER) throw new AppError(`You can have at most ${MAX_PER_USER} active tokens — revoke one first`, 400);

  const token = newToken();
  const [res] = await pool().query(
    `INSERT INTO api_tokens(user_id, name, scope, token_hash, token_prefix, expires_at)
     VALUES (?, ?, ?, ?, ?, ${days === null ? 'NULL' : 'UTC_TIMESTAMP(3) + INTERVAL ? DAY'})`,
    [userId, name, scope, hashToken(token), token.slice(0, PREFIX.length + 6), ...(days === null ? [] : [days])]);
  const id = (res as { insertId: number }).insertId;
  const row = (await listTokens(userId)).find((t) => t.id === id)!;
  return { ...row, token };
}

export async function revokeToken(userId: number, id: number) {
  const [res] = await pool().query('UPDATE api_tokens SET revoked_at = UTC_TIMESTAMP(3) WHERE id = ? AND user_id = ? AND revoked_at IS NULL', [id, userId]);
  if (!(res as { affectedRows: number }).affectedRows) throw new AppError('Token not found', 404);
}

/** The active user a token belongs to + the token's scope, or null (unknown / revoked / expired token, or inactive user) */
export async function userFromToken(token: string): Promise<{ me: Profile; scope: TokenScope } | null> {
  const [rows] = await pool().query(
    `SELECT id, user_id, scope, last_used_at FROM api_tokens
      WHERE token_hash = ? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > UTC_TIMESTAMP(3))`,
    [hashToken(token)]);
  const hit = (rows as { id: number; user_id: number; scope: TokenScope; last_used_at: string | null }[])[0];
  if (!hit) return null;
  // a write per request is wasteful — once a minute is enough to show "last used"
  if (!hit.last_used_at || Date.now() - Date.parse(hit.last_used_at) > 60_000) {
    await pool().query('UPDATE api_tokens SET last_used_at = UTC_TIMESTAMP(3) WHERE id = ?', [hit.id]);
  }
  const me = await loadProfile(hit.user_id);
  return me ? { me, scope: hit.scope } : null;
}
