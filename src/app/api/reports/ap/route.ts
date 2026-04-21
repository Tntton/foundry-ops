import { NextResponse } from 'next/server';
import { getSession } from '@/server/session';
import { hasAnyRole } from '@/server/roles';
import { computeFirmApAging } from '@/server/reports/ap-aging';
import { centsToDecimal, toCsv, ymd } from '@/server/reports/csv';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await getSession();
  if (!hasAnyRole(session, ['super_admin', 'admin'])) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const ap = await computeFirmApAging();
  const rows: Array<Array<string | number>> = [];
  for (const s of ap.bySupplier) {
    for (const b of s.bills) {
      rows.push([
        s.supplierName,
        b.supplierPersonId ? 'contractor' : 'external',
        b.supplierInvoiceNumber ?? '',
        b.project?.code ?? '',
        b.category,
        b.status,
        ymd(b.issueDate),
        ymd(b.dueDate),
        centsToDecimal(b.amountTotalCents),
        b.daysOverdue,
        b.bucket,
      ]);
    }
  }

  const csv = toCsv(
    [
      'Supplier',
      'Type',
      'Supplier ref',
      'Project',
      'Category',
      'Status',
      'Issued',
      'Due',
      'Total (AUD inc GST)',
      'Days overdue',
      'Bucket',
    ],
    rows,
  );

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="foundry-ap-aging-${ymd(new Date())}.csv"`,
    },
  });
}
