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

      {(visible.length > 0 || suppressed.length > 0) && (
        <Card>
          <CardContent className="p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-3">
                {visibleCount === 0
                  ? 'Nothing to clear'
                  : `${visibleCount} action${visibleCount === 1 ? '' : 's'} to clear`}
              </span>
              <span className="text-[10px] text-ink-3">
                grouped · hide or snooze what isn&apos;t yours
              </span>
            </div>

            {visible.length > 0 && (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
                {visible.map((g) => (
                  <ActionGroupColumn key={g.key} group={g} />
                ))}
              </div>
            )}

            {suppressed.length > 0 && (
              <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-2">
                <span className="text-[10px] uppercase tracking-wider text-ink-3">
                  Hidden
                </span>
                {suppressed.map((s) => (
                  <SuppressedChip key={s.key} group={s} />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/** One category column: header (label + count + hide/snooze menu) and its
 *  action list. Capped at 8 rows with an overflow note. */
function ActionGroupColumn({ group }: { group: VisibleGroup }) {
  const shown = group.actions.slice(0, 8);
  const overflow = group.actions.length - shown.length;
  return (
    <div className="rounded-lg border border-line bg-surface-subtle/20">
      <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-semibold text-ink">{group.label}</span>
          <span className="inline-flex min-w-[18px] items-center justify-center rounded-full bg-ink-3/15 px-1.5 text-[10px] font-semibold text-ink-2">
            {group.actions.length}
          </span>
        </div>
        <GroupMenu groupKey={group.key} label={group.label} />
      </div>
      <ul className="space-y-1 p-2">
        {shown.map((p, i) => (
          <li key={`${p.kind}-${i}`}>
            <Link
              href={p.href}
              className={`flex items-start gap-2 rounded-md border-l-4 bg-card px-2.5 py-2 transition-colors hover:bg-surface-hover ${
                p.tone === 'red'
                  ? 'border-status-red'
                  : p.tone === 'amber'
                    ? 'border-status-amber'
                    : 'border-status-blue'
              }`}
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-medium text-ink">
                  {p.title}
                </div>
                <div className="truncate text-[11px] text-ink-3">{p.detail}</div>
              </div>
            </Link>
          </li>
        ))}
        {overflow > 0 && (
          <li className="px-2 py-1 text-[10px] text-ink-3">+ {overflow} more</li>
        )}
      </ul>
    </div>
  );
}

/** Inline hide/snooze menu. Pure-HTML <details> disclosure — each item is
 *  a server-action form post, so no client JS is needed. */
function GroupMenu({
  groupKey,
  label,
}: {
  groupKey: ActionGroupKey;
  label: string;
}) {
  return (
    <details className="relative">
      <summary
        className="flex cursor-pointer list-none items-center rounded px-1 text-ink-3 hover:text-ink [&::-webkit-details-marker]:hidden"
        aria-label={`Hide or snooze ${label}`}
        title="Hide or snooze this group"
      >
        <span aria-hidden>⋯</span>
      </summary>
      <div className="absolute right-0 z-10 mt-1 w-40 rounded-md border border-line bg-card p-1 shadow-md">
        <MenuForm groupKey={groupKey} op="snooze" days={7} labelText="Snooze 7 days" />
        <MenuForm groupKey={groupKey} op="snooze" days={14} labelText="Snooze 14 days" />
        <MenuForm groupKey={groupKey} op="snooze" days={30} labelText="Snooze 30 days" />
        <div className="my-1 border-t border-line" />
        <MenuForm groupKey={groupKey} op="hide" labelText="Hide until I re-enable" />
      </div>
    </details>
  );
}

function MenuForm({
  groupKey,
  op,
  days,
  labelText,
}: {
  groupKey: ActionGroupKey;
  op: 'hide' | 'snooze';
  days?: number;
  labelText: string;
}) {
  return (
    <form action={updateActionGroupPref}>
      <input type="hidden" name="groupKey" value={groupKey} />
      <input type="hidden" name="op" value={op} />
      {days != null && <input type="hidden" name="days" value={days} />}
      <button
        type="submit"
        className="w-full rounded px-2 py-1.5 text-left text-xs text-ink-2 hover:bg-surface-hover"
      >
        {labelText}
      </button>
    </form>
  );
}

/** A hidden/snoozed group rendered as a chip with a one-click "Show". */
function SuppressedChip({ group }: { group: SuppressedGroup }) {
  const suffix =
    group.state.mode === 'snoozed'
      ? ` · snoozed${group.snoozeDaysLeft != null ? ` ${group.snoozeDaysLeft}d` : ''}`
      : '';
  return (
    <form action={updateActionGroupPref} className="inline-flex">
      <input type="hidden" name="groupKey" value={group.key} />
      <input type="hidden" name="op" value="clear" />
      <button
        type="submit"
        className="inline-flex items-center gap-1 rounded-full border border-line bg-card px-2.5 py-1 text-[11px] text-ink-2 hover:border-brand hover:bg-surface-hover"
        title="Show this group again"
      >
        <span>
          {group.label}
          <span className="text-ink-3">{suffix}</span>
        </span>
        <span className="font-semibold text-brand">Show</span>
      </button>
    </form>
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
