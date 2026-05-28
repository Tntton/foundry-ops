import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSession } from '@/server/session';
import { hasAnyRole } from '@/server/roles';
import { listSuppliers } from '@/server/suppliers';
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
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CompanyLogo } from '@/components/company-logo';

function formatMoney(cents: number): string {
  if (cents === 0) return '—';
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

export default async function SuppliersPage() {
  const session = await getSession();
  if (!hasAnyRole(session, ['super_admin', 'admin', 'partner'])) notFound();

  const rows = await listSuppliers();
  const totals = rows.reduce(
    (acc, s) => ({
      suppliers: acc.suppliers + 1,
      bills: acc.bills + s.billCount,
      paid: acc.paid + s.totalPaidCents,
      unpaid: acc.unpaid + s.unpaidCents,
    }),
    { suppliers: 0, bills: 0, paid: 0, unpaid: 0 },
  );

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-ink">Directory</h1>
        <p className="text-sm text-ink-3">
          External suppliers aggregated from Bills. Contractor-people are listed under
          Contractors instead.
        </p>
      </header>

      <Tabs defaultValue="suppliers">
        <TabsList>
          <TabsTrigger value="people" asChild>
            <Link href="/directory">People</Link>
          </TabsTrigger>
          <TabsTrigger value="clients" asChild>
            <Link href="/directory/clients">Clients</Link>
          </TabsTrigger>
          <TabsTrigger value="contractors" asChild>
            <Link href="/directory/contractors">Contractors</Link>
          </TabsTrigger>
          <TabsTrigger value="suppliers" asChild>
            <Link href="/directory/suppliers">Suppliers</Link>
          </TabsTrigger>
          <TabsTrigger value="company" asChild>
            <Link href="/directory/company">Company</Link>
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {rows.length > 0 && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <TotalCard label="Suppliers" value={String(totals.suppliers)} sub="distinct names" />
          <TotalCard label="Bills" value={String(totals.bills)} sub="all statuses" />
          <TotalCard label="Paid" value={formatMoney(totals.paid)} sub="lifetime" />
          <TotalCard label="Unpaid" value={formatMoney(totals.unpaid)} sub="approved / scheduled" />
        </div>
      )}

      {rows.length === 0 ? (
        <Card className="p-0">
          <div className="p-12 text-center text-sm text-ink-3">
            No supplier bills yet. Add one under{' '}
            <Link href="/bills/new" className="text-brand hover:underline">
              Bills → + New bill
            </Link>
            .
          </div>
        </Card>
      ) : (
        // Split into "regular" (≥5 bills processed) vs "other" (<5).
        // Regulars are the recurring vendors we manage actively;
        // other is one-off / low-volume suppliers that surface here so
        // they're not lost, but don't dominate the main list.
        (() => {
          const REGULAR_THRESHOLD = 5;
          const regular = rows.filter((s) => s.billCount >= REGULAR_THRESHOLD);
          const other = rows.filter((s) => s.billCount < REGULAR_THRESHOLD);
          return (
            <div className="space-y-6">
              <SupplierSection
                title="Regular suppliers"
                subtitle={`Vendors with ${REGULAR_THRESHOLD}+ bills processed.`}
                rows={regular}
                emptyHint={`No supplier has hit ${REGULAR_THRESHOLD} bills yet.`}
              />
              <SupplierSection
                title="Other suppliers"
                subtitle="Low-volume / one-off vendors (under 5 bills)."
                rows={other}
                emptyHint="No occasional suppliers."
              />
            </div>
          );
        })()
      )}
    </div>
  );
}

function SupplierSection({
  title,
  subtitle,
  rows,
  emptyHint,
}: {
  title: string;
  subtitle: string;
  rows: Array<{
    name: string;
    billCount: number;
    totalPaidCents: number;
    lastBillDate: Date | null;
    categories: string[];
    unpaidCents: number;
    logoUrl: string | null;
    website: string | null;
  }>;
  emptyHint: string;
}) {
  return (
    <section>
      <header className="mb-2 flex items-baseline justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-ink">
            {title}
            <span className="ml-2 text-xs tabular-nums text-ink-3">
              {rows.length}
            </span>
          </h2>
          <p className="text-[11px] text-ink-3">{subtitle}</p>
        </div>
      </header>
      {rows.length === 0 ? (
        <Card className="p-6 text-center text-xs text-ink-3">{emptyHint}</Card>
      ) : (
        <Card className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Supplier</TableHead>
                <TableHead>Categories</TableHead>
                <TableHead className="text-right">Bills</TableHead>
                <TableHead className="text-right">Paid</TableHead>
                <TableHead className="text-right">Unpaid</TableHead>
                <TableHead>Last bill</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((s) => (
                <TableRow key={s.name}>
                  <TableCell className="font-medium text-ink">
                    <Link
                      href={`/directory/suppliers/${encodeURIComponent(s.name)}`}
                      className="flex items-center gap-2 hover:underline"
                    >
                      <CompanyLogo
                        src={s.logoUrl}
                        name={s.name}
                        className="h-7 w-7"
                      />
                      <span>{s.name}</span>
                    </Link>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {s.categories.map((c) => (
                        <Badge key={c} variant="outline" className="capitalize">
                          {c.replace(/_/g, ' ')}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {s.billCount}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-ink">
                    {(s.totalPaidCents === 0
                      ? '—'
                      : new Intl.NumberFormat('en-AU', {
                          style: 'currency',
                          currency: 'AUD',
                          maximumFractionDigits: 0,
                        }).format(s.totalPaidCents / 100))}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-status-amber">
                    {(s.unpaidCents === 0
                      ? '—'
                      : new Intl.NumberFormat('en-AU', {
                          style: 'currency',
                          currency: 'AUD',
                          maximumFractionDigits: 0,
                        }).format(s.unpaidCents / 100))}
                  </TableCell>
                  <TableCell className="tabular-nums text-xs text-ink-3">
                    {s.lastBillDate
                      ? s.lastBillDate.toLocaleDateString('en-AU')
                      : '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </section>
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
