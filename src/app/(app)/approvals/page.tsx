import { notFound } from 'next/navigation';
import { getSession } from '@/server/session';
import { hasAnyRole } from '@/server/roles';
import { getApprovalsAnalytics, listPendingApprovals } from '@/server/approvals';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
                    <Avatar className="h-6 w-6">
                      <AvatarFallback className="text-[10px]">{a.initials}</AvatarFallback>
                    </Avatar>
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
        <BulkApprovalQueue
          items={queue.map((q) => ({
            id: q.id,
            subjectType: q.subjectType,
            subjectId: q.subjectId,
            requiredRole: q.requiredRole,
            amountCents: q.amountCents,
            summary: q.summary,
            createdAt: q.createdAt.toISOString(),
            requestedBy: {
              initials: q.requestedBy.initials,
              firstName: q.requestedBy.firstName,
              lastName: q.requestedBy.lastName,
            },
          }))}
        />
      )}
    </div>
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
