import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { InvoiceStatus } from '@prisma/client';
import { getSession } from '@/server/session';
import { hasCapability } from '@/server/capabilities';
import { listInvoices } from '@/server/invoices';
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

function formatMoney(cents: number): string {
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

const STATUS_VARIANT: Record<string, 'outline' | 'amber' | 'green' | 'blue' | 'red'> = {
  draft: 'outline',
  pending_approval: 'amber',
  approved: 'blue',
  sent: 'blue',
  partial: 'amber',
  paid: 'green',
  overdue: 'red',
  written_off: 'outline',
};

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

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: { deleted?: string; status?: string; q?: string };
}) {
  const session = await getSession();
  if (!session) notFound();

  const status = STATUS_OPTIONS.includes(searchParams.status as InvoiceStatus)
    ? (searchParams.status as InvoiceStatus)
    : undefined;
  const q = searchParams.q?.trim() ?? '';

  const rows = await listInvoices(session, {
    ...(status ? { status } : {}),
    ...(q ? { search: q } : {}),
  });
  const canCreate = hasCapability(session, 'invoice.create');
  const deletedFlag = searchParams.deleted === '1';

  return (
    <div className="space-y-6">
      {deletedFlag && (
        <div className="rounded-md border border-status-green bg-status-green-soft px-3 py-2 text-sm text-status-green">
          Draft invoice deleted.
        </div>
      )}
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-ink">Invoices</h1>
          <p className="text-sm text-ink-3">Drafts, pending approvals, and AR.</p>
        </div>
        {canCreate && (
          <Button asChild>
            <Link href="/invoices/new">+ New invoice</Link>
          </Button>
        )}
      </header>

      <form
        action="/invoices"
        method="get"
        className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-card p-3"
      >
        <Input
          name="q"
          defaultValue={q}
          placeholder="Search invoice number, client, or project…"
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
        <Button type="submit" size="sm" variant="outline">
          Apply
        </Button>
        {(q || status) && (
          <Button type="button" asChild size="sm" variant="ghost">
            <Link href="/invoices">Clear</Link>
          </Button>
        )}
        <span className="ml-auto text-xs text-ink-3">
          {rows.length} {rows.length === 1 ? 'invoice' : 'invoices'}
        </span>
      </form>

      <Card className="p-0">
        {rows.length === 0 ? (
          <div className="p-12 text-center text-sm text-ink-3">
            {q || status ? (
              <>
                No invoices match the current filters.{' '}
                <Link href="/invoices" className="text-brand hover:underline">
                  Clear →
                </Link>
              </>
            ) : (
              <>
                No invoices yet.{' '}
                {canCreate && (
                  <Link href="/invoices/new" className="text-brand hover:underline">
                    Draft one →
                  </Link>
                )}
              </>
            )}
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Number</TableHead>
                <TableHead>Client / Project</TableHead>
                <TableHead>Issued</TableHead>
                <TableHead>Due</TableHead>
                <TableHead className="text-right">Ex GST</TableHead>
                <TableHead className="text-right">GST</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((i) => (
                <TableRow key={i.id}>
                  <TableCell>
                    <Link
                      href={`/invoices/${i.id}`}
                      className="font-mono text-ink hover:underline"
                    >
                      {i.number}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <div className="text-sm text-ink">{i.client.legalName}</div>
                    <div className="font-mono text-[11px] text-ink-3">{i.project.code}</div>
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {i.issueDate.toLocaleDateString('en-AU')}
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {i.dueDate.toLocaleDateString('en-AU')}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-ink-3">
                    {formatMoney(i.amountExGst)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-ink-3">
                    {formatMoney(i.gst)}
                  </TableCell>
                  <TableCell className="text-right font-semibold tabular-nums text-ink">
                    {formatMoney(i.amountTotal)}
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[i.status] ?? 'outline'} className="capitalize">
                      {i.status.replace('_', ' ')}
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
