import { NextResponse } from 'next/server';
import { getSession } from '@/server/session';
import { hasAnyRole } from '@/server/roles';
import {
  sendDailyTimesheetPrompts,
  sendWeeklyAvailabilityPrompts,
} from '@/server/integrations/whatsapp-prompts';

/**
 * Admin-triggered batch prompt sender. POST `?kind=timesheet` to nudge
 * everyone who hasn't logged today, or `?kind=availability` to nudge
 * everyone who hasn't filled next week's forecast yet.
 *
 * The same handlers run from a cron once that's wired up — for now
 * this gives super_admin / admin a manual fire control while the
 * automation is being tested.
 */

export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  const session = await getSession();
  if (!hasAnyRole(session, ['super_admin', 'admin'])) {
    return new NextResponse('forbidden', { status: 403 });
  }
  const url = new URL(request.url);
  const kind = url.searchParams.get('kind');
  if (kind === 'timesheet') {
    const r = await sendDailyTimesheetPrompts();
    return NextResponse.json({ kind, ...r });
  }
  if (kind === 'availability') {
    const r = await sendWeeklyAvailabilityPrompts();
    return NextResponse.json({ kind, ...r });
  }
  return NextResponse.json(
    { error: 'kind must be "timesheet" or "availability"' },
    { status: 400 },
  );
}
