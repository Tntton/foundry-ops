import { NextResponse } from 'next/server';
import type { InvoiceStatus } from '@prisma/client';
import { getSession } from '@/server/session';
import { listInvoices } from '@/server/invoices';
import { centsToDecimal, toCsv, ymd } from '@/server/reports/csv';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STATUS_OPTIONS: readonly InvoiceStatus[] = [
  'draft',
  'pending_approval',
  'approved',
  'sent',
  'partial',
  'paid',
  'overdue',
  'written_off',
];

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const url = new URL(req.url);
  const status = STATUS_OPTIONS.includes(url.searchParams.get('status') as InvoiceStatus)
    ? (url.searchParams.get('status') as InvoiceStatus)
    : undefined;
  const q = url.searchParams.get('q')?.trim();

  const rows = await listInvoices(session, {
    ...(status ? { status } : {}),
    ...(q ? { search: q } : {}),
  });

  const csv = toCsv(
    [
      'Number',
      'Client code',
      'Client',
      'Project',
      'Status',
      'Issued',
      'Due',
      'Ex GST (AUD)',
      'GST (AUD)',
      'Total (AUD)',
    ],
    rows.map((i) => [
      i.number,
      i.client.code,
      i.client.legalName,
      i.project.code,
      i.status,
      ymd(i.issueDate),
      ymd(i.dueDate),
      centsToDecimal(i.amountExGst),
      centsToDecimal(i.gst),
      centsToDecimal(i.amountTotal),
    ]),
  );

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="foundry-invoices-${ymd(new Date())}.csv"`,
    },
  });
}
