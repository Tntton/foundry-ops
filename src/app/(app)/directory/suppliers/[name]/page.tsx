import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSession } from '@/server/session';
import { hasAnyRole } from '@/server/roles';
import { getSupplierByName } from '@/server/suppliers';
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

const STATUS_VARIANT: Record<string, 'outline' | 'amber' | 'green' | 'blue' | 'red'> = {
  pending_review: 'amber',
  approved: 'blue',
  rejected: 'red',
  scheduled_for_payment: 'blue',
  paid: 'green',
};

export default async function SupplierDetailPage({
  params,
}: {
  params: { name: string };
}) {
  const session = await getSession();
  if (!hasAnyRole(session, ['super_admin', 'admin', 'partner'])) notFound();

  const name = decodeURIComponent(params.name);
  const supplier = await getSupplierByName(name);
  if (!supplier) notFound();

  return (
    <div className="space-y-6">
      <div className="text-sm">
        <Link href="/directory/suppliers" className="text-ink-3 hover:text-ink">
          ← Back to Suppliers
        </Link>
      </div>

      <header>
        <h1 className="text-xl font-semibold text-ink">{supplier.name}</h1>
        <p className="text-sm text-ink-3">
          External supplier. All bills listed below — this is aggregated from the Bill
          rows, not a dedicated Supplier record.
        </p>
      </header>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <TotalCard label="Bills" value={String(supplier.totals.billCount)} sub="any status" />
        <TotalCard
          label="Lifetime gross"
          value={formatMoney(supplier.totals.lifetimeGrossCents)}
          sub="incl GST, excl rejected"
        />
        <TotalCard label="Paid" value={formatMoney(supplier.totals.paidCents)} />
        <TotalCard
          label="Unpaid"
          value={formatMoney(supplier.totals.unpaidCents)}
          sub="approved / scheduled"
        />
        <TotalCard
          label="Pending review"
          value={formatMoney(supplier.totals.pendingReviewCents)}
          sub="not yet approved"
        />
      </div>

      {supplier.categoryBreakdown.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Category mix</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {supplier.categoryBreakdown.map((c) => {
              const pct =
                supplier.totals.lifetimeGrossCents > 0
                  ? Math.round((c.grossCents / supplier.totals.lifetimeGrossCents) * 100)
                  : 0;
              return (
                <div key={c.category} className="grid grid-cols-[180px_1fr_120px] items-center gap-3">
                  <Badge variant="outline" className="w-fit capitalize">
                    {c.category.replace(/_/g, ' ')}
                  </Badge>
                  <div className="flex items-center gap-2">
                    <div
                      className="h-2 rounded bg-brand"
                      style={{ width: `${pct}%`, minWidth: pct > 0 ? '4px' : '0' }}
                      aria-label={`${pct}%`}
                    />
                    <span className="text-xs text-ink-3">{pct}%</span>
                  </div>
                  <div className="text-right tabular-nums text-sm text-ink-2">
                    {formatMoney(c.grossCents)}
                    <span className="ml-1 text-xs text-ink-3">
                      ({c.count} bill{c.count === 1 ? '' : 's'})
                    </span>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      <Card className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Issued</TableHead>
              <TableHead>Supplier ref</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Project</TableHead>
              <TableHead>Due</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="text-right">GST</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Xero</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {supplier.bills.map((b) => (
              <TableRow key={b.id}>
                <TableCell className="tabular-nums text-xs">
                  {b.issueDate.toLocaleDateString('en-AU')}
                </TableCell>
                <TableCell className="font-mono text-xs text-ink-2">
                  {b.supplierInvoiceNumber ? (
                    <Link href={`/bills/${b.id}`} className="hover:underline">
                      {b.supplierInvoiceNumber}
                    </Link>
                  ) : (
                    <Link href={`/bills/${b.id}`} className="text-ink-3 hover:underline">
                      open →
                    </Link>
                  )}
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
                      className="text-xs hover:underline"
                    >
                      <span className="font-mono text-ink-3">{b.project.code}</span>
                    </Link>
                  ) : (
                    <span className="text-xs text-ink-4">OPEX</span>
                  )}
                </TableCell>
                <TableCell className="tabular-nums text-xs">
                  {b.dueDate.toLocaleDateString('en-AU')}
                </TableCell>
                <TableCell className="text-right font-semibold tabular-nums text-ink">
                  {formatMoney(b.amountTotalCents)}
                </TableCell>
                <TableCell className="text-right tabular-nums text-ink-3">
                  {formatMoney(b.gstCents)}
                </TableCell>
                <TableCell>
                  <Badge variant={STATUS_VARIANT[b.status] ?? 'outline'} className="capitalize">
                    {b.status.replace(/_/g, ' ')}
                  </Badge>
                </TableCell>
                <TableCell className="text-xs text-ink-3">
                  {b.xeroBillId ? (
                    <span className="font-mono">{b.xeroBillId.slice(0, 8)}…</span>
                  ) : (
                    '—'
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

function TotalCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card>
      <CardHeader className="pb-1">
        <CardTitle className="text-xs font-medium uppercase tracking-wide text-ink-3">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-lg font-semibold tabular-nums text-ink">{value}</div>
        {sub && <div className="text-[11px] text-ink-3">{sub}</div>}
      </CardContent>
    </Card>
  );
}
