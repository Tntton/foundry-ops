import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSession } from '@/server/session';
import { hasCapability } from '@/server/capabilities';
import { listExpenses } from '@/server/expenses';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
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
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

const STATUS_VARIANT: Record<string, 'amber' | 'green' | 'red' | 'blue' | 'outline'> = {
  draft: 'outline',
  submitted: 'amber',
  approved: 'green',
  rejected: 'red',
  reimbursed: 'blue',
  batched_for_payment: 'blue',
};

export default async function ExpensesPage() {
  const session = await getSession();
  if (!session) notFound();

  const rows = await listExpenses(session, 'mine');
  const canSubmit = hasCapability(session, 'expense.submit');

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-ink">Expenses</h1>
          <p className="text-sm text-ink-3">Your submitted expenses.</p>
        </div>
        {canSubmit && (
          <Button asChild>
            <Link href="/expenses/new">+ New expense</Link>
          </Button>
        )}
      </header>

      <Card className="p-0">
        {rows.length === 0 ? (
          <div className="p-12 text-center text-sm text-ink-3">
            No expenses yet.{' '}
            {canSubmit && (
              <Link href="/expenses/new" className="text-brand hover:underline">
                Submit one →
              </Link>
            )}
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Person</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Vendor</TableHead>
                <TableHead>Project</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="text-right">GST</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="tabular-nums">
                    {e.date.toLocaleDateString('en-AU')}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Avatar className="h-6 w-6">
                        <AvatarFallback className="text-[10px]">
                          {e.person.initials}
                        </AvatarFallback>
                      </Avatar>
                      <span className="text-sm">
                        {e.person.firstName} {e.person.lastName}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="capitalize text-ink-2">{e.category}</TableCell>
                  <TableCell className="text-ink-2">{e.vendor ?? '—'}</TableCell>
                  <TableCell>
                    {e.project ? (
                      <Link
                        href={`/projects/${e.project.code}`}
                        className="font-mono text-xs text-ink-3 hover:underline"
                      >
                        {e.project.code}
                      </Link>
                    ) : (
                      <span className="text-ink-4">OPEX</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatMoney(e.amountCents)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-ink-3">
                    {formatMoney(e.gstCents)}
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[e.status] ?? 'outline'} className="capitalize">
                      {e.status.replace('_', ' ')}
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
