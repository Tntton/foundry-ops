import Link from 'next/link';
import { prisma } from '@/server/db';
import { getSession } from '@/server/session';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { KPI } from '@/components/ui/kpi';

export default async function DashboardPage() {
  const session = await getSession();
  if (!session) {
    return (
      <div className="p-10 text-center text-sm text-ink-3">
        Sign in to view the dashboard.
      </div>
    );
  }

  const [activeProjectCount, pendingApprovals, pendingInvoices] = await Promise.all([
    prisma.project.count({ where: { stage: { not: 'archived' } } }),
    prisma.approval.count({
      where: { status: 'pending', requiredRole: { in: session.person.roles } },
    }),
    prisma.invoice.count({ where: { status: 'pending_approval' } }),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-ink">Dashboard</h1>
        <p className="text-sm text-ink-3">
          Welcome back, {session.person.firstName}. Jump into what needs your attention.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KPI
          label="Active projects"
          value={String(activeProjectCount)}
          sub={activeProjectCount === 0 ? 'None yet' : 'Not archived'}
          trend="flat"
        />
        <KPI
          label="Your approvals"
          value={String(pendingApprovals)}
          sub={pendingApprovals === 0 ? 'Queue empty' : 'Pending decisions'}
          trend="flat"
        />
        <KPI
          label="Invoices pending"
          value={String(pendingInvoices)}
          sub="Awaiting approval"
          trend="flat"
        />
        <KPI
          label="Cash on hand"
          value="—"
          sub="From Xero once reconciler agent ships"
          trend="flat"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Approvals queue</CardTitle>
            <CardDescription>Decisions awaiting you</CardDescription>
          </CardHeader>
          <CardContent className="text-sm">
            {pendingApprovals === 0 ? (
              <p className="text-ink-3">Nothing to approve right now.</p>
            ) : (
              <Link href="/approvals" className="text-brand hover:underline">
                Review {pendingApprovals} pending{' '}
                {pendingApprovals === 1 ? 'decision' : 'decisions'} →
              </Link>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Quick actions</CardTitle>
            <CardDescription>Start a new record</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-3 text-sm">
            <Link href="/projects/new" className="text-brand hover:underline">
              + Project
            </Link>
            <Link href="/directory/clients/new" className="text-brand hover:underline">
              + Client
            </Link>
            <Link href="/invoices/new" className="text-brand hover:underline">
              + Invoice
            </Link>
            <Link href="/bills/new" className="text-brand hover:underline">
              + Bill
            </Link>
            <Link href="/expenses/new" className="text-brand hover:underline">
              + Expense
            </Link>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
