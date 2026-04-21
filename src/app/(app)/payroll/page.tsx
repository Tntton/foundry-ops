import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { PayRunStatus, PayRunType } from '@prisma/client';
import { getSession } from '@/server/session';
import { hasCapability } from '@/server/capabilities';
import { listPayRuns } from '@/server/payruns';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
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

const STATUS_VARIANT: Record<PayRunStatus, 'outline' | 'amber' | 'blue' | 'green'> = {
  draft: 'outline',
  approved: 'amber',
  aba_generated: 'blue',
  uploaded_to_paydotcomau: 'blue',
  paid: 'green',
  reconciled: 'green',
};

const TYPE_LABEL: Record<PayRunType, string> = {
  payroll: 'Payroll',
  super: 'Super',
  contractor_ap: 'Contractor AP',
  supplier_ap: 'Supplier AP',
  mixed: 'Mixed',
};

export default async function PayrollPage({
  searchParams,
}: {
  searchParams: { created?: string };
}) {
  const session = await getSession();
  if (!hasCapability(session, 'payrun.create')) notFound();

  const canCreate = hasCapability(session, 'payrun.create');
  const rows = await listPayRuns();

  return (
    <div className="space-y-6">
      {searchParams.created === '1' && (
        <div className="rounded-md border border-status-green bg-status-green-soft px-3 py-2 text-sm text-status-green">
          Pay-run created.
        </div>
      )}

      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-ink">Pay runs</h1>
          <p className="text-sm text-ink-3">
            Batched AP payouts for contractors and suppliers. Generate an ABA file once
            the batch is approved; upload to the bank outside Foundry Ops.
          </p>
        </div>
        {canCreate && (
          <Button asChild>
            <Link href="/payroll/new">+ New pay run</Link>
          </Button>
        )}
      </header>

      <Card className="p-0">
        {rows.length === 0 ? (
          <div className="p-12 text-center text-sm text-ink-3">
            No pay runs yet.{' '}
            {canCreate && (
              <Link href="/payroll/new" className="text-brand hover:underline">
                Create the first one →
              </Link>
            )}
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Type</TableHead>
                <TableHead>Period</TableHead>
                <TableHead className="text-right">Lines</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Approved</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>
                    <Link href={`/payroll/${p.id}`} className="hover:underline">
                      <Badge variant="outline" className="capitalize">
                        {TYPE_LABEL[p.type]}
                      </Badge>
                    </Link>
                  </TableCell>
                  <TableCell className="tabular-nums text-xs text-ink-2">
                    {p.periodStart.toLocaleDateString('en-AU')} →{' '}
                    {p.periodEnd.toLocaleDateString('en-AU')}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{p.lineCount}</TableCell>
                  <TableCell className="text-right font-semibold tabular-nums text-ink">
                    {formatMoney(p.totalCents)}
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[p.status]} className="capitalize">
                      {p.status.replace(/_/g, ' ')}
                    </Badge>
                  </TableCell>
                  <TableCell className="tabular-nums text-xs text-ink-3">
                    {p.approvedAt ? p.approvedAt.toLocaleDateString('en-AU') : '—'}
                  </TableCell>
                  <TableCell className="tabular-nums text-xs text-ink-3">
                    {p.createdAt.toLocaleDateString('en-AU')}
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
