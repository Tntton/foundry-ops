import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ExpenseStatus } from '@prisma/client';
import { getSession } from '@/server/session';
import { hasCapability } from '@/server/capabilities';
import { listExpenses } from '@/server/expenses';
import { PersonAvatar } from '@/components/person-avatar';
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
  searchParams: {
    status?: string;
    category?: string;
    q?: string;
    scope?: string;
    view?: string;
  };
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
  const view: 'list' | 'by-project' =
    searchParams.view === 'by-project' ? 'by-project' : 'list';

  const rows = await listExpenses(session, scope, {
    ...(status ? { status } : {}),
    ...(category ? { category } : {}),
    ...(q ? { search: q } : {}),
  });
  const canSubmit = hasCapability(session, 'expense.submit');

  // Pivot helper for the "By project" view: groups rows by project code
  // (OPEX = no project) with running subtotals. Sort buckets so OPEX lands
  // last and the rest go alphabetically by project code.
  type Bucket = {
    key: string; // project code or '__OPEX__'
    label: string; // 'IFM001 — Project X' or 'OPEX (no project)'
    code: string | null;
    name: string | null;
    rows: typeof rows;
    totalCents: number;
    gstCents: number;
  };
  const buckets: Bucket[] = (() => {
    const map = new Map<string, Bucket>();
    for (const r of rows) {
      const key = r.project?.code ?? '__OPEX__';
      const existing = map.get(key);
      if (existing) {
        existing.rows.push(r);
        existing.totalCents += r.amountCents;
        existing.gstCents += r.gstCents;
      } else {
        map.set(key, {
          key,
          label: r.project
            ? `${r.project.code} — ${r.project.name}`
            : 'OPEX (no project)',
          code: r.project?.code ?? null,
          name: r.project?.name ?? null,
          rows: [r],
          totalCents: r.amountCents,
          gstCents: r.gstCents,
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => {
      if (a.key === '__OPEX__') return 1;
      if (b.key === '__OPEX__') return -1;
      return a.key.localeCompare(b.key);
    });
  })();
  const grandTotalCents = rows.reduce((s, r) => s + r.amountCents, 0);

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-ink">Submitted Expenses</h1>
          <p className="text-sm text-ink-3">
            {scope === 'all'
              ? 'All expenses in scope.'
              : view === 'by-project'
                ? 'Your spend grouped by project code.'
                : 'Your submitted expenses.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <a
            href={`/api/reports/expenses${buildQs({
              q,
              status,
              category,
              scope: scope === 'all' ? 'all' : undefined,
            })}`}
            className="rounded-md border border-line px-3 py-1.5 text-sm text-ink-2 hover:bg-surface-hover hover:text-ink"
          >
            Download CSV
          </a>
          {canSubmit && (
            <Button asChild variant="outline">
              <Link href="/bills/intake">Drop a receipt (OCR) →</Link>
            </Button>
          )}
          {canSubmit && (
            <Button asChild>
              <Link href="/expenses/new">+ New expense</Link>
            </Button>
          )}
        </div>
      </header>

      <div
        role="tablist"
        aria-label="Expense view"
        className="inline-flex items-center gap-1 rounded-md border border-line bg-card p-1 text-sm"
      >
        <Link
          role="tab"
          aria-selected={view === 'list'}
          href={`/expenses${buildQs({
            q,
            status,
            category,
            scope: scope === 'all' ? 'all' : undefined,
            view: undefined,
          })}`}
          className={`rounded-md px-3 py-1 ${
            view === 'list'
              ? 'bg-brand text-white'
              : 'text-ink-2 hover:bg-surface-hover'
          }`}
        >
          List
        </Link>
        <Link
          role="tab"
          aria-selected={view === 'by-project'}
          href={`/expenses${buildQs({
            q,
            status,
            category,
            scope: scope === 'all' ? 'all' : undefined,
            view: 'by-project',
          })}`}
          className={`rounded-md px-3 py-1 ${
            view === 'by-project'
              ? 'bg-brand text-white'
              : 'text-ink-2 hover:bg-surface-hover'
          }`}
        >
          By project
        </Link>
      </div>

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

      {view === 'by-project' && rows.length > 0 && (
        <Card className="p-0">
          <div className="space-y-0 divide-y divide-line">
            {buckets.map((b) => (
              <section key={b.key} className="px-4 py-3">
                <header className="mb-2 flex items-baseline justify-between gap-2">
                  <h2 className="text-sm font-medium text-ink">
                    {b.code ? (
                      <Link
                        href={`/projects/${b.code}`}
                        className="hover:underline"
                      >
                        <span className="font-mono">{b.code}</span>{' '}
                        {b.name && (
                          <span className="text-ink-3">— {b.name}</span>
                        )}
                      </Link>
                    ) : (
                      <span className="text-ink-3">{b.label}</span>
                    )}
                  </h2>
                  <div className="text-right text-xs">
                    <div className="font-semibold tabular-nums text-ink">
                      {formatMoney(b.totalCents)}
                    </div>
                    <div className="text-[10px] text-ink-3">
                      {b.rows.length}{' '}
                      {b.rows.length === 1 ? 'item' : 'items'} ·{' '}
                      {formatMoney(b.gstCents)} GST
                    </div>
                  </div>
                </header>
                <ul className="divide-y divide-line text-xs">
                  {b.rows.map((e) => (
                    <li
                      key={e.id}
                      className="flex flex-wrap items-center justify-between gap-2 py-1.5"
                    >
                      <Link
                        href={`/expenses/${e.id}`}
                        className="flex min-w-0 flex-1 items-center gap-3 hover:text-ink"
                      >
                        <span className="tabular-nums text-ink-3">
                          {e.date.toLocaleDateString('en-AU')}
                        </span>
                        <span className="capitalize text-ink-2">
                          {e.category}
                        </span>
                        <span className="truncate text-ink">
                          {e.vendor ?? e.description ?? '(no description)'}
                        </span>
                      </Link>
                      <div className="flex items-center gap-3">
                        <Badge
                          variant={STATUS_VARIANT[e.status] ?? 'outline'}
                          className="text-[10px] capitalize"
                        >
                          {e.status.replace('_', ' ')}
                        </Badge>
                        <span className="font-semibold tabular-nums text-ink">
                          {formatMoney(e.amountCents)}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
            <div className="flex items-center justify-between bg-surface-subtle/40 px-4 py-3 text-sm">
              <span className="text-ink-3">
                {scope === 'mine' ? 'Your total' : 'Total in scope'} ·{' '}
                {rows.length} item{rows.length === 1 ? '' : 's'}
              </span>
              <span className="font-semibold tabular-nums text-ink">
                {formatMoney(grandTotalCents)}
              </span>
            </div>
          </div>
        </Card>
      )}

      <Card
        className={`p-0 ${view === 'by-project' && rows.length > 0 ? 'hidden' : ''}`}
      >
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
                    <Link href={`/expenses/${e.id}`} className="hover:underline">
                      {e.date.toLocaleDateString('en-AU')}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <PersonAvatar
  className="h-6 w-6"
  fallbackClassName="text-[10px]"
  initials={e.person.initials}
  headshotUrl={e.person.headshotUrl}
/>
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
