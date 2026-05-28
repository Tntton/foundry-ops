'use client';

import Link from 'next/link';
import { useEffect, useTransition } from 'react';
import type { UserUpdateRow } from '@/server/user-updates';
import { markMyUpdatesRead } from './updates-actions';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

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

function timeAgo(d: Date): string {
  const ms = Date.now() - d.getTime();
  const hrs = Math.floor(ms / 3600_000);
  if (hrs < 1) {
    const mins = Math.max(1, Math.floor(ms / 60_000));
    return `${mins}m ago`;
  }
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  return `${weeks}w ago`;
}

/**
 * "Latest updates for me" — top-of-dashboard card. Auto-marks every
 * surfaced update as read on mount so a viewer who has opened the
 * dashboard once doesn't see a stale unread bubble in the nav.
 *
 * The card always renders, even with zero updates, so the user has a
 * stable focal point for "what changed about my work."
 */
export function LatestUpdatesCard({ updates }: { updates: UserUpdateRow[] }) {
  const [, startMark] = useTransition();
  const hasUnread = updates.some((u) => u.readAt === null);

  useEffect(() => {
    if (hasUnread) {
      startMark(() => {
        void markMyUpdatesRead();
      });
    }
    // We deliberately only react to the initial unread state — once
    // we've fired the mark-read action, subsequent re-renders shouldn't
    // re-fire it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
        <CardTitle className="text-sm font-semibold uppercase tracking-wide text-ink-3">
          Latest updates for me
        </CardTitle>
        {updates.length > 0 && (
          <span className="text-[11px] text-ink-3">
            {updates.length} {updates.length === 1 ? 'item' : 'items'}
          </span>
        )}
      </CardHeader>
      <CardContent className="space-y-2 p-3 pt-0">
        {updates.length === 0 ? (
          <p className="px-1 py-3 text-xs text-ink-3">
            No new updates. You&apos;re all caught up.
          </p>
        ) : (
          updates.slice(0, 8).map((u) => {
            const isUnread = u.readAt === null;
            const inner = (
              <div
                className={`flex items-start gap-3 rounded-md px-2 py-2 text-sm ${
                  isUnread
                    ? 'bg-status-amber-soft/40'
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
                    <div className="mt-0.5 text-xs text-ink-3">{u.body}</div>
                  )}
                </div>
                <div className="shrink-0 text-[11px] tabular-nums text-ink-3">
                  {timeAgo(u.createdAt)}
                </div>
              </div>
            );
            return u.href ? (
              <Link key={u.id} href={u.href} className="block">
                {inner}
              </Link>
            ) : (
              <div key={u.id}>{inner}</div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
