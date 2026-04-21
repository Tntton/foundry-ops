import { NextResponse } from 'next/server';
import type { BillStatus } from '@prisma/client';
import { getSession } from '@/server/session';
import { listBills } from '@/server/bills';
import { centsToDecimal, toCsv, ymd } from '@/server/reports/csv';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STATUS_OPTIONS: readonly BillStatus[] = [
  'pending_review',
  'approved',
  'rejected',
  'scheduled_for_payment',
  'paid',
];

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const url = new URL(req.url);
  const status = STATUS_OPTIONS.includes(url.searchParams.get('status') as BillStatus)
    ? (url.searchParams.get('status') as BillStatus)
    : undefined;
  const category = url.searchParams.get('category')?.trim() || undefined;
  const q = url.searchParams.get('q')?.trim();

  const rows = await listBills(session, {
    ...(status ? { status } : {}),
    ...(category ? { category } : {}),
    ...(q ? { search: q } : {}),
  });

  const csv = toCsv(
    [
      'Supplier',
      'Supplier ref',
      'Category',
      'Project',
      'Status',
      'Issued',
      'Due',
      'GST (AUD)',
      'Total (AUD inc GST)',
    ],
    rows.map((b) => [
      b.supplierName,
      b.supplierInvoiceNumber ?? '',
      b.category,
      b.project?.code ?? '',
      b.status,
      ymd(b.issueDate),
      ymd(b.dueDate),
      centsToDecimal(b.gst),
      centsToDecimal(b.amountTotal),
    ]),
  );

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="foundry-bills-${ymd(new Date())}.csv"`,
    },
  });
}
