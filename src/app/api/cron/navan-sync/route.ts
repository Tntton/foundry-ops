import { NextResponse } from 'next/server';
import { requireEnv } from '@/server/env';
import { getNavanIntegration } from '@/server/integrations/navan';
import { runNavanSync } from '@/server/integrations/navan-sync';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Navan's BDI pull paginates 100 bookings/page and we run one HTTP
// call per page → 30s is comfortable headroom for a 12-person firm,
// but bump if a backfill window spikes the booking count.
export const maxDuration = 120;

/**
 * Scheduled Navan sync. Vercel Cron hits this endpoint via the
 * `Authorization: Bearer <CRON_SECRET>` header (production); in dev we
 * also accept `?key=<CRON_SECRET>` so a curl test works without
 * setting headers.
 *
 * Schedule is configured in `vercel.json`. The runner is identical to
 * the manual "Sync now" button: pulls every booking + expense
 * Navan has updated since our last watermark, lands new rows as
 * firm-paid Bills attributed to the traveller, and stamps the
 * watermark forward on success.
 *
 * Idempotent — re-running between bookings is a no-op because the
 * `navan:booking:<id>` prefix on supplierInvoiceNumber dedupes.
 *
 * Acts as the **system actor** (no triggeredBy person id) so audit
 * trails for cron-imports are clearly distinguishable from human-
 * triggered ones.
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

  // No-op cleanly when Navan isn't connected — the integration screen
  // is the right place to surface "not connected", not the cron log.
  const navanRow = await getNavanIntegration();
  if (!navanRow || navanRow.status !== 'connected') {
    return NextResponse.json({ skipped: 'navan not connected' }, { status: 200 });
  }

  try {
    const result = await runNavanSync(); // system actor
    console.log('[cron/navan-sync] ok:', {
      imported: result.imported,
      skipped: result.skipped,
      unmatched: result.unmatched.length,
    });
    // `result` already carries `ok: true` — spread it directly.
    return NextResponse.json(result);
  } catch (err) {
    console.error('[cron/navan-sync] failed:', err);
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
