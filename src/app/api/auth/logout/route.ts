import { NextResponse } from 'next/server';
import { SESSION_COOKIE } from '@/server/session';

export async function POST() {
  const res = NextResponse.json({ data: true });
  res.cookies.set(SESSION_COOKIE, '', { httpOnly: true, path: '/', maxAge: 0 });
  return res;
}
