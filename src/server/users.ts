import bcrypt from 'bcryptjs';
import type { Profile } from '@/lib/types';
import { pool } from './db';

/** Profile helpers without Next.js request APIs (usable from scripts) */
export async function loadProfile(id: string): Promise<Profile | null> {
  const [rows] = await pool().query('SELECT * FROM profiles WHERE id = ? AND is_active = 1', [id]);
  const p = (rows as (Profile & { password_hash?: string | null })[])[0];
  if (!p) return null;
  const { password_hash: _h, ...rest } = p;
  void _h;
  return rest as Profile;
}

export async function hashPassword(pw: string) {
  return bcrypt.hash(pw, 10);
}
