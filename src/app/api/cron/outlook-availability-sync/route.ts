import { NextResponse } from 'next/server';
import { requireEnv } from '@/server/env';
import { prisma } from '@/server/db';
import {
  OUTLOOK_SYNC_FLAG_KEY,
  runOutlookAvailabilitySync,
} from '@/server/integrations/outlook-calendar';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Pull each person's Outlook calendar into their availability forecast
 * (TASK-522). Runs nightly, ahead of the morning resource conversation.
 *
 * Behind the `outlook_availability_sync` FeatureFlag so staging can
 * dogfood it before prod writes to anyone's grid, and behind
 * `graphConfigured()` inside the runner. Read-only against Graph (Q3):
 * nothing is ever written back into a calendar.
 *
 * A failed run writes nothing at all, which leaves everyone's grid as
 * they last saved it. That is the point — an unreadable calendar must
 * never render as "free".
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

  const flag = await prisma.featureFlag.findUnique({
    where: { key: OUTLOOK_SYNC_FLAG_KEY },
  });
  if (!flag?.enabled) {
    return NextResponse.json(
      { skipped: 'outlook_availability_sync flag off' },
      { status: 200 },
    );
  }

  try {
    const result = await runOutlookAvailabilitySync();
    console.log('[cron/outlook-availability-sync] ok:', result);
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    console.error('[cron/outlook-availability-sync] failed:', err);
    return NextResponse.json({ error: 'sync failed' }, { status: 500 });
  }
}
