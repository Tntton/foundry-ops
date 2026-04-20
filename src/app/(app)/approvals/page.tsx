import { notFound } from 'next/navigation';
import { getSession } from '@/server/session';
import { hasAnyRole } from '@/server/roles';
import { listPendingApprovals } from '@/server/approvals';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { DecisionForm } from './decision-form';

function formatMoney(cents: number): string {
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

export default async function ApprovalsPage() {
  const session = await getSession();
  if (!session || !hasAnyRole(session, ['super_admin', 'admin', 'partner', 'manager'])) {
    notFound();
  }

  const queue = await listPendingApprovals(session);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-ink">Approvals</h1>
        <p className="text-sm text-ink-3">
          {queue.length} pending {queue.length === 1 ? 'item' : 'items'} awaiting your
          decision.
        </p>
      </header>

      {queue.length === 0 ? (
        <Card>
          <div className="p-12 text-center text-sm text-ink-3">
            Nothing to approve. New submissions land here in real-time.
          </div>
        </Card>
      ) : (
        <div className="space-y-3">
          {queue.map((item) => (
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
                  </div>
                  <p className="text-sm text-ink-2">{item.summary}</p>
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
                  </div>
                </div>

                <div className="shrink-0">
                  <DecisionForm approvalId={item.id} />
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
