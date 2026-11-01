import { NextResponse } from 'next/server';
import { msConfig } from '@/server/microsoft';

/** Which sign-in options the login page offers (public) */
export async function GET() {
  return NextResponse.json({ microsoft: !!msConfig() });
}
