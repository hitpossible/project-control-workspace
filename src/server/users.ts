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
  // ids are integers — never let MySQL coerce e.g. an old UUID session ("5f3e…") into user 5
  if (!/^\d+$/.test(String(id))) return null;
  const [rows] = await pool().query(`${PROFILE_SELECT} WHERE profiles.id = ? AND profiles.is_active = 1`, [id]);
  const p = (rows as (Profile & { password_hash?: string | null })[])[0];
  if (!p) return null;
  const { password_hash: _h, ...rest } = p;
  void _h;
  return rest as Profile;
}

export async function hashPassword(pw: string) {
  return bcrypt.hash(pw, 10);
}
