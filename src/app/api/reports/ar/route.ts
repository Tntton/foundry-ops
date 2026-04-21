import { NextResponse } from 'next/server';
import { getSession } from '@/server/session';
import { hasAnyRole } from '@/server/roles';
import { computeFirmAging } from '@/server/reports/ar-aging';
import { centsToDecimal, toCsv, ymd } from '@/server/reports/csv';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await getSession();
  if (!hasAnyRole(session, ['super_admin', 'admin', 'partner'])) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const ar = await computeFirmAging();
  const rows: Array<Array<string | number>> = [];
  for (const c of ar.byClient) {
    for (const inv of c.invoices) {
      rows.push([
        c.code,
        c.legalName,
        inv.number,
        inv.project.code,
        inv.status,
        ymd(inv.issueDate),
        ymd(inv.dueDate),
        centsToDecimal(inv.amountTotalCents),
        centsToDecimal(inv.paidCents),
        centsToDecimal(inv.outstandingCents),
        inv.daysOverdue,
        inv.bucket,
      ]);
    }
  }

  const csv = toCsv(
    [
      'Client code',
      'Client name',
      'Invoice #',
      'Project',
      'Status',
      'Issued',
      'Due',
      'Total (AUD)',
      'Paid (AUD)',
      'Outstanding (AUD)',
      'Days overdue',
      'Bucket',
    ],
    rows,
  );

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="foundry-ar-aging-${ymd(new Date())}.csv"`,
    },
  });
}
