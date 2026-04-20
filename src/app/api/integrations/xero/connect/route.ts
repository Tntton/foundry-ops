import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { randomBytes } from 'node:crypto';
import { getSession } from '@/server/session';
import { requireCapability } from '@/server/capabilities';
import { buildAuthorizeUrl, defaultRedirectUri, xeroConfigured } from '@/server/integrations/xero';

export const runtime = 'nodejs';
const STATE_COOKIE = 'xero.oauth.state';

export async function GET() {
  const session = await getSession();
  try {
    requireCapability(session, 'integration.manage');
  } catch {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  if (!xeroConfigured()) {
    return NextResponse.json({ error: 'Xero credentials not configured' }, { status: 503 });
  }

  const state = randomBytes(24).toString('base64url');
  cookies().set(STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env['NODE_ENV'] === 'production',
    path: '/api/integrations/xero',
    maxAge: 10 * 60,
  });

  const url = buildAuthorizeUrl(state, defaultRedirectUri());
  console.log('[xero/connect] redirecting to:', url);
  return NextResponse.redirect(url);
}
