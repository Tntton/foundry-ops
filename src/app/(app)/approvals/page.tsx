import { notFound } from 'next/navigation';
import { getSession } from '@/server/session';
import { hasAnyRole } from '@/server/roles';
import { prisma } from '@/server/db';
import { getApprovalsAnalytics, listPendingApprovals } from '@/server/approvals';
import { PersonAvatar } from '@/components/person-avatar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EXPENSE_CATEGORIES } from '@/lib/expense-categories';
import { isHiddenFromAllocationPicker } from '@/lib/project-kind';
import { BulkApprovalQueue } from './bulk-queue';

export default async function ApprovalsPage() {
  const session = await getSession();
  if (!session || !hasAnyRole(session, ['super_admin', 'admin', 'partner', 'manager'])) {
    notFound();
  }

  const [queue, analytics] = await Promise.all([
    listPendingApprovals(session),
    getApprovalsAnalytics(session),
  ]);

  const oldestLabel =
    analytics.oldestPendingAgeDays === null
      ? '—'
      : analytics.oldestPendingAgeDays === 0
        ? '< 1 day'
        : `${analytics.oldestPendingAgeDays}d`;
  const avgCycleLabel =
    analytics.avgCycleHoursLast30 === null
      ? '—'
      : analytics.avgCycleHoursLast30 < 24
        ? `${analytics.avgCycleHoursLast30}h`
        : `${(analytics.avgCycleHoursLast30 / 24).toFixed(1)}d`;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-ink">Approvals</h1>
        <p className="text-sm text-ink-3">
          {queue.length} pending {queue.length === 1 ? 'item' : 'items'} awaiting your
          decision.
        </p>
      </header>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <TotalCard
          label="In your queue"
          value={String(analytics.pendingCount)}
          sub={
            Object.entries(analytics.pendingByType)
              .map(([t, n]) => `${n} ${t.replace('_', ' ')}`)
              .join(' · ') || 'nothing pending'
          }
        />
        <TotalCard
          label="Oldest waiting"
          value={oldestLabel}
          sub={
            analytics.oldestPendingAgeDays !== null && analytics.oldestPendingAgeDays >= 3
              ? 'Stale — clear soon'
              : 'All fresh'
          }
          emphasis={
            analytics.oldestPendingAgeDays !== null && analytics.oldestPendingAgeDays >= 3
          }
        />
        <TotalCard
          label="Decided last 7d"
          value={String(analytics.decidedLast7)}
          sub={`${analytics.decidedLast30} in last 30d`}
        />
        <TotalCard label="Avg cycle (30d)" value={avgCycleLabel} sub="submit → decide" />
      </div>

      {analytics.approverBreakdownLast30.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Approver throughput (last 30d)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            {analytics.approverBreakdownLast30.map((a) => {
              const pct =
                analytics.decidedLast30 > 0
                  ? Math.round((a.count / analytics.decidedLast30) * 100)
                  : 0;
              return (
                <div
                  key={a.personId}
                  className="grid grid-cols-[180px_1fr_50px] items-center gap-3"
                >
                  <div className="flex items-center gap-2">
                    <PersonAvatar
  className="h-6 w-6"
  fallbackClassName="text-[10px]"
  initials={a.initials}
  headshotUrl={a.headshotUrl}
/>
                    <span className="text-sm text-ink-2">{a.name}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div
                      className="h-2 rounded bg-brand"
                      style={{ width: `${pct}%`, minWidth: pct > 0 ? '4px' : '0' }}
                      aria-label={`${pct}% of decisions`}
                    />
                    <span className="text-xs text-ink-3">{pct}%</span>
                  </div>
                  <span className="text-right tabular-nums text-xs text-ink-2">
                    {a.count}
                  </span>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {queue.length === 0 ? (
        <Card>
          <div className="p-12 text-center text-sm text-ink-3">
            Nothing to approve. New submissions land here in real-time.
          </div>
        </Card>
      ) : (
        <ApprovalQueueWrapper queue={queue} session={session} />
      )}
    </div>
  );
}

async function ApprovalQueueWrapper({
  queue,
  session,
}: {
  queue: Awaited<ReturnType<typeof import('@/server/approvals').listPendingApprovals>>;
  session: NonNullable<Awaited<ReturnType<typeof import('@/server/session').getSession>>>;
}) {
  // Admin-only override controls at the approval gate. Three dimensions:
  //   - **Project** (FHB/FHO/FHX bucket-projects sort to the top)
  //   - **Associated user** (bills: traveller / cost-attributed person)
  //   - **Cost type** (category — drives the Xero GL account)
  // Only admins see the pickers; everyone else gets the approve/reject
  // buttons with no override.
  const canOverrideAllocation = hasAnyRole(session, ['super_admin', 'admin']);
  const expenseIds = queue
    .filter((q) => q.subjectType === 'expense')
    .map((q) => q.subjectId);
  const billIds = queue
    .filter((q) => q.subjectType === 'bill')
    .map((q) => q.subjectId);
  const [expenseRows, billRows, projectOptionsRaw, personOptionsRaw] =
    await Promise.all([
      expenseIds.length === 0
        ? Promise.resolve([])
        : prisma.expense.findMany({
            where: { id: { in: expenseIds } },
            select: {
              id: true,
              projectId: true,
              project: { select: { code: true, name: true } },
              category: true,
            },
          }),
      // Pull projectId + category + attributedToPersonId + receivedVia
      // for every bill in the queue. The receivedVia tag drives the
      // "via navan_csv / navan_api" chip so admin sees at a glance
      // that a row came in from Navan; the other three fields back
      // the admin override pickers. Also pull the project's code +
      // name so pickers can pin a "(current)" option when a row is
      // already tagged to an FHB/FHO bucket (which are otherwise
      // filtered out of the picker).
      billIds.length === 0
        ? Promise.resolve([])
        : prisma.bill.findMany({
            where: { id: { in: billIds } },
            select: {
              id: true,
              projectId: true,
              project: { select: { code: true, name: true } },
              category: true,
              attributedToPersonId: true,
              attributedTo: {
                select: {
                  initials: true,
                  firstName: true,
                  lastName: true,
                  headshotUrl: true,
                },
              },
              receivedVia: true,
            },
          }),
      canOverrideAllocation
        ? prisma.project.findMany({
            where: { stage: { not: 'archived' } },
            orderBy: { code: 'asc' },
            select: { id: true, code: true, name: true },
          })
        : Promise.resolve([]),
      // Person picker for the "associated user" override — active
      // people only (no end-dated leavers), sorted by first name so
      // the picker is browseable without a search.
      canOverrideAllocation
        ? prisma.person.findMany({
            where: { inactiveAt: null },
            orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
            select: { id: true, firstName: true, lastName: true },
          })
        : Promise.resolve([]),
    ]);
  // All three *000 catch-alls (FHB000 BD, FHO000 Operations, FHX000
  // Other) sort to the top as initial-allocation targets — admin can
  // pick any of them, and re-assign to a more specific code later
  // (TT 2026-06-16). `isHiddenFromAllocationPicker` is currently empty
  // but kept as a configurable choke-point in case policy reverses.
  const visibleProjects = projectOptionsRaw.filter(
    (p) => !isHiddenFromAllocationPicker(p.code),
  );
  const BUCKETS = ['FHB000', 'FHO000', 'FHX000'];
  const bucketProjects = visibleProjects
    .filter((p) => BUCKETS.includes(p.code))
    .sort((a, b) => BUCKETS.indexOf(a.code) - BUCKETS.indexOf(b.code));
  const otherProjects = visibleProjects.filter((p) => !BUCKETS.includes(p.code));
  const projectOptions = [...bucketProjects, ...otherProjects];
  const personOptions = personOptionsRaw.map((p) => ({
    id: p.id,
    firstName: p.firstName,
    lastName: p.lastName,
  }));
  // Category picker draws from the canonical lib so Xero pushes land
  // in the right GL account. Pre-sorted by label for predictable UX.
  const categoryOptions = [...EXPENSE_CATEGORIES]
    .sort((a, b) => a.label.localeCompare(b.label))
    .map((c) => ({ value: c.value, label: c.label }));
  const expenseRowById = new Map(expenseRows.map((e) => [e.id, e]));
  const billRowById = new Map(billRows.map((b) => [b.id, b]));
  return (
    <BulkApprovalQueue
      canOverrideAllocation={canOverrideAllocation}
      projectOptions={projectOptions}
      personOptions={personOptions}
      categoryOptions={categoryOptions}
      items={queue.map((q) => {
        const exp = q.subjectType === 'expense' ? expenseRowById.get(q.subjectId) : undefined;
        const bil = q.subjectType === 'bill' ? billRowById.get(q.subjectId) : undefined;
        return {
          id: q.id,
          subjectType: q.subjectType,
          subjectId: q.subjectId,
          requiredRole: q.requiredRole,
          amountCents: q.amountCents,
          summary: q.summary,
          createdAt: q.createdAt.toISOString(),
          requestedBy: {
            id: q.requestedBy.id,
            initials: q.requestedBy.initials,
            firstName: q.requestedBy.firstName,
            lastName: q.requestedBy.lastName,
            headshotUrl: q.requestedBy.headshotUrl,
          },
          subjectProjectId: exp?.projectId ?? bil?.projectId ?? null,
          // Code + name passed alongside so pickers can pin a
          // "(current) …" option when the row is tagged to a project
          // that's been hidden from the picker. Avoids a "value
          // matches no option" state on the controlled select.
          subjectProjectCode: exp?.project?.code ?? bil?.project?.code ?? null,
          subjectProjectName: exp?.project?.name ?? bil?.project?.name ?? null,
          subjectCategory: exp?.category ?? bil?.category ?? null,
          // Only bills carry an `attributedTo` person (the cost
          // recipient, e.g. the traveller on a Navan-imported flight).
          // Expenses don't — the submitter IS the cost recipient by
          // definition, and re-pointing that mid-approval would break
          // reimbursement audit trails.
          subjectAttributedToPersonId: bil?.attributedToPersonId ?? null,
          subjectAttributedTo: bil?.attributedTo
            ? {
                initials: bil.attributedTo.initials,
                firstName: bil.attributedTo.firstName,
                lastName: bil.attributedTo.lastName,
                headshotUrl: bil.attributedTo.headshotUrl,
              }
            : null,
          // Source chip only renders for non-manual `receivedVia` values
          // today (Navan API + CSV). When M365 email-intake lands this
          // surfaces `m365_email`, etc — same chip, same UX.
          subjectSource: bil?.receivedVia ?? null,
        };
      })}
    />
  );
}

function TotalCard({
  label,
  value,
  sub,
  emphasis,
}: {
  label: string;
  value: string;
  sub?: string;
  emphasis?: boolean;
}) {
  return (
    <Card>
      <CardHeader className="pb-1">
        <CardTitle className="text-xs font-medium uppercase tracking-wide text-ink-3">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div
          className={`text-lg font-semibold tabular-nums ${
            emphasis ? 'text-status-amber' : 'text-ink'
          }`}
        >
          {value}
        </div>
        {sub && <div className="text-[11px] text-ink-3">{sub}</div>}
      </CardContent>
    </Card>
  );
}
