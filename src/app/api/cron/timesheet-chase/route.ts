import { NextResponse } from 'next/server';
import { requireEnv } from '@/server/env';
import { prisma } from '@/server/db';
import {
  CHASE_FLAG_KEY,
  chaseConfigFromEnv,
  runTimesheetChase,
} from '@/server/timesheet-chase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Nudge the approvers holding up a contractor's invoice (TASK-506).
 *
 * D2 closes a month only when every project in it is approved, so one
 * unresponsive lead blocks a contractor's payment. This runs daily, chases
 * the specific people who owe a decision, and escalates to the admin tier if
 * that doesn't land.
 *
 * Behind the `timesheet_chase` FeatureFlag so staging can dogfood the
 * messages before prod starts DMing partners. Thresholds come from env
 * (TIMESHEET_CHASE_AFTER_DAYS / TIMESHEET_ESCALATE_AFTER_DAYS) rather than
 * being hard-coded — the FeatureFlag table is boolean-only.
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

  const flag = await prisma.featureFlag.findUnique({ where: { key: CHASE_FLAG_KEY } });
  if (!flag?.enabled) {
    return NextResponse.json({ skipped: 'timesheet_chase flag off' }, { status: 200 });
  }

  const cfg = chaseConfigFromEnv();
  try {
    const result = await runTimesheetChase(new Date(), cfg);
    console.log('[cron/timesheet-chase] ok:', { ...result, ...cfg });
    return NextResponse.json({ ...result, ...cfg }, { status: 200 });
  } catch (err) {
    console.error('[cron/timesheet-chase] failed:', err);
    return NextResponse.json({ error: 'chase failed' }, { status: 500 });
  }
}
