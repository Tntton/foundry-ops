import Link from 'next/link';
import { prisma } from '@/server/db';
import { getSession } from '@/server/session';
import { approvalRoleFilter } from '@/server/roles';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { KPI } from '@/components/ui/kpi';

function relativeTime(d: Date): string {
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString('en-AU');
}

function entityHref(entityType: string, entityId: string): string | null {
  switch (entityType) {
    case 'invoice':
      return `/invoices/${entityId}`;
    case 'bill':
      return `/bills/${entityId}`;
    case 'expense':
      return `/expenses/${entityId}`;
    case 'client':
      return `/directory/clients/${entityId}`;
    case 'person':
      return `/directory/people/${entityId}`;
    default:
      return null;
  }
}

export default async function DashboardPage() {
  const session = await getSession();
  if (!session) {
    return (
      <div className="p-10 text-center text-sm text-ink-3">
        Sign in to view the dashboard.
      </div>
    );
  }

  const [activeProjectCount, pendingApprovals, pendingInvoices, recentActivity] =
    await Promise.all([
      prisma.project.count({ where: { stage: { not: 'archived' } } }),
      prisma.approval.count({
        where: { status: 'pending', ...approvalRoleFilter(session.person.roles) },
      }),
      prisma.invoice.count({ where: { status: 'pending_approval' } }),
      prisma.auditEvent.findMany({
        orderBy: { at: 'desc' },
        take: 8,
        include: {
          actor: {
            select: { id: true, initials: true, firstName: true, lastName: true },
          },
        },
      }),
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

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>Recent activity</CardTitle>
              <CardDescription>Firm-wide mutations, newest first.</CardDescription>
            </div>
            <Link href="/admin/audit" className="text-xs text-brand hover:underline">
              Full audit →
            </Link>
          </CardHeader>
          <CardContent>
            {recentActivity.length === 0 ? (
              <p className="text-sm text-ink-3">
                No activity yet. As soon as anyone creates or approves something it will
                show up here.
              </p>
            ) : (
              <ul className="space-y-2 text-sm">
                {recentActivity.map((e) => {
                  const href = entityHref(e.entityType, e.entityId);
                  return (
                    <li key={e.id} className="flex items-start gap-2">
                      {e.actor ? (
                        <Avatar className="mt-0.5 h-5 w-5">
                          <AvatarFallback className="text-[9px]">
                            {e.actor.initials}
                          </AvatarFallback>
                        </Avatar>
                      ) : (
                        <span className="mt-0.5 inline-block h-5 w-5 shrink-0 rounded-full bg-surface-subtle text-center text-[9px] leading-[20px] text-ink-3">
                          sys
                        </span>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-ink-2">
                            {e.actor
                              ? `${e.actor.firstName} ${e.actor.lastName}`
                              : 'System / agent'}
                          </span>
                          <Badge variant="outline" className="capitalize text-[10px]">
                            {e.action.replace(/_/g, ' ')}
                          </Badge>
                          {href ? (
                            <Link
                              href={href}
                              className="font-mono text-xs text-ink-3 hover:underline"
                            >
                              {e.entityType} · {e.entityId.slice(0, 8)}…
                            </Link>
                          ) : (
                            <span className="font-mono text-xs text-ink-3">
                              {e.entityType} · {e.entityId.slice(0, 8)}…
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-ink-3">{relativeTime(e.at)}</div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Quick actions</CardTitle>
            <CardDescription>Start a new record</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            {pendingApprovals > 0 && (
              <Link
                href="/approvals"
                className="font-medium text-status-amber hover:underline"
              >
                Review {pendingApprovals} pending{' '}
                {pendingApprovals === 1 ? 'decision' : 'decisions'} →
              </Link>
            )}
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
