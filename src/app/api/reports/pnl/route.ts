import { NextResponse } from 'next/server';
import { getSession } from '@/server/session';
import { hasAnyRole } from '@/server/roles';
import { computeFirmPnL } from '@/server/reports/pnl';
import { centsToDecimal, toCsv, ymd } from '@/server/reports/csv';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await getSession();
  if (!hasAnyRole(session, ['super_admin', 'admin', 'partner'])) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const pnl = await computeFirmPnL();
  const csv = toCsv(
    [
      'Code',
      'Name',
      'Client',
      'Stage',
      'Contract (AUD)',
      'Revenue invoiced (AUD)',
      'Revenue WIP (AUD)',
      'Cost (AUD)',
      'Margin (AUD)',
      'Margin %',
      'Hours logged',
    ],
    pnl.projects.map((p) => {
      const activeRev = p.revenueCents + p.wipCents;
      const pct = activeRev > 0 ? ((p.marginCents / activeRev) * 100).toFixed(1) : '';
      return [
        p.code,
        p.name,
        p.clientCode,
        p.stage,
        centsToDecimal(p.contractValueCents),
        centsToDecimal(p.revenueCents),
        centsToDecimal(p.wipCents),
        centsToDecimal(p.costCents),
        centsToDecimal(p.marginCents),
        pct,
        p.hours.toFixed(1),
      ];
    }),
  );

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="foundry-pnl-${ymd(new Date())}.csv"`,
    },
  });
}
