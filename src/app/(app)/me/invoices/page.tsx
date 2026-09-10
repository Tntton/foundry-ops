import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSession } from '@/server/session';
import { hasAnyRole } from '@/server/roles';
import { prisma } from '@/server/db';
import { listMyInvoicePeriods } from '@/server/timesheet';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { ConfirmInvoiceForm } from './confirm-form';

export const dynamic = 'force-dynamic';

function money(cents: number): string {
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
  }).format(cents / 100);
}

const BILL_STATUS_COPY: Record<string, { label: string; variant: 'outline' | 'amber' | 'green' | 'blue' | 'red' }> = {
  pending_review: { label: 'in AP review', variant: 'amber' },
  approved: { label: 'approved for payment', variant: 'blue' },
  rejected: { label: 'rejected', variant: 'red' },
  scheduled_for_payment: { label: 'scheduled', variant: 'blue' },
  paid: { label: 'paid', variant: 'green' },
};

/**
 * A contractor's own invoicing surface.
 *
 * Until TASK-505 the only way to raise a contractor bill was an admin-only
 * page under /directory/people/[id]/draft-bill — so the workflow TT wanted
 * people to "easily do individually" could not be reached by the people
 * doing it. This is that surface: self-only, period-driven, and showing the
 * months still waiting on approvers as well as the ones already invoiced.
 *
 * Period-driven rather than bill-driven on purpose. A bill-driven list can
 * only show the tail of the story, and "where is my August invoice?" is
 * usually answered by "two of your three project leads haven't approved it".
 */
export default async function MyInvoicesPage({
  searchParams,
}: {
  searchParams: { personId?: string };
}) {
  const session = await getSession();
  if (!session) notFound();

  // Self-only, with an admin override for support cases. Never trust a
  // client-supplied person id without re-checking the role here.
  const isAdmin = hasAnyRole(session, ['super_admin', 'admin']);
  const targetId =
    searchParams.personId && searchParams.personId !== session.person.id
      ? searchParams.personId
      : session.person.id;
  if (targetId !== session.person.id && !isAdmin) notFound();

  const person = await prisma.person.findUnique({
    where: { id: targetId },
    select: { id: true, firstName: true, lastName: true, employment: true, rate: true },
  });
  if (!person) notFound();

  const viewingSelf = targetId === session.person.id;

  if (person.employment !== 'contractor') {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold text-ink">Invoices</h1>
        <Card className="p-12 text-center text-sm text-ink-3">
          {viewingSelf ? "You're" : `${person.firstName} is`} on full-time payroll — paid
          via the monthly pay run, so there&apos;s nothing to invoice here.{' '}
          <Link href="/timesheet" className="text-brand hover:underline">
            Go to the timesheet
          </Link>
          .
        </Card>
      </div>
    );
  }

  const periods = await listMyInvoicePeriods(person.id);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-ink">
          {viewingSelf ? 'My invoices' : `${person.firstName} ${person.lastName}'s invoices`}
        </h1>
        <p className="text-sm text-ink-3">
          Lodge a month on your timesheet, your project leads approve it, then submit your
          invoice here. A month can only be invoiced once every project in it is approved.
        </p>
      </header>

      {periods.length === 0 ? (
        <Card className="p-12 text-center text-sm text-ink-3">
          <p>No months lodged yet.</p>
          <p className="mt-1">
            Log your hours, switch the timesheet to month view, and hit{' '}
            <strong>Lodge month</strong> — it&apos;ll show up here once your leads have
            approved it.
          </p>
          <Link
            href="/timesheet?view=month"
            className="mt-3 inline-block text-brand hover:underline"
          >
            Go to my timesheet →
          </Link>
        </Card>
      ) : (
        <div className="space-y-4">
          {periods.map((p) => (
            <Card key={`${p.year}-${p.month}`} className="p-4">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <span className="font-medium text-ink">{p.monthLabel}</span>
                <StateBadge state={p.state} />
                <span className="ml-auto text-sm tabular-nums text-ink-2">
                  {p.totals.totalHours.toFixed(1)}h
                </span>
              </div>

              {p.state === 'open' && (
                <p className="text-xs text-ink-3">
                  Not lodged yet
                  {p.totals.draftHours > 0 &&
                    ` — ${p.totals.draftHours.toFixed(1)}h still in draft`}
                  .{' '}
                  <Link
                    href={`/timesheet?view=month&week=${p.monthStart.toISOString().slice(0, 10)}`}
                    className="text-brand hover:underline"
                  >
                    Open the month
                  </Link>
                </p>
              )}

              {p.state === 'lodged' && (
                <p className="text-xs text-ink-3">
                  With your project leads · {p.totals.submittedHours.toFixed(1)}h awaiting
                  approval, {p.totals.approvedHours.toFixed(1)}h approved so far. Your
                  invoice unlocks once all of it is approved.
                </p>
              )}

              {p.state === 'approved' && p.draft && (
                <ConfirmInvoiceForm
                  personId={person.id}
                  year={p.year}
                  month={p.month}
                  monthLabel={p.monthLabel}
                  hours={p.draft.hours}
                  rateCents={p.draft.rateCents}
                  amountExGstCents={p.draft.amountExGstCents}
                  expenseTotalCents={p.draft.expenseTotalCents}
                  expenseGstCents={p.draft.expenseGstCents}
                  expenseCount={p.draft.expenseCount}
                  excludedExpenseCount={p.excludedExpenseCount}
                />
              )}

              {p.state === 'approved' && !p.draft && (
                <p className="text-xs text-status-amber">
                  Approved, but no rate was on file when the month closed — an admin needs
                  to set your rate before this can be invoiced.
                </p>
              )}

              {p.bills.length > 0 && (
                <ul className="mt-3 divide-y divide-line text-xs">
                  {p.bills.map((b) => {
                    const copy = BILL_STATUS_COPY[b.status] ?? {
                      label: b.status,
                      variant: 'outline' as const,
                    };
                    return (
                      <li key={b.id} className="flex items-center gap-2 py-1.5">
                        <span className="font-mono text-ink-4">
                          {b.projectCode ?? '—'}
                        </span>
                        <span className="text-ink-3">
                          {b.supplierInvoiceNumber ?? 'no number'}
                        </span>
                        <span className="ml-auto tabular-nums text-ink">
                          {money(b.amountTotal)}
                        </span>
                        <Badge variant={copy.variant} className="text-[10px]">
                          {copy.label}
                        </Badge>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function StateBadge({ state }: { state: 'open' | 'lodged' | 'approved' | 'invoiced' }) {
  const copy = {
    open: { label: 'open', variant: 'outline' as const },
    lodged: { label: 'awaiting approval', variant: 'amber' as const },
    approved: { label: 'ready to invoice', variant: 'green' as const },
    invoiced: { label: 'invoiced', variant: 'blue' as const },
  }[state];
  return (
    <Badge variant={copy.variant} className="text-[10px]">
      {copy.label}
    </Badge>
  );
}
