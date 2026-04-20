import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { prisma } from '@/server/db';
import { getSession } from '@/server/session';
import { requireCapability } from '@/server/capabilities';
import { writeAudit } from '@/server/audit';
import {
  defaultRedirectUri,
  exchangeCodeForTokens,
  listTenants,
  saveXeroConnection,
} from '@/server/integrations/xero';

export const runtime = 'nodejs';
const STATE_COOKIE = 'xero.oauth.state';

export async function GET(req: Request) {
  const session = await getSession();
  try {
    requireCapability(session, 'integration.manage');
  } catch {
    return NextResponse.redirect(new URL('/api/auth/signin', req.url));
  }

  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const errorParam = url.searchParams.get('error');
  const errorDesc = url.searchParams.get('error_description');

  if (errorParam) {
    return NextResponse.redirect(
      new URL(
        `/admin/integrations/xero?error=${encodeURIComponent(`${errorParam}: ${errorDesc ?? ''}`)}`,
        req.url,
      ),
    );
  }

  const stored = cookies().get(STATE_COOKIE)?.value;
  cookies().delete(STATE_COOKIE);
  if (!state || !stored || stored !== state) {
    return NextResponse.redirect(
      new URL('/admin/integrations/xero?error=state_mismatch', req.url),
    );
  }
  if (!code) {
    return NextResponse.redirect(
      new URL('/admin/integrations/xero?error=missing_code', req.url),
    );
  }

  try {
    const tokens = await exchangeCodeForTokens(code, defaultRedirectUri());
    const tenants = await listTenants(tokens.accessToken);
    await saveXeroConnection(tokens, tenants, session.person.id);
    await prisma.$transaction(async (tx) => {
      await writeAudit(tx, {
        actor: { type: 'person', id: session.person.id },
        action: 'connected',
        entity: {
          type: 'integration',
          id: 'xero',
          after: {
            tenants: tenants.map((t) => ({ id: t.tenantId, name: t.tenantName })),
          },
        },
        source: 'web',
      });
    });
  } catch (err) {
    console.error('[xero/callback] token exchange failed:', err);
    const message = err instanceof Error ? err.message : 'unknown';
    return NextResponse.redirect(
      new URL(`/admin/integrations/xero?error=${encodeURIComponent(message)}`, req.url),
    );
  }

  return NextResponse.redirect(new URL('/admin/integrations/xero?connected=1', req.url));
}
