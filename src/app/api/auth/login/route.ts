import { NextResponse } from 'next/server';
import { errorResponse } from '@/server/api';
import { authenticate, createSession } from '@/server/auth';
import { AppError } from '@/server/db';
import { assertLoginAllowed, clientIp, LoginLockedError, recordLoginFailure, recordLoginSuccess } from '@/server/rate-limit';

export async function POST(req: Request) {
  try {
    const { username, password } = await req.json();
    const login = String(username ?? '');
    const ip = clientIp(req);
    assertLoginAllowed(login, ip);
    const me = await authenticate(login, String(password ?? '')).catch((e) => {
      // only wrong credentials count — not "AD unreachable" or an inactive account
      if (e instanceof AppError && e.status === 401) recordLoginFailure(login, ip);
      throw e;
    });
    recordLoginSuccess(login);
    const s = await createSession(me.id);
    const res = NextResponse.json({ data: me });
    res.cookies.set(s.name, s.value, { httpOnly: true, sameSite: 'lax', secure: process.env.COOKIE_SECURE === 'true', path: '/', maxAge: s.maxAge });
    return res;
  } catch (e) {
    const res = errorResponse(e);
    if (e instanceof LoginLockedError) res.headers.set('Retry-After', String(e.retryAfter));
    return res;
  }
}
