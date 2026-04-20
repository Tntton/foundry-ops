import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSession } from '@/server/session';
import { hasCapability } from '@/server/capabilities';
import { listBills } from '@/server/bills';
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

export default async function BillsPage() {
  const session = await getSession();
  if (!session) notFound();

  const rows = await listBills(session);
  const canCreate = hasCapability(session, 'bill.create');

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-ink">Bills</h1>
          <p className="text-sm text-ink-3">Supplier invoices + contractor payments.</p>
        </div>
        {canCreate && (
          <Button asChild>
            <Link href="/bills/new">+ New bill</Link>
          </Button>
        )}
      </header>

      <Card className="p-0">
        {rows.length === 0 ? (
          <div className="p-12 text-center text-sm text-ink-3">
            No bills yet.{' '}
            {canCreate && (
              <Link href="/bills/new" className="text-brand hover:underline">
                Add one →
              </Link>
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
