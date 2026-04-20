import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSession } from '@/server/session';
import { hasAnyRole } from '@/server/roles';
import { getApprovalsAnalytics, listPendingApprovals } from '@/server/approvals';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DecisionForm } from './decision-form';

function subjectHref(subjectType: string, subjectId: string): string | null {
  switch (subjectType) {
    case 'invoice':
      return `/invoices/${subjectId}`;
    case 'bill':
      return `/bills/${subjectId}`;
    case 'expense':
      return `/expenses/${subjectId}`;
    default:
      return null;
  }
}

function formatMoney(cents: number): string {
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

function ageLabel(createdAt: Date): string {
  const hours = Math.floor((Date.now() - createdAt.getTime()) / 3600_000);
  if (hours < 1) return 'just now';
  if (hours < 24) return `${hours}h old`;
  const days = Math.floor(hours / 24);
  return `${days}d old`;
}

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
        <div className="space-y-3">
          {queue.map((item) => {
            const href = subjectHref(item.subjectType, item.subjectId);
            return (
            <Card key={item.id} className="p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className="capitalize">
                      {item.subjectType.replace('_', ' ')}
                    </Badge>
                    {item.amountCents !== null && (
                      <span className="text-lg font-semibold tabular-nums text-ink">
                        {formatMoney(item.amountCents)}
                      </span>
                    )}
                    <Badge variant="amber">{item.requiredRole.replace('_', ' ')} gate</Badge>
                    <Badge variant="outline" className="text-xs">
                      {ageLabel(item.createdAt)}
                    </Badge>
                  </div>
                  <p className="text-sm text-ink-2">
                    {href ? (
                      <Link href={href} className="hover:underline">
                        {item.summary}
                      </Link>
                    ) : (
                      item.summary
                    )}
                  </p>
                  <div className="flex items-center gap-2 text-xs text-ink-3">
                    <Avatar className="h-5 w-5">
                      <AvatarFallback className="text-[9px]">
                        {item.requestedBy.initials}
                      </AvatarFallback>
                    </Avatar>
                    <span>
                      {item.requestedBy.firstName} {item.requestedBy.lastName} · submitted{' '}
                      {item.createdAt.toLocaleDateString('en-AU')}
                    </span>
                    {href && (
                      <>
                        <span>·</span>
                        <Link href={href} className="text-brand hover:underline">
                          View details →
                        </Link>
                      </>
                    )}
                  </div>
                </div>

                <div className="shrink-0">
                  <DecisionForm approvalId={item.id} />
                </div>
              </div>
            </Card>
            );
          })}
        </div>
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
