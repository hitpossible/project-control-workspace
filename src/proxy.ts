import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, verifySession } from '@/server/session';

// Redirect anonymous users to /login. Authorization itself is enforced per request by the API (src/server/policies.ts).
export async function proxy(request: NextRequest) {
  const user = await verifySession(request.cookies.get(SESSION_COOKIE)?.value);
  const { pathname, search } = request.nextUrl;
  const isLogin = pathname.startsWith('/login');
  if (!user && !isLogin) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.search = '';
    url.searchParams.set('next', pathname + search);
    return NextResponse.redirect(url);
  }
  if (user && isLogin) return NextResponse.redirect(new URL('/', request.url));
  return NextResponse.next();
}

// Pages only: API routes check the session themselves (withUser), and running the proxy on them makes Next.js
// buffer request bodies with a 10 MB cap — larger uploads (SRS PDF, evidence) would arrive cut off
export const config = {
  matcher: ['/((?!api/|_next/static|_next/image|favicon.ico|fonts/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|woff|woff2|ttf)$).*)'],
};
