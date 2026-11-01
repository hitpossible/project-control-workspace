import { NextResponse } from 'next/server';
import { authenticateByEmail, createSession } from '@/server/auth';
import { AppError } from '@/server/db';
import { emailFromCode, MS_COOKIE, msConfig, safeNext } from '@/server/microsoft';

/** Microsoft sends the person back here with ?code=…; on success the usual session cookie is set */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const fail = (code: string) => {
    const res = NextResponse.redirect(new URL(`/login?error=${code}`, url));
    res.cookies.delete({ name: MS_COOKIE, path: '/api/auth/microsoft' });
    return res;
  };
  const c = msConfig();
  if (!c) return fail('ms_off');
  const cookie = req.headers.get('cookie')?.split(/;\s*/).find((x) => x.startsWith(`${MS_COOKIE}=`));
  let attempt: { state: string; nonce: string; verifier: string; next: string } | null = null;
  try {
    attempt = cookie ? JSON.parse(decodeURIComponent(cookie.slice(MS_COOKIE.length + 1))) : null;
  } catch { /* treated as missing */ }
  const code = url.searchParams.get('code');
  if (url.searchParams.get('error') || !code || !attempt || url.searchParams.get('state') !== attempt.state) return fail('ms_failed');

  try {
    const me = await authenticateByEmail(await emailFromCode(c, code, attempt));
    const s = await createSession(me.id);
    const res = NextResponse.redirect(new URL(safeNext(attempt.next), url));
    res.cookies.set(s.name, s.value, { httpOnly: true, sameSite: 'lax', secure: process.env.COOKIE_SECURE === 'true', path: '/', maxAge: s.maxAge });
    res.cookies.delete({ name: MS_COOKIE, path: '/api/auth/microsoft' });
    return res;
  } catch (e) {
    return fail(e instanceof AppError && e.status === 403 ? 'ms_unregistered' : 'ms_failed');
  }
}
