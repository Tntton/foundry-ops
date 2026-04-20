import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSession } from '@/server/session';
import { hasAnyRole } from '@/server/roles';
import { prisma } from '@/server/db';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

function formatMoney(cents: number): string {
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

const STATUS_VARIANT: Record<string, 'outline' | 'amber' | 'green' | 'blue' | 'red'> = {
  draft: 'outline',
  submitted: 'amber',
  approved: 'green',
  rejected: 'red',
  reimbursed: 'blue',
  batched_for_payment: 'blue',
};

export default async function ExpenseDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const session = await getSession();
  if (!session) notFound();

  const expense = await prisma.expense.findUnique({
    where: { id: params.id },
    include: {
      person: {
        select: { id: true, initials: true, firstName: true, lastName: true, email: true },
      },
      project: { select: { id: true, code: true, name: true, managerId: true, primaryPartnerId: true } },
    },
  });
  if (!expense) notFound();

  // Visibility: admin+ can see any; manager+partner can see their projects; submitter can see own.
  const canSeeAll = hasAnyRole(session, ['super_admin', 'admin']);
  const isOwner = expense.personId === session.person.id;
  const isProjectOwner =
    expense.project &&
    (expense.project.managerId === session.person.id ||
      expense.project.primaryPartnerId === session.person.id);
  if (!canSeeAll && !isOwner && !isProjectOwner) notFound();

  const [pendingApproval, approver] = await Promise.all([
    prisma.approval.findFirst({
      where: { subjectType: 'expense', subjectId: expense.id, status: 'pending' },
      select: { id: true, requiredRole: true, createdAt: true },
    }),
    expense.approvedById
      ? prisma.person.findUnique({
          where: { id: expense.approvedById },
          select: { id: true, initials: true, firstName: true, lastName: true },
        })
      : Promise.resolve(null),
  ]);

  const amountExGst = expense.amount - expense.gst;

  return (
    <div className="space-y-6">
      <div className="text-sm">
        <Link href="/expenses" className="text-ink-3 hover:text-ink">
          ← Back to Expenses
        </Link>
      </div>

      <header className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="capitalize">
              {expense.category.replace(/_/g, ' ')}
            </Badge>
            <h1 className="text-xl font-semibold text-ink">
              {expense.vendor ?? 'Expense'}
            </h1>
            <Badge
              variant={STATUS_VARIANT[expense.status] ?? 'outline'}
              className="capitalize"
            >
              {expense.status.replace('_', ' ')}
            </Badge>
          </div>
          <p className="mt-1 text-sm text-ink-3">
            Submitted by{' '}
            <Link
              href={`/directory/people/${expense.person.id}`}
              className="text-ink-2 hover:underline"
            >
              {expense.person.firstName} {expense.person.lastName}
            </Link>{' '}
            on {expense.createdAt.toLocaleDateString('en-AU')}
          </p>
        </div>
        <div className="text-right">
          <div className="text-xs text-ink-3">Total (inc GST)</div>
          <div className="text-2xl font-semibold tabular-nums text-ink">
            {formatMoney(expense.amount)}
          </div>
          <div className="text-xs text-ink-3">
            {formatMoney(amountExGst)} ex · {formatMoney(expense.gst)} GST
          </div>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Date</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-ink">
            {expense.date.toLocaleDateString('en-AU')}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Project</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            {expense.project ? (
              <Link
                href={`/projects/${expense.project.code}`}
                className="flex items-center gap-2 hover:underline"
              >
                <Badge variant="outline" className="font-mono">
                  {expense.project.code}
                </Badge>
                <span className="text-ink">{expense.project.name}</span>
              </Link>
            ) : (
              <span className="text-ink-3">OPEX — no project</span>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Approval</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-ink">
            {approver ? (
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Avatar className="h-6 w-6">
                    <AvatarFallback className="text-[10px]">
                      {approver.initials}
                    </AvatarFallback>
                  </Avatar>
                  <span>
                    {approver.firstName} {approver.lastName}
                  </span>
                </div>
                {expense.approvedAt && (
                  <div className="text-xs text-ink-3">
                    {expense.approvedAt.toLocaleString('en-AU', { hour12: false })}
                  </div>
                )}
              </div>
            ) : pendingApproval ? (
              <div className="space-y-1">
                <Badge variant="amber" className="capitalize">
                  Pending · {pendingApproval.requiredRole.replace('_', ' ')} gate
                </Badge>
                <Link
                  href="/approvals"
                  className="block text-xs text-brand hover:underline"
                >
                  Open queue →
                </Link>
              </div>
            ) : (
              <span className="text-ink-3">Not yet submitted for approval</span>
            )}
          </CardContent>
        </Card>
      </div>

      {(expense.description || expense.receiptSharepointUrl) && (
        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {expense.description && (
              <Row label="Description">
                <p className="whitespace-pre-wrap text-ink-2">{expense.description}</p>
              </Row>
            )}
            {expense.receiptSharepointUrl && (
              <Row label="Receipt">
                <a
                  href={expense.receiptSharepointUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-brand hover:underline"
                >
                  Open in SharePoint →
                </a>
              </Row>
            )}
            <Row label="Source">
              {expense.parsedByAgentRunId ? (
                <Badge variant="blue">Agent-parsed</Badge>
              ) : (
                <Badge variant="outline">Manual entry</Badge>
              )}
            </Row>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[120px_1fr] gap-2 py-1">
      <div className="text-ink-3">{label}</div>
      <div className="text-ink">{children}</div>
    </div>
  );
}
