import bcrypt from 'bcryptjs';
import { SignJWT } from 'jose';
import { cookies } from 'next/headers';
import type { Profile } from '@/lib/types';
import { AppError, pool, uuid } from './db';
import { SESSION_COOKIE, sessionSecret, verifySession } from './session';
import { loadProfile } from './users';

export { hashPassword, loadProfile } from './users';

/**
 * Login: company AD endpoint (AUTH_PROVIDERS contains "ad") and/or local password
 * (accounts with password_hash — seed / break-glass admin). Session = signed JWT in an httpOnly cookie.
 */
const SESSION_HOURS = Number(process.env.SESSION_HOURS ?? 12);
const providers = () => (process.env.AUTH_PROVIDERS ?? 'ad,local').split(',').map((s) => s.trim());

type DbProfile = Profile & { username: string | null; password_hash: string | null };

async function findProfile(login: string): Promise<DbProfile | null> {
  const [rows] = await pool().query('SELECT * FROM profiles WHERE username = ? OR email = ? LIMIT 1', [login, login]);
  return ((rows as DbProfile[])[0]) ?? null;
}

type AdResult = { ok: boolean; reachable: boolean; info: Record<string, unknown> };

/** POST {username, password} to the AD login service. Success = HTTP 2xx without an explicit failure flag. */
async function adLogin(username: string, password: string): Promise<AdResult> {
  const url = process.env.AD_LOGIN_URL;
  if (!url) return { ok: false, reachable: false, info: {} };
  try {
    const res = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }),
      signal: AbortSignal.timeout(Number(process.env.AD_TIMEOUT_MS ?? 8000)),
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const failed = body.success === false || body.status === false || body.status === 'fail' || body.status === 'error' || !!body.error;
    return { ok: res.ok && !failed, reachable: true, info: (body.data && typeof body.data === 'object' ? body.data : body.user && typeof body.user === 'object' ? body.user : body) as Record<string, unknown> };
  } catch (e) {
    console.warn('[auth] AD login service unreachable:', e instanceof Error ? e.message : e);
    return { ok: false, reachable: false, info: {} };
  }
}

const pick = (o: Record<string, unknown>, ...keys: string[]) => {
  for (const k of keys) if (typeof o[k] === 'string' && o[k]) return String(o[k]);
  return null;
};

export async function authenticate(loginRaw: string, password: string): Promise<Profile> {
  const login = loginRaw.trim();
  if (!login || !password) throw new AppError('Enter username and password', 400);
  const p = providers();
  let profile = await findProfile(login);

  // Local accounts (seed / break-glass) are checked first; AD-only users have no password_hash
  if (p.includes('local') && profile?.password_hash && (await bcrypt.compare(password, profile.password_hash))) return finish(profile);

  if (p.includes('ad')) {
    const username = login.includes('@') ? (profile?.username ?? login.split('@')[0]) : login;
    const ad = await adLogin(username, password);
    if (ad.ok) {
      if (!profile) profile = await findProfile(username);
      if (!profile) {
        if (process.env.AD_AUTO_PROVISION === 'false') throw new AppError('Your account is not registered in Project Control. Please contact the administrator.', 403);
        await pool().query(
          'INSERT INTO profiles(id, username, full_name, email, employee_id, department, section, roles) VALUES (?,?,?,?,?,?,?,?)',
          [uuid(), username, pick(ad.info, 'full_name', 'fullName', 'fullname', 'displayName', 'display_name', 'name') ?? username,
            pick(ad.info, 'email', 'mail', 'userPrincipalName'), pick(ad.info, 'employee_id', 'employeeId', 'employeeID', 'emp_id'),
            pick(ad.info, 'department', 'dept'), pick(ad.info, 'section', 'division'), JSON.stringify(['requestor'])]);
        profile = await findProfile(username);
      }
      return finish(profile!);
    }
    if (!ad.reachable && !profile?.password_hash) throw new AppError('Cannot reach the company login service (AD). Please try again later.', 503);
  }
  throw new AppError('Invalid username or password', 401);
}

async function finish(p: DbProfile): Promise<Profile> {
  if (!p.is_active) throw new AppError('Your account is inactive. Please contact the administrator.', 403);
  await pool().query('UPDATE profiles SET last_login_at = UTC_TIMESTAMP(3) WHERE id = ?', [p.id]);
  return (await loadProfile(p.id))!;
}

export async function createSession(userId: string): Promise<{ name: string; value: string; maxAge: number }> {
  const value = await new SignJWT({}).setProtectedHeader({ alg: 'HS256' }).setSubject(userId)
    .setIssuedAt().setExpirationTime(`${SESSION_HOURS}h`).sign(sessionSecret());
  return { name: SESSION_COOKIE, value, maxAge: SESSION_HOURS * 3600 };
}

/** Current user from the session cookie (null if signed out / inactive) */
export async function currentUser(): Promise<Profile | null> {
  const id = await verifySession((await cookies()).get(SESSION_COOKIE)?.value);
  return id ? loadProfile(id) : null;
}
