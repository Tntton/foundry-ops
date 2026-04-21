import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSession } from '@/server/session';
import { hasAnyRole } from '@/server/roles';
import { computeFirmApAging } from '@/server/reports/ap-aging';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

function formatMoney(cents: number): string {
  if (cents === 0) return '—';
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

const BUCKET_LABEL: Record<string, string> = {
  not_due: 'Not yet due',
  '0-30': '0–30 days',
  '31-60': '31–60 days',
  '61-90': '61–90 days',
  '90+': '90+ days',
};

function bucketBadge(
  bucket: string,
): 'outline' | 'green' | 'amber' | 'red' | 'blue' {
  switch (bucket) {
    case 'not_due':
      return 'outline';
    case '0-30':
      return 'green';
    case '31-60':
      return 'amber';
    case '61-90':
      return 'amber';
    case '90+':
      return 'red';
    default:
      return 'outline';
  }
}

export default async function ApAgingPage() {
  const session = await getSession();
  if (!hasAnyRole(session, ['super_admin', 'admin'])) notFound();

  const ap = await computeFirmApAging();
  const orderedBuckets: Array<'not_due' | '0-30' | '31-60' | '61-90' | '90+'> = [
    'not_due',
    '0-30',
    '31-60',
    '61-90',
    '90+',
  ];

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-ink">AP aging</h1>
        <p className="text-sm text-ink-3">
          Approved and scheduled bills Foundry still owes, bucketed by days past
          due. Total is inc GST. Paid and pending-review bills are excluded.
        </p>
      </header>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
        <TotalCard
          label="Total payable"
          value={formatMoney(ap.totalOutstandingCents)}
          sub={`${ap.billCount} ${ap.billCount === 1 ? 'bill' : 'bills'}`}
        />
        {orderedBuckets.map((b) => (
          <TotalCard
            key={b}
            label={BUCKET_LABEL[b] ?? b}
            value={formatMoney(ap.bucketTotals[b])}
            emphasis={b === '90+' && ap.bucketTotals[b] > 0}
          />
        ))}
      </div>

      {ap.oldestOverdueDays !== null && ap.oldestOverdueDays > 7 && (
        <div className="rounded-md border border-status-amber bg-status-amber-soft px-3 py-2 text-sm text-status-amber">
          Oldest overdue bill is {ap.oldestOverdueDays} days past due — schedule payment.
        </div>
      )}

      {ap.bySupplier.length === 0 ? (
        <Card className="p-12 text-center text-sm text-ink-3">
          No outstanding bills. Approve a bill in the Bills queue for it to appear here.
        </Card>
      ) : (
        <div className="space-y-3">
          {ap.bySupplier.map((s) => (
            <Card key={s.key} className="p-0">
              <CardHeader className="flex flex-row items-start justify-between gap-3">
                <div>
                  {s.supplierPersonId ? (
                    <Link
                      href={`/directory/people/${s.supplierPersonId}`}
                      className="text-base font-semibold text-ink hover:underline"
                    >
                      {s.supplierName}
                    </Link>
                  ) : (
                    <Link
                      href={`/directory/suppliers/${encodeURIComponent(s.supplierName)}`}
                      className="text-base font-semibold text-ink hover:underline"
                    >
                      {s.supplierName}
                    </Link>
                  )}
                  <div className="mt-1 text-xs text-ink-3">
                    {s.bills.length} open{' '}
                    {s.bills.length === 1 ? 'bill' : 'bills'}
                    {s.supplierPersonId && (
                      <Badge variant="blue" className="ml-2 text-[10px]">
                        Contractor
                      </Badge>
                    )}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[11px] uppercase tracking-wide text-ink-3">
                    Outstanding
                  </div>
                  <div className="text-lg font-semibold tabular-nums text-ink">
                    {formatMoney(s.totalOutstandingCents)}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1 text-[10px]">
                    {orderedBuckets.map((b) =>
                      s.bucketCents[b] > 0 ? (
                        <Badge key={b} variant={bucketBadge(b)} className="capitalize">
                          {BUCKET_LABEL[b]}: {formatMoney(s.bucketCents[b])}
                        </Badge>
                      ) : null,
                    )}
                  </div>
                </div>
              </CardHeader>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Ref</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Project</TableHead>
                    <TableHead>Issued</TableHead>
                    <TableHead>Due</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead>Age</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {s.bills.map((b) => (
                    <TableRow key={b.id}>
                      <TableCell>
                        <Link
                          href={`/bills/${b.id}`}
                          className="font-mono text-xs hover:underline"
                        >
                          {b.supplierInvoiceNumber ?? 'open →'}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="capitalize">
                          {b.category.replace(/_/g, ' ')}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {b.project ? (
                          <Link
                            href={`/projects/${b.project.code}`}
                            className="font-mono text-xs hover:underline"
                          >
                            {b.project.code}
                          </Link>
                        ) : (
                          <span className="text-xs text-ink-4">OPEX</span>
                        )}
                      </TableCell>
                      <TableCell className="tabular-nums text-xs">
                        {b.issueDate.toLocaleDateString('en-AU')}
                      </TableCell>
                      <TableCell className="tabular-nums text-xs">
                        {b.dueDate.toLocaleDateString('en-AU')}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="capitalize">
                          {b.status.replace(/_/g, ' ')}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-semibold tabular-nums text-ink">
                        {formatMoney(b.amountTotalCents)}
                      </TableCell>
                      <TableCell>
                        <Badge variant={bucketBadge(b.bucket)} className="text-xs">
                          {b.daysOverdue < 0
                            ? `in ${Math.abs(b.daysOverdue)}d`
                            : b.daysOverdue === 0
                              ? 'due today'
                              : `${b.daysOverdue}d over`}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function TotalCard({
  label,
  value,
  sub,
  emphasis,
}: {
  label: string;
  value: string;
  sub?: string;
  emphasis?: boolean;
}) {
  return (
    <Card>
      <CardHeader className="pb-1">
        <CardTitle className="text-xs font-medium uppercase tracking-wide text-ink-3">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div
          className={`text-lg font-semibold tabular-nums ${
            emphasis ? 'text-status-red' : 'text-ink'
          }`}
        >
          {value}
        </div>
        {sub && <div className="text-[11px] text-ink-3">{sub}</div>}
      </CardContent>
    </Card>
  );
}
