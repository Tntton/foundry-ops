import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ExpenseStatus } from '@prisma/client';
import { getSession } from '@/server/session';
import { hasCapability } from '@/server/capabilities';
import { listExpenses } from '@/server/expenses';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
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

const STATUS_OPTIONS: readonly ExpenseStatus[] = [
  'draft',
  'submitted',
  'approved',
  'rejected',
  'reimbursed',
  'batched_for_payment',
];
const CATEGORY_OPTIONS = [
  'travel',
  'meals',
  'office',
  'tools',
  'subscriptions',
  'other',
] as const;

export default async function ExpensesPage({
  searchParams,
}: {
  searchParams: { status?: string; category?: string; q?: string; scope?: string };
}) {
  const session = await getSession();
  if (!session) notFound();

  const status = STATUS_OPTIONS.includes(searchParams.status as ExpenseStatus)
    ? (searchParams.status as ExpenseStatus)
    : undefined;
  const category = CATEGORY_OPTIONS.includes(
    searchParams.category as (typeof CATEGORY_OPTIONS)[number],
  )
    ? searchParams.category
    : undefined;
  const q = searchParams.q?.trim() ?? '';
  const canSeeAll = hasCapability(session, 'expense.approve.under_2k');
  const scope: 'mine' | 'all' =
    canSeeAll && searchParams.scope === 'all' ? 'all' : 'mine';

  const rows = await listExpenses(session, scope, {
    ...(status ? { status } : {}),
    ...(category ? { category } : {}),
    ...(q ? { search: q } : {}),
  });
  const canSubmit = hasCapability(session, 'expense.submit');

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-ink">Expenses</h1>
          <p className="text-sm text-ink-3">
            {scope === 'all' ? 'All expenses in scope.' : 'Your submitted expenses.'}
          </p>
        </div>
        {canSubmit && (
          <Button asChild>
            <Link href="/expenses/new">+ New expense</Link>
          </Button>
        )}
      </header>

      <form
        action="/expenses"
        method="get"
        className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-card p-3"
      >
        <Input
          name="q"
          defaultValue={q}
          placeholder="Search vendor, description, or project code…"
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
                {c}
              </option>
            ))}
          </select>
        </label>
        {canSeeAll && (
          <label className="flex items-center gap-2 text-xs text-ink-3">
            <span>Scope</span>
            <select
              name="scope"
              defaultValue={scope}
              className="h-9 rounded-md border border-line bg-surface-elev px-2 text-sm text-ink"
            >
              <option value="mine">Mine</option>
              <option value="all">All in scope</option>
            </select>
          </label>
        )}
        <Button type="submit" size="sm" variant="outline">
          Apply
        </Button>
        {(q || status || category || scope === 'all') && (
          <Button type="button" asChild size="sm" variant="ghost">
            <Link href="/expenses">Clear</Link>
          </Button>
        )}
        <span className="ml-auto text-xs text-ink-3">
          {rows.length} {rows.length === 1 ? 'expense' : 'expenses'}
        </span>
      </form>

      <Card className="p-0">
        {rows.length === 0 ? (
          <div className="p-12 text-center text-sm text-ink-3">
            {q || status || category || scope === 'all' ? (
              <>
                No expenses match the current filters.{' '}
                <Link href="/expenses" className="text-brand hover:underline">
                  Clear →
                </Link>
              </>
            ) : (
              <>
                No expenses yet.{' '}
                {canSubmit && (
                  <Link href="/expenses/new" className="text-brand hover:underline">
                    Submit one →
                  </Link>
                )}
              </>
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
