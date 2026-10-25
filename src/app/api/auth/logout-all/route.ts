import { NextResponse } from 'next/server';
import { withUser } from '@/server/api';
import { revokeSessions } from '@/server/auth';
import { SESSION_COOKIE } from '@/server/session';

/** Sign out on every device (this one included) — e.g. after using a shared PC or losing a laptop */
export const POST = withUser(async (me) => {
  await revokeSessions(me.id);
  const res = NextResponse.json({ data: true });
  res.cookies.set(SESSION_COOKIE, '', { httpOnly: true, path: '/', maxAge: 0 });
  return res;
});
