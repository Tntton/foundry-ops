import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { BillStatus } from '@prisma/client';
import { getSession } from '@/server/session';
import { hasCapability } from '@/server/capabilities';
import { listBills } from '@/server/bills';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

function buildQs(params: Record<string, string | undefined>): string {
  const entries = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(v as string)}`);
  return entries.length ? `?${entries.join('&')}` : '';
}

function formatMoney(cents: number): string {
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

const STATUS_OPTIONS: readonly BillStatus[] = [
  'pending_review',
  'approved',
  'rejected',
  'scheduled_for_payment',
  'paid',
];
const CATEGORY_OPTIONS = [
  'subscriptions',
  'hosting',
  'office',
  'professional_services',
  'contractor_payment',
  'travel',
  'other',
] as const;

export default async function BillsPage({
  searchParams,
}: {
  searchParams: { deleted?: string; status?: string; category?: string; q?: string };
}) {
  const session = await getSession();
  if (!session) notFound();

  const status = STATUS_OPTIONS.includes(searchParams.status as BillStatus)
    ? (searchParams.status as BillStatus)
    : undefined;
  const category = CATEGORY_OPTIONS.includes(searchParams.category as (typeof CATEGORY_OPTIONS)[number])
    ? searchParams.category
    : undefined;
  const q = searchParams.q?.trim() ?? '';

  const rows = await listBills(session, {
    ...(status ? { status } : {}),
    ...(category ? { category } : {}),
    ...(q ? { search: q } : {}),
  });
  const canCreate = hasCapability(session, 'bill.create');
  const deletedFlag = searchParams.deleted === '1';

  return (
    <div className="space-y-6">
      {deletedFlag && (
        <div className="rounded-md border border-status-green bg-status-green-soft px-3 py-2 text-sm text-status-green">
          Bill deleted.
        </div>
      )}
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-ink">Bills</h1>
          <p className="text-sm text-ink-3">Supplier invoices + contractor payments.</p>
        </div>
        <div className="flex items-center gap-2">
          <a
            href={`/api/reports/bills${buildQs({ q, status, category })}`}
            className="rounded-md border border-line px-3 py-1.5 text-sm text-ink-2 hover:bg-surface-hover hover:text-ink"
          >
            Download CSV
          </a>
          {canCreate && (
            <Button asChild>
              <Link href="/bills/new">+ New bill</Link>
            </Button>
          )}
        </div>
      </header>

      <form
        action="/bills"
        method="get"
        className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-card p-3"
      >
        <Input
          name="q"
          defaultValue={q}
          placeholder="Search supplier, ref, or project code…"
          className="min-w-[240px] max-w-md"
        />
        <label className="flex items-center gap-2 text-xs text-ink-3">
          <span>Status</span>
          <select
            name="status"
            defaultValue={status ?? ''}
            className="h-9 rounded-md border border-line bg-surface-elev px-2 text-sm text-ink"
          >
            <option value="">Any</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-xs text-ink-3">
          <span>Category</span>
          <select
            name="category"
            defaultValue={category ?? ''}
            className="h-9 rounded-md border border-line bg-surface-elev px-2 text-sm text-ink"
          >
            <option value="">Any</option>
            {CATEGORY_OPTIONS.map((c) => (
              <option key={c} value={c}>
                {c.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
        </label>
        <Button type="submit" size="sm" variant="outline">
          Apply
        </Button>
        {(q || status || category) && (
          <Button type="button" asChild size="sm" variant="ghost">
            <Link href="/bills">Clear</Link>
          </Button>
        )}
        <span className="ml-auto text-xs text-ink-3">
          {rows.length} {rows.length === 1 ? 'bill' : 'bills'}
        </span>
      </form>

      <Card className="p-0">
        {rows.length === 0 ? (
          <div className="p-12 text-center text-sm text-ink-3">
            {q || status || category ? (
              <>
                No bills match the current filters.{' '}
                <Link href="/bills" className="text-brand hover:underline">
                  Clear →
                </Link>
              </>
            ) : (
              <>
                No bills yet.{' '}
                {canCreate && (
                  <Link href="/bills/new" className="text-brand hover:underline">
                    Add one →
                  </Link>
                )}
              </>
            )}
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Supplier</TableHead>
                <TableHead>Their ref</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Issued</TableHead>
                <TableHead>Due</TableHead>
                <TableHead>Project</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((b) => (
                <TableRow key={b.id}>
                  <TableCell className="font-medium text-ink">
                    <Link href={`/bills/${b.id}`} className="hover:underline">
                      {b.supplierName}
                    </Link>
                  </TableCell>
                  <TableCell className="font-mono text-xs text-ink-3">
                    {b.supplierInvoiceNumber ?? '—'}
                  </TableCell>
                  <TableCell className="capitalize text-ink-2">
                    {b.category.replace('_', ' ')}
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {b.issueDate.toLocaleDateString('en-AU')}
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {b.dueDate.toLocaleDateString('en-AU')}
                  </TableCell>
                  <TableCell>
                    {b.project ? (
                      <Link
                        href={`/projects/${b.project.code}`}
                        className="font-mono text-xs text-ink-3 hover:underline"
                      >
                        {b.project.code}
                      </Link>
                    ) : (
                      <span className="text-ink-4">OPEX</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatMoney(b.amountTotal)}
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[b.status] ?? 'outline'} className="capitalize">
                      {b.status.replace(/_/g, ' ')}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
