import { NextResponse } from 'next/server';
import { getSession } from '@/server/session';
import { hasAnyRole } from '@/server/roles';
import {
  computeFirmUtilisation,
  currentMonthYm,
  monthOptions,
} from '@/server/reports/utilisation';
import { toCsv, ymd } from '@/server/reports/csv';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const session = await getSession();
  if (!hasAnyRole(session, ['super_admin', 'admin', 'partner'])) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const url = new URL(req.url);
  const rawMonth = url.searchParams.get('month')?.trim();
  const months = monthOptions(24);
  const month = rawMonth && months.includes(rawMonth) ? rawMonth : currentMonthYm();

  const data = await computeFirmUtilisation(month);
  const csv = toCsv(
    [
      'Month',
      'Initials',
      'First name',
      'Last name',
      'Band',
      'Level',
      'Employment',
      'FTE',
      'Target hours',
      'Logged hours',
      'Billed hours',
      'Utilisation %',
      'Active',
    ],
    data.rows.map((r) => [
      data.month,
      r.initials,
      r.firstName,
      r.lastName,
      r.band,
      r.level,
      r.employment,
      r.fte.toFixed(2),
      r.targetHours.toFixed(1),
      r.loggedHours.toFixed(1),
      r.billedHours.toFixed(1),
      r.utilisationPct === null ? '' : String(r.utilisationPct),
      r.active ? 'yes' : 'no',
    ]),
  );

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="foundry-utilisation-${data.month}-${ymd(new Date())}.csv"`,
    },
  });
}
