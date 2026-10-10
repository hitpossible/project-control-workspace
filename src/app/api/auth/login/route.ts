import { NextResponse } from 'next/server';
import { errorResponse } from '@/server/api';
import { authenticate, createSession } from '@/server/auth';

export async function POST(req: Request) {
  try {
    const { username, password } = await req.json();
    const me = await authenticate(String(username ?? ''), String(password ?? ''));
    const s = await createSession(me.id);
    const res = NextResponse.json({ data: me });
    res.cookies.set(s.name, s.value, { httpOnly: true, sameSite: 'lax', secure: process.env.COOKIE_SECURE === 'true', path: '/', maxAge: s.maxAge });
    return res;
  } catch (e) {
    return errorResponse(e);
  }
}
