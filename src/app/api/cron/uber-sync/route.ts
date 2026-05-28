import { NextResponse } from 'next/server';
import { requireEnv } from '@/server/env';
import { getUberIntegration } from '@/server/integrations/uber';
import { runUberSync } from '@/server/integrations/uber-sync';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * Scheduled Uber for Business sync. Vercel Cron hits this endpoint
 * via the `Authorization: Bearer <CRON_SECRET>` header (production);
 * in dev we also accept `?key=<CRON_SECRET>` so a curl test works
 * without setting headers.
 *
 * Schedule is configured in `vercel.json`. Runs as the **system
 * actor** (no triggeredBy person id) so audit trails for cron-imports
 * are clearly distinguishable from human-triggered ones.
 *
 * Idempotent — re-running between trips is a no-op because the
 * `uber:trip:<id>` prefix on supplierInvoiceNumber dedupes.
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

  const uberRow = await getUberIntegration();
  if (!uberRow || uberRow.status !== 'connected') {
    return NextResponse.json(
      { skipped: 'uber not connected' },
      { status: 200 },
    );
  }

  try {
    const result = await runUberSync(); // system actor
    console.log('[cron/uber-sync] ok:', {
      imported: result.imported,
      skipped: result.skipped,
      unmatched: result.unmatched.length,
    });
    return NextResponse.json(result);
  } catch (err) {
    console.error('[cron/uber-sync] failed:', err);
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
