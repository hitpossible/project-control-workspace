import bcrypt from 'bcryptjs';
import type { Profile } from '@/lib/types';
import { pool } from './db';

/** profiles + department / section / position names (the table stores their ids) */
export const PROFILE_SELECT = `SELECT profiles.*, d.name department, s.name section, o.name position
  FROM profiles
  LEFT JOIN departments d ON d.id = profiles.department_id
  LEFT JOIN sections s ON s.id = profiles.section_id
  LEFT JOIN positions o ON o.id = profiles.position_id`;

/** Profile helpers without Next.js request APIs (usable from scripts) */
export async function loadProfile(id: number): Promise<Profile | null> {
  return (await loadProfileWithVersion(id))?.profile ?? null;
}

/** active profile + its current session_version (see revokeSessions) */
export async function loadProfileWithVersion(id: number): Promise<{ profile: Profile; sessionVersion: number } | null> {
  // ids are integers — never let MySQL coerce e.g. an old UUID session ("5f3e…") into user 5
  if (!/^\d+$/.test(String(id))) return null;
  const [rows] = await pool().query(`${PROFILE_SELECT} WHERE profiles.id = ? AND profiles.is_active = 1`, [id]);
  const p = (rows as (Profile & { password_hash?: string | null; session_version?: number })[])[0];
  if (!p) return null;
  const { password_hash: _h, session_version, ...rest } = p;
  void _h;
  return { profile: rest as Profile, sessionVersion: Number(session_version ?? 0) };
}

/** Sign the user out on every device: all session tokens issued before this call stop working */
export async function revokeSessions(id: number) {
  await pool().query('UPDATE profiles SET session_version = session_version + 1 WHERE id = ?', [id]);
}

export async function hashPassword(pw: string) {
  return bcrypt.hash(pw, 10);
}
