import { NextResponse } from 'next/server';
import { authorizeUrl, MS_COOKIE, msConfig, newAttempt } from '@/server/microsoft';

/** Start "Sign in with Microsoft": remember state / nonce / PKCE verifier, then go to Microsoft */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const c = msConfig();
  if (!c) return NextResponse.redirect(new URL('/login?error=ms_off', url));
  const attempt = newAttempt(url.searchParams.get('next') ?? '/');
  const res = NextResponse.redirect(authorizeUrl(c, attempt));
  res.cookies.set(MS_COOKIE, JSON.stringify(attempt), { httpOnly: true, sameSite: 'lax', secure: process.env.COOKIE_SECURE === 'true', path: '/api/auth/microsoft', maxAge: 600 });
  return res;
}
