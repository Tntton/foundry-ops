import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSession } from '@/server/session';
import { hasAnyRole } from '@/server/roles';
import { computeFirmAging } from '@/server/reports/ar-aging';
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

export default async function ArAgingPage() {
  const session = await getSession();
  if (!hasAnyRole(session, ['super_admin', 'admin', 'partner'])) notFound();

  const ar = await computeFirmAging();

  const orderedBuckets: Array<'not_due' | '0-30' | '31-60' | '61-90' | '90+'> = [
    'not_due',
    '0-30',
    '31-60',
    '61-90',
    '90+',
  ];

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold text-ink">AR aging</h1>
          <p className="text-sm text-ink-3">
            Open invoices (approved / sent / partial / overdue) bucketed by days past due.
            Outstanding is total − payments received, inc GST.
          </p>
        </div>
        <a
          href="/api/reports/ar"
          className="rounded-md border border-line px-3 py-1.5 text-sm text-ink-2 hover:bg-surface-hover hover:text-ink"
        >
          Download CSV
        </a>
      </header>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
        <TotalCard
          label="Total outstanding"
          value={formatMoney(ar.totalOutstandingCents)}
          sub={`${ar.invoiceCount} ${ar.invoiceCount === 1 ? 'invoice' : 'invoices'}`}
        />
        {orderedBuckets.map((b) => (
          <TotalCard
            key={b}
            label={BUCKET_LABEL[b] ?? b}
            value={formatMoney(ar.bucketTotals[b])}
            emphasis={b === '90+' && ar.bucketTotals[b] > 0}
          />
        ))}
      </div>

      {ar.oldestOverdueDays !== null && ar.oldestOverdueDays > 30 && (
        <div className="rounded-md border border-status-amber bg-status-amber-soft px-3 py-2 text-sm text-status-amber">
          Oldest overdue invoice is {ar.oldestOverdueDays} days past due — time to chase.
        </div>
      )}

      {ar.byClient.length === 0 ? (
        <Card className="p-12 text-center text-sm text-ink-3">
          No open AR. Every approved invoice is fully paid.
        </Card>
      ) : (
        <div className="space-y-3">
          {ar.byClient.map((c) => (
            <Card key={c.clientId} className="p-0">
              <CardHeader className="flex flex-row items-start justify-between gap-3">
                <div>
                  <Link
                    href={`/directory/clients/${c.clientId}`}
                    className="flex items-center gap-2"
                  >
                    <Badge variant="outline" className="font-mono">
                      {c.code}
                    </Badge>
                    <span className="text-base font-semibold text-ink hover:underline">
                      {c.legalName}
                    </span>
                  </Link>
                  <div className="mt-1 text-xs text-ink-3">
                    {c.invoices.length} open{' '}
                    {c.invoices.length === 1 ? 'invoice' : 'invoices'}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[11px] uppercase tracking-wide text-ink-3">
                    Outstanding
                  </div>
                  <div className="text-lg font-semibold tabular-nums text-ink">
                    {formatMoney(c.totalOutstandingCents)}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1 text-[10px]">
                    {orderedBuckets.map((b) =>
                      c.bucketCents[b] > 0 ? (
                        <Badge key={b} variant={bucketBadge(b)} className="capitalize">
                          {BUCKET_LABEL[b]}: {formatMoney(c.bucketCents[b])}
                        </Badge>
                      ) : null,
                    )}
                  </div>
                </div>
              </CardHeader>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Number</TableHead>
                    <TableHead>Project</TableHead>
                    <TableHead>Issued</TableHead>
                    <TableHead>Due</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-right">Paid</TableHead>
                    <TableHead className="text-right">Outstanding</TableHead>
                    <TableHead>Age</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {c.invoices.map((inv) => (
                    <TableRow key={inv.id}>
                      <TableCell>
                        <Link
                          href={`/invoices/${inv.id}`}
                          className="font-mono text-xs hover:underline"
                        >
                          {inv.number}
                        </Link>
                      </TableCell>
                      <TableCell className="font-mono text-xs text-ink-3">
                        {inv.project.code}
                      </TableCell>
                      <TableCell className="tabular-nums text-xs">
                        {inv.issueDate.toLocaleDateString('en-AU')}
                      </TableCell>
                      <TableCell className="tabular-nums text-xs">
                        {inv.dueDate.toLocaleDateString('en-AU')}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="capitalize">
                          {inv.status.replace(/_/g, ' ')}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-ink-3">
                        {formatMoney(inv.amountTotalCents)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-ink-3">
                        {inv.paidCents > 0 ? formatMoney(inv.paidCents) : '—'}
                      </TableCell>
                      <TableCell className="text-right font-semibold tabular-nums text-ink">
                        {formatMoney(inv.outstandingCents)}
                      </TableCell>
                      <TableCell>
                        <Badge variant={bucketBadge(inv.bucket)} className="text-xs">
                          {inv.daysOverdue < 0
                            ? `in ${Math.abs(inv.daysOverdue)}d`
                            : inv.daysOverdue === 0
                              ? 'due today'
                              : `${inv.daysOverdue}d over`}
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
