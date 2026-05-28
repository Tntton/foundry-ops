import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSession } from '@/server/session';
import { listUserUpdates } from '@/server/user-updates';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { markMyUpdatesRead } from '../dashboard/updates-actions';

const KIND_LABEL: Record<string, string> = {
  project_allocated: 'Project',
  project_unallocated: 'Project',
  timesheet_approved: 'Timesheet',
  timesheet_rejected: 'Timesheet',
  expense_approved: 'Expense',
  expense_rejected: 'Expense',
  approval_requested: 'Approval',
  contribution_changed: 'Contribution',
  pool_status_changed: 'Status',
  inactive_set: 'Profile',
  inactive_cleared: 'Profile',
  cv_extracted: 'CV',
  person_created: 'Team',
  person_archived: 'Team',
  project_created: 'Project',
  project_stage_changed: 'Project',
  rate_card_updated: 'Rate card',
  generic: 'Update',
};

const KIND_VARIANT: Record<
  string,
  'amber' | 'green' | 'blue' | 'red' | 'outline'
> = {
  project_allocated: 'green',
  project_unallocated: 'outline',
  timesheet_approved: 'green',
  timesheet_rejected: 'red',
  expense_approved: 'green',
  expense_rejected: 'red',
  approval_requested: 'amber',
  contribution_changed: 'blue',
  pool_status_changed: 'blue',
  inactive_set: 'amber',
  inactive_cleared: 'green',
  cv_extracted: 'blue',
  person_created: 'green',
  person_archived: 'outline',
  project_created: 'green',
  project_stage_changed: 'blue',
  rate_card_updated: 'amber',
  generic: 'outline',
};

function fullDate(d: Date): string {
  return d.toLocaleString('en-AU', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function dayBucket(d: Date): string {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const dayStart = new Date(d);
  dayStart.setHours(0, 0, 0, 0);
  if (dayStart.getTime() === today.getTime()) return 'Today';
  if (dayStart.getTime() === yesterday.getTime()) return 'Yesterday';
  // Older — bucket by week. Show "Earlier this week", "Last week",
  // then a calendar-month label.
  const diffDays = Math.floor(
    (today.getTime() - dayStart.getTime()) / 86_400_000,
  );
  if (diffDays < 7) return 'Earlier this week';
  if (diffDays < 14) return 'Last week';
  return d.toLocaleDateString('en-AU', { month: 'long', year: 'numeric' });
}

/**
 * Full UserUpdate history page. The dashboard card shows the latest
 * 30 — this page shows up to 200 grouped into Today / Yesterday /
 * Earlier this week / Last week / month buckets, with a "Mark all
 * read" button up top.
 */
export default async function UpdatesPage() {
  const session = await getSession();
  if (!session) notFound();
  const updates = await listUserUpdates(session.person.id, 200);

  // Group into ordered day buckets. Map preserves insertion order, so
  // we just iterate updates (already newest-first) and assign each
  // to its bucket.
  const buckets = new Map<string, typeof updates>();
  for (const u of updates) {
    const key = dayBucket(u.createdAt);
    const arr = buckets.get(key) ?? [];
    arr.push(u);
    buckets.set(key, arr);
  }
  const unreadCount = updates.filter((u) => u.readAt === null).length;

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-ink">Updates</h1>
          <p className="text-sm text-ink-3">
            Everything that&apos;s changed about your work — allocations,
            approvals, contributions, profile changes.
          </p>
        </div>
        {unreadCount > 0 && (
          <form
            action={async () => {
              'use server';
              await markMyUpdatesRead();
            }}
          >
            <Button type="submit" size="sm" variant="outline">
              Mark all read ({unreadCount})
            </Button>
          </form>
        )}
      </header>

      {updates.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-ink-3">
            No updates yet. New activity (project allocations, approvals,
            timesheet decisions) will land here.
          </CardContent>
        </Card>
      ) : (
        [...buckets.entries()].map(([bucket, rows]) => (
          <Card key={bucket} className="p-0">
            <CardHeader className="border-b border-line bg-surface-subtle/50 py-2">
              <CardTitle className="text-xs font-semibold uppercase tracking-wide text-ink-3">
                {bucket}
                <span className="ml-2 tabular-nums text-ink-3">
                  · {rows.length}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <ul className="divide-y divide-line">
                {rows.map((u) => {
                  const isUnread = u.readAt === null;
                  const inner = (
                    <div
                      className={`flex items-start gap-3 px-4 py-3 text-sm ${
                        isUnread
                          ? 'bg-status-amber-soft/30'
                          : 'hover:bg-surface-hover'
                      }`}
                    >
                      <Badge
                        variant={KIND_VARIANT[u.kind] ?? 'outline'}
                        className="mt-0.5 shrink-0 text-[10px] capitalize"
                      >
                        {KIND_LABEL[u.kind] ?? u.kind.replace(/_/g, ' ')}
                      </Badge>
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-ink">{u.title}</div>
                        {u.body && (
                          <div className="mt-0.5 text-xs text-ink-3">
                            {u.body}
                          </div>
                        )}
                      </div>
                      <div
                        className="shrink-0 text-[11px] tabular-nums text-ink-3"
                        title={fullDate(u.createdAt)}
                      >
                        {u.createdAt.toLocaleTimeString('en-AU', {
                          hour: 'numeric',
                          minute: '2-digit',
                        })}
                      </div>
                    </div>
                  );
                  return (
                    <li key={u.id}>
                      {u.href ? (
                        <Link href={u.href} className="block">
                          {inner}
                        </Link>
                      ) : (
                        inner
                      )}
                    </li>
                  );
                })}
              </ul>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
