import { NextResponse } from 'next/server';
import type { ExpenseStatus } from '@prisma/client';
import { getSession } from '@/server/session';
import { hasCapability } from '@/server/capabilities';
import { listExpenses } from '@/server/expenses';
import { centsToDecimal, toCsv, ymd } from '@/server/reports/csv';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STATUS_OPTIONS: readonly ExpenseStatus[] = [
  'draft',
  'submitted',
  'approved',
  'rejected',
  'reimbursed',
  'batched_for_payment',
];

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const url = new URL(req.url);
  const status = STATUS_OPTIONS.includes(url.searchParams.get('status') as ExpenseStatus)
    ? (url.searchParams.get('status') as ExpenseStatus)
    : undefined;
  const category = url.searchParams.get('category')?.trim() || undefined;
  const q = url.searchParams.get('q')?.trim();
  const canSeeAll = hasCapability(session, 'expense.approve.under_2k');
  const scope: 'mine' | 'all' =
    canSeeAll && url.searchParams.get('scope') === 'all' ? 'all' : 'mine';

  const rows = await listExpenses(session, scope, {
    ...(status ? { status } : {}),
    ...(category ? { category } : {}),
    ...(q ? { search: q } : {}),
  });

  const csv = toCsv(
    [
      'Date',
      'Submitter',
      'Category',
      'Vendor',
      'Project',
      'Description',
      'Status',
      'Amount (AUD inc GST)',
      'GST (AUD)',
    ],
    rows.map((e) => [
      ymd(e.date),
      `${e.person.firstName} ${e.person.lastName}`,
      e.category,
      e.vendor ?? '',
      e.project?.code ?? '',
      e.description ?? '',
      e.status,
      centsToDecimal(e.amountCents),
      centsToDecimal(e.gstCents),
    ]),
  );

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="foundry-expenses-${ymd(new Date())}.csv"`,
    },
  });
}
