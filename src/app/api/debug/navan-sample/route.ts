import { NextResponse } from 'next/server';
import { prisma } from '@/server/db';
import { getSession } from '@/server/session';
import { hasAnyRole } from '@/server/roles';
import { getNavanIntegration } from '@/server/integrations/navan';
import { decryptJson } from '@/server/crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * TEMPORARY debug endpoint — dumps the raw Navan booking shape so we can
 * see exactly which email fields (if any) Navan's API returns. Pulls
 * the last 30 days directly, ignoring the watermark, so the sync that
 * already ran doesn't matter. Super_admin only.
 */
export async function GET() {
  const session = await getSession();
  if (!hasAnyRole(session, ['super_admin'])) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  try {
    const integration = await getNavanIntegration();
    if (!integration || integration.status !== 'connected') {
      return NextResponse.json({ error: 'not connected' }, { status: 500 });
    }
    const cfg = (integration.config ?? {}) as {
      credentials: string;
      tokenUrl?: string;
      bookingsUrl?: string;
    };
    const { apiKey, apiSecret } = decryptJson<{ apiKey: string; apiSecret: string }>(
      cfg.credentials,
    );

    // Exchange creds for access token
    const tokenUrl = cfg.tokenUrl || 'https://api.navan.com/ta-auth/oauth/token';
    const tokenRes = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: apiKey,
        client_secret: apiSecret,
      }),
    });
    if (!tokenRes.ok) {
      return NextResponse.json(
        { stage: 'token', status: tokenRes.status, body: await tokenRes.text() },
        { status: 500 },
      );
    }
    const tokenJson = (await tokenRes.json()) as { access_token: string };
    const accessToken = tokenJson.access_token;

    // Pull last 30 days regardless of watermark
    const baseUrl = cfg.bookingsUrl || 'https://api.navan.com/v1/bookings';
    const url = new URL(baseUrl);
    url.searchParams.set('createdFrom', String(Math.floor(Date.now() / 1000 - 30 * 24 * 3600)));
    url.searchParams.set('createdTo', String(Math.floor(Date.now() / 1000)));
    url.searchParams.set('page', '0');
    url.searchParams.set('size', '5');
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      return NextResponse.json(
        { stage: 'bookings', status: res.status, body: await res.text() },
        { status: 500 },
      );
    }
    const json = await res.json();
    return NextResponse.json({
      url: url.toString(),
      shape: Array.isArray(json) ? 'array' : 'object',
      topLevelKeys: Array.isArray(json) ? null : Object.keys(json as object),
      raw: json,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

// Touch prisma import so it isn't tree-shaken if unused above
void prisma;
