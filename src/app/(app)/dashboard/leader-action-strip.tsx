import Link from 'next/link';
import type { LeaderPendingAction, LeaderQuickActionsCount } from '@/server/leader-actions';
import {
  groupActions,
  type DashboardActionPrefs,
  type VisibleGroup,
  type SuppressedGroup,
  type ActionGroupKey,
} from '@/server/dashboard-prefs';
import { updateActionGroupPref } from './action-prefs-actions';
import { Card, CardContent } from '@/components/ui/card';

type LeaderRole = 'manager' | 'partner' | 'admin';

/**
 * Leader dashboard's top action surface. Mirrors the staff strip's
 * shape — quick-action tiles on top, pending-actions list below —
 * but the tiles + actions are role-aware:
 *
 *   - manager: Approvals + Approve timesheets + Log my hours
 *   - partner: + BD pipeline + Invoice suggestions
 *   - admin:   + everything firm-wide (counts via the same tiles)
 *
 * Sits above the existing TopStats / OperationalQc / BudgetWatch /
 * TeamWeek cards on the dashboard, so leaders see their decision
 * queue before the analytics. Read-only — each tile is a Link, the
 * actual decision surface stays where it lives (/approvals,
 * /timesheet/approve, /bd, /invoices).
 */
export function LeaderActionStrip({
  pending,
  counts,
  role,
  prefs,
  now,
}: {
  pending: LeaderPendingAction[];
  counts: LeaderQuickActionsCount;
  /** Highest-privilege role this viewer holds, used to decide which
   *  tiles to show. Admin sees everything; partner sees up to BD;
   *  manager sees the approval+timesheet tier only. */
  role: LeaderRole;
  /** This leader's saved hide/snooze state per action group. */
  prefs: DashboardActionPrefs;
  /** Evaluation time, passed from the server so snooze-expiry is stable
   *  across the render. */
  now: Date;
}) {
  const showBd = role === 'partner' || role === 'admin';
  const showInvoiceDraft = role === 'partner' || role === 'admin';

  const { visible, suppressed } = groupActions(pending, prefs, now);
  const visibleCount = visible.reduce((n, g) => n + g.actions.length, 0);

  return (
    <div className="space-y-3">
      {/* Quick-action tiles — role-aware. Self-actions (log time /
          upload receipt) tucked into a smaller row below since
          leaders mostly act ON others' work, not their own. */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <QuickActionTile
          href="/approvals"
          icon="✓"
          label="Approvals queue"
          sub={
            counts.approvalsQueue > 0
              ? `${counts.approvalsQueue} pending decision${counts.approvalsQueue === 1 ? '' : 's'}`
              : 'All cleared'
          }
          badgeCount={counts.approvalsQueue}
          tone={counts.approvalsQueue > 0 ? 'amber' : 'neutral'}
        />
        <QuickActionTile
          href="/timesheet/approve"
          icon="🕒"
          label="Timesheets"
          sub={
            counts.timesheetsToApprove > 0
              ? `${counts.timesheetsToApprove} entr${counts.timesheetsToApprove === 1 ? 'y' : 'ies'} to approve`
              : 'All cleared'
          }
          badgeCount={counts.timesheetsToApprove}
          tone={counts.timesheetsToApprove > 0 ? 'amber' : 'neutral'}
        />
        {showBd && (
          <QuickActionTile
            href="/bd"
            icon="🎯"
            label="BD pipeline"
            sub={
              counts.myBdDeals > 0
                ? `${counts.myBdDeals} open deal${counts.myBdDeals === 1 ? '' : 's'}`
                : 'Nothing in flight'
            }
            badgeCount={counts.myBdDeals}
            tone="neutral"
          />
        )}
        {showInvoiceDraft && (
          <QuickActionTile
            href="/invoices"
            icon="📄"
            label="Invoices to draft"
            sub={
              counts.invoicesToDraft > 0
                ? `${counts.invoicesToDraft} suggested`
                : 'None pending'
            }
            badgeCount={counts.invoicesToDraft}
            tone={counts.invoicesToDraft > 0 ? 'amber' : 'neutral'}
          />
        )}
      </div>

      {/* Secondary self-actions — tucked into a slim row so leaders
          who also work on projects can log time / drop receipts
          without scrolling. Same target URLs as the staff strip. */}
      <div className="flex flex-wrap gap-2 text-xs">
        <SecondaryAction href="/timesheet?view=week" icon="🕒" label="Log my hours" />
        <SecondaryAction href="/bills/intake" icon="🧾" label="Upload receipt" />
        <SecondaryAction href="/availability" icon="📅" label="Set availability" />
      </div>

      {pending.length > 0 && (
        <Card>
          <CardContent className="p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-3">
                {pending.length} action{pending.length === 1 ? '' : 's'} to
                clear
              </span>
              <span className="text-[10px] text-ink-3">tap to act</span>
            </div>
            <ul className="space-y-1">
              {pending.slice(0, 10).map((p, i) => (
                <li key={`${p.kind}-${i}`}>
                  <Link
                    href={p.href}
                    className={`flex items-start gap-3 rounded-md border-l-4 bg-surface-subtle/30 px-3 py-2 transition-colors hover:bg-surface-hover ${
                      p.tone === 'red'
                        ? 'border-status-red'
                        : p.tone === 'amber'
                          ? 'border-status-amber'
                          : 'border-status-blue'
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-sm text-ink">{p.title}</div>
                      <div className="text-xs text-ink-3">{p.detail}</div>
                    </div>
                    <span className="self-center text-ink-3">→</span>
                  </Link>
                </li>
              ))}
              {pending.length > 10 && (
                <li className="px-3 py-1 text-[11px] text-ink-3">
                  + {pending.length - 10} more — see Approvals queue / project
                  detail pages.
                </li>
              )}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function QuickActionTile({
  href,
  icon,
  label,
  sub,
  badgeCount,
  tone,
}: {
  href: string;
  icon: string;
  label: string;
  sub: string;
  badgeCount: number;
  tone: 'amber' | 'red' | 'neutral';
}) {
  const isCleared = badgeCount === 0;
  const accent =
    tone === 'red'
      ? 'border-status-red/40 bg-status-red-soft/30'
      : tone === 'amber'
        ? 'border-status-amber/40 bg-status-amber-soft/20'
        : 'border-line bg-card';
  return (
    <Link
      href={href}
      className={`flex items-center gap-3 rounded-lg border px-4 py-3 transition-colors hover:border-brand hover:bg-surface-hover ${accent}`}
    >
      <span className="text-2xl" aria-hidden>
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-ink">{label}</span>
          {!isCleared && (
            <span
              className={`inline-flex min-w-[20px] items-center justify-center rounded-full px-1.5 text-[10px] font-semibold ${
                tone === 'red'
                  ? 'bg-status-red text-white'
                  : tone === 'amber'
                    ? 'bg-status-amber text-white'
                    : 'bg-ink-3 text-white'
              }`}
            >
              {badgeCount > 99 ? '99+' : badgeCount}
            </span>
          )}
        </div>
        <div className="text-xs text-ink-3">{sub}</div>
      </div>
    </Link>
  );
}

function SecondaryAction({
  href,
  icon,
  label,
}: {
  href: string;
  icon: string;
  label: string;
}) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1.5 rounded-full border border-line bg-card px-3 py-1.5 text-ink-2 hover:border-brand hover:bg-surface-hover"
    >
      <span aria-hidden>{icon}</span>
      <span>{label}</span>
    </Link>
  );
}
