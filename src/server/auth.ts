import bcrypt from 'bcryptjs';
import { SignJWT } from 'jose';
import { cookies } from 'next/headers';
import type { Profile } from '@/lib/types';
import { AppError, pool } from './db';
import { readSession, SESSION_COOKIE, sessionSecret } from './session';
import { loadProfile, loadProfileWithVersion } from './users';

export { hashPassword, loadProfile, revokeSessions } from './users';

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

const lookupId = async (sql: string, params: unknown[]) => {
  const [rows] = await pool().query(sql, params);
  return ((rows as { id: number }[])[0]?.id) ?? null;
};

/**
 * Department / Section / Position from AD → ids in the master tables (matched by name, case-insensitive).
 * Department names can repeat across plants, so the section picks the department when both are sent.
 * A key AD does not send is left alone; a name that is not in the table becomes null.
 */
export async function adMasterIds(info: Record<string, unknown>) {
  const out: Record<string, number | null> = {};
  const dept = pick(info, 'department', 'dept')?.trim() ?? null;
  const section = pick(info, 'section', 'division')?.trim() ?? null;
  const position = pick(info, 'position')?.trim() ?? null;
  if (dept !== null) {
    const [rows] = section !== null
      ? await pool().query(
        'SELECT s.id section_id, s.department_id FROM sections s JOIN departments d ON d.id = s.department_id WHERE d.name = ? AND s.name = ? ORDER BY d.id LIMIT 1',
        [dept, section])
      : [[]];
    const hit = (rows as { section_id: number; department_id: number }[])[0];
    out.department_id = hit?.department_id ?? await lookupId('SELECT id FROM departments WHERE name = ? ORDER BY id LIMIT 1', [dept]);
    if (section !== null) out.section_id = hit?.section_id ?? null;
  } else if (section !== null) {
    out.section_id = await lookupId('SELECT id FROM sections WHERE name = ? ORDER BY id LIMIT 1', [section]);
  }
  if (position !== null) out.position_id = await lookupId('SELECT id FROM positions WHERE name = ? ORDER BY id LIMIT 1', [position]);
  return out;
}

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
      const ids = await adMasterIds(ad.info);
      if (!profile) {
        if (process.env.AD_AUTO_PROVISION === 'false') throw new AppError('Your account is not registered in Project Control. Please contact the administrator.', 403);
        await pool().query(
          'INSERT INTO profiles(username, full_name, email, employee_id, department_id, section_id, position_id, roles) VALUES (?,?,?,?,?,?,?,?)',
          [username, pick(ad.info, 'full_name', 'fullName', 'fullname', 'displayName', 'display_name', 'name') ?? username,
            pick(ad.info, 'email', 'mail', 'userPrincipalName'), pick(ad.info, 'employee_id', 'employeeId', 'employeeID', 'emp_id'),
            ids.department_id ?? null, ids.section_id ?? null, ids.position_id ?? null, JSON.stringify(['requestor'])]);
        profile = await findProfile(username);
      } else if (Object.keys(ids).length) {
        // keep department / section / position in step with AD on every login
        const cols = Object.keys(ids);
        await pool().query(`UPDATE profiles SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`, [...cols.map((c) => ids[c]), profile.id]);
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

export async function createSession(userId: number): Promise<{ name: string; value: string; maxAge: number }> {
  const [rows] = await pool().query('SELECT session_version FROM profiles WHERE id = ?', [userId]);
  const sv = Number((rows as { session_version: number }[])[0]?.session_version ?? 0);
  const value = await new SignJWT({ sv }).setProtectedHeader({ alg: 'HS256' }).setSubject(String(userId))
    .setIssuedAt().setExpirationTime(`${SESSION_HOURS}h`).sign(sessionSecret());
  return { name: SESSION_COOKIE, value, maxAge: SESSION_HOURS * 3600 };
}

/** Current user from the session cookie (null if signed out / inactive / the session was revoked) */
export async function currentUser(): Promise<Profile | null> {
  return (await currentSession())?.me ?? null;
}

export type Session = { me: Profile; version: number; expiresAt: number | null };

/** currentUser plus the token's session version and expiry — for long-lived connections that must re-check it */
export async function currentSession(): Promise<Session | null> {
  const s = await readSession((await cookies()).get(SESSION_COOKIE)?.value);
  if (!s) return null;
  const u = await loadProfileWithVersion(s.uid);
  return u && u.sessionVersion === s.version ? { me: u.profile, version: s.version, expiresAt: s.expiresAt } : null;
}

/** Whether a session read earlier still holds: not expired, user still active, not revoked since */
export async function sessionStillValid(s: Session, now = Date.now()): Promise<boolean> {
  if (s.expiresAt !== null && now >= s.expiresAt) return false;
  const u = await loadProfileWithVersion(s.me.id);
  return !!u && u.sessionVersion === s.version;
}
