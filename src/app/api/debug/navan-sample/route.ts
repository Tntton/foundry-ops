import { NextResponse } from 'next/server';
import { getSession } from '@/server/session';
import { hasAnyRole } from '@/server/roles';
import { fetchBookingsSinceLastSync } from '@/server/integrations/navan';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * TEMPORARY debug endpoint — dumps the raw Navan booking shape so we can
 * see exactly which email fields (if any) Navan's API returns for the
 * tenant. Super_admin only. Delete this route once the email-matching
 * issue is diagnosed.
 */
export async function GET() {
  const session = await getSession();
  if (!hasAnyRole(session, ['super_admin'])) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  try {
    const bookings = await fetchBookingsSinceLastSync();
    const sample = bookings[0] ?? null;
    return NextResponse.json({
      count: bookings.length,
      keys: sample ? Object.keys(sample as object) : [],
      sample,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
