import { NextResponse } from 'next/server';
import { msConfig } from '@/server/microsoft';

// read from the environment on every request, not frozen at build time
export const dynamic = 'force-dynamic';

/** Which sign-in options the login page offers (public) */
export async function GET() {
  // demo account buttons: on outside production; SHOW_DEMO_ACCOUNTS=true turns them on in a test deployment
  const demo = process.env.SHOW_DEMO_ACCOUNTS === 'true' || process.env.NODE_ENV !== 'production';
  return NextResponse.json({ microsoft: !!msConfig(), demo });
}
