import { NextResponse } from 'next/server';
import { requireEnv } from '@/server/env';
import { getXeroIntegration } from '@/server/integrations/xero';
import { pullBankTransactions } from '@/server/integrations/xero-bankfeed';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 5 minutes — Xero paginated pulls can be slow

/**
 * Nightly Xero bank-feed pull. Vercel Cron hits this endpoint; auth is by a
 * shared secret in the Authorization header (Vercel Cron sends its own
 * Authorization header only in production, so we also accept CRON_SECRET as
 * a query param in dev).
 *
 * Schedule is configured in vercel.json.
 */
export async function GET(req: Request) {
  const cronSecret = requireEnv('CRON_SECRET');
  const auth = req.headers.get('authorization');
  const url = new URL(req.url);
  const providedKey =
    auth?.replace(/^Bearer\s+/i, '') ?? url.searchParams.get('key') ?? '';
  if (providedKey !== cronSecret) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const xeroRow = await getXeroIntegration();
  if (!xeroRow || xeroRow.status !== 'connected') {
    return NextResponse.json({ skipped: 'xero not connected' }, { status: 200 });
  }

  try {
    const result = await pullBankTransactions();
    console.log('[cron/xero-bank-pull] ok:', result);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error('[cron/xero-bank-pull] failed:', err);
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
