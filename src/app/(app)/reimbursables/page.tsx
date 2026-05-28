import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSession } from '@/server/session';
import { hasAnyRole } from '@/server/roles';
import { computeFirmReimbursementsAging } from '@/server/reports/reimbursements-aging';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
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
import { RebillableToggle } from '@/components/rebillable-toggle';

function formatMoney(cents: number): string {
  if (cents === 0) return '—';
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

const BUCKET_LABEL: Record<string, string> = {
  not_due: 'Within pay cycle',
  '0-30': '0–30 days late',
  '31-60': '31–60 days late',
  '61-90': '61–90 days late',
  '90+': '90+ days late',
};

function bucketBadge(
  bucket: string,
): 'outline' | 'green' | 'amber' | 'red' | 'blue' {
  switch (bucket) {
    case 'not_due':
      return 'outline';
    case '0-30':
      return 'amber';
    case '31-60':
      return 'amber';
    case '61-90':
      return 'red';
    case '90+':
      return 'red';
    default:
      return 'outline';
  }
}

export default async function ReimbursablesPage() {
  const session = await getSession();
  if (!hasAnyRole(session, ['super_admin', 'admin'])) notFound();

  const r = await computeFirmReimbursementsAging();
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
          <h1 className="text-xl font-semibold text-ink">Reimbursables</h1>
          <p className="text-sm text-ink-3">
            Out-of-pocket expenses staff have submitted but Foundry hasn&apos;t
            paid back yet. Bucketed by age past the 14-day pay cycle. Mark a
            row <strong className="text-ink-2">rebillable</strong> to forward
            the cost to the next client invoice for the project.
          </p>
        </div>
        <a
          href="/api/reports/expenses?scope=all&status=submitted"
          className="rounded-md border border-line px-3 py-1.5 text-sm text-ink-2 hover:bg-surface-hover hover:text-ink"
        >
          Download CSV
        </a>
      </header>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
        <TotalCard
          label="Total reimbursable"
          value={formatMoney(r.totalOutstandingCents)}
          sub={`${r.rowCount} ${r.rowCount === 1 ? 'item' : 'items'}`}
        />
        {orderedBuckets.map((b) => (
          <TotalCard
            key={b}
            label={BUCKET_LABEL[b] ?? b}
            value={formatMoney(r.bucketTotals[b])}
            emphasis={(b === '90+' || b === '61-90') && r.bucketTotals[b] > 0}
          />
        ))}
      </div>

      {r.oldestOutstandingDays !== null && r.oldestOutstandingDays > 14 && (
        <div className="rounded-md border border-status-amber bg-status-amber-soft px-3 py-2 text-sm text-status-amber">
          Oldest reimbursement is {r.oldestOutstandingDays} days past the pay
          cycle — schedule a payroll run.
        </div>
      )}

      {/* Rebillable summary — same idea as the Payables page. Personal
          expenses can also be rebilled to the client when the project's
          contract permits (e.g. T&M or cost-plus). */}
      {(r.rebillablePendingCount > 0 || r.totalOutstandingCents > 0) && (
        <Card className="border-status-amber/50 bg-status-amber-soft/30 p-0">
          <CardHeader className="flex flex-row items-center justify-between gap-3">
            <div>
              <CardTitle className="text-sm">
                Rebillable — pending client invoice
              </CardTitle>
              <p className="text-xs text-ink-3">
                Pass-through costs Foundry will reimburse the staff member
                for AND recharge to the client on the next project invoice.
                Toggle <strong className="text-ink-2">↪ Rebillable</strong>{' '}
                on a row to add it to this float.
              </p>
            </div>
            <div className="text-right">
              <div className="text-lg font-semibold tabular-nums text-status-amber">
                {formatMoney(r.rebillablePendingCents)}
              </div>
              <div className="text-[11px] text-ink-3">
                {r.rebillablePendingCount}{' '}
                {r.rebillablePendingCount === 1 ? 'item' : 'items'} not yet
                forwarded
              </div>
            </div>
          </CardHeader>
        </Card>
      )}

      {r.byPerson.length === 0 ? (
        <Card className="p-12 text-center text-sm text-ink-3">
          No outstanding reimbursements. Approve an expense in the queue for
          it to appear here.
        </Card>
      ) : (
        <div className="space-y-3">
          {r.byPerson.map((p) => (
            <Card key={p.personId} className="p-0">
              <CardHeader className="flex flex-row items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <Avatar className="h-9 w-9">
                    <AvatarFallback className="text-xs">
                      {p.personInitials}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <Link
                      href={`/directory/people/${p.personId}`}
                      className="text-base font-semibold text-ink hover:underline"
                    >
                      {p.personName}
                    </Link>
                    <div className="mt-0.5 text-xs text-ink-3">
                      {p.rows.length} open{' '}
                      {p.rows.length === 1 ? 'expense' : 'expenses'}
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[11px] uppercase tracking-wide text-ink-3">
                    Outstanding
                  </div>
                  <div className="text-lg font-semibold tabular-nums text-ink">
                    {formatMoney(p.totalOutstandingCents)}
                  </div>
                  <div className="mt-1 flex flex-wrap justify-end gap-1 text-[10px]">
                    {orderedBuckets.map((b) =>
                      p.bucketCents[b] > 0 ? (
                        <Badge
                          key={b}
                          variant={bucketBadge(b)}
                          className="capitalize"
                        >
                          {BUCKET_LABEL[b]}: {formatMoney(p.bucketCents[b])}
                        </Badge>
                      ) : null,
                    )}
                  </div>
                </div>
              </CardHeader>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Vendor</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Project</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead>Age</TableHead>
                    <TableHead className="text-right">Rebill?</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {p.rows.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="tabular-nums text-xs">
                        <Link
                          href={`/expenses/${row.id}`}
                          className="hover:underline"
                        >
                          {row.date.toLocaleDateString('en-AU')}
                        </Link>
                      </TableCell>
                      <TableCell className="text-ink-2">
                        {row.vendor ?? row.description ?? '—'}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="capitalize">
                          {row.category.replace(/_/g, ' ')}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {row.project ? (
                          <Link
                            href={`/projects/${row.project.code}`}
                            className="font-mono text-xs hover:underline"
                          >
                            {row.project.code}
                          </Link>
                        ) : (
                          <span className="text-xs text-ink-4">OPEX</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="capitalize">
                          {row.status.replace(/_/g, ' ')}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-semibold tabular-nums text-ink">
                        {formatMoney(row.amountTotalCents)}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={bucketBadge(row.bucket)}
                          className="text-xs"
                        >
                          {row.daysOutstanding}d
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <RebillableToggle
                          kind="expense"
                          id={row.id}
                          rebillable={row.rebillable}
                          rebilledOnInvoiceId={row.rebilledOnInvoiceId}
                          hasProject={Boolean(row.project)}
                        />
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
