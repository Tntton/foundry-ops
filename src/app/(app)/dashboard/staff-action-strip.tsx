import Link from 'next/link';
import type { StaffPendingAction } from '@/server/staff-actions';
import { Card, CardContent } from '@/components/ui/card';

/**
 * Staff dashboard's top strip: big-tap quick-action tiles + a
 * compact "outstanding actions" panel underneath. Designed for a
 * busy consultant landing on the app between meetings — the goal is
 * "you can act in one tap" rather than "scroll a feed to find what
 * matters". Both surfaces are server-rendered so first paint shows
 * the right info without a network round-trip from a client hook.
 *
 * Layout:
 *   - Quick-action tiles: 3 tiles on desktop, 1-col stack on mobile.
 *     Sized for thumb-tap (≥80px tall).
 *   - Outstanding strip: shown only when pending.length > 0. Each
 *     row is a Link wrapping the title + detail + an arrow chevron;
 *     tone-colored left border encodes urgency (red overdue / amber
 *     nudge / blue info) without taking a full chip.
 */
export function StaffActionStrip({
  pending,
  initials,
}: {
  pending: StaffPendingAction[];
  initials: string;
}) {
  return (
    <div className="space-y-3">
      {/* Quick-action tiles — the three actions a consultant uses
          most. Sized for thumb-tap and ordered by frequency: log time
          (daily) > upload receipt (after a meal/trip) > set
          availability (weekly). */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <QuickActionTile
          href="/timesheet?view=week"
          icon="🕒"
          label="Log hours"
          sub="This week's grid"
        />
        <QuickActionTile
          href="/bills/intake"
          icon="🧾"
          label="Upload receipt"
          sub="Drop a photo or PDF"
        />
        <QuickActionTile
          href="/availability"
          icon="📅"
          label="Set availability"
          sub="Plan upcoming weeks"
        />
      </div>

      {pending.length > 0 && (
        <Card>
          <CardContent className="p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-3">
                {initials} · {pending.length} pending action
                {pending.length === 1 ? '' : 's'}
              </span>
              <span className="text-[10px] text-ink-3">
                tap to act
              </span>
            </div>
            <ul className="space-y-1">
              {pending.map((p, i) => (
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
}: {
  href: string;
  icon: string;
  label: string;
  sub: string;
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-3 rounded-lg border border-line bg-card px-4 py-3 transition-colors hover:border-brand hover:bg-surface-hover"
    >
      <span className="text-2xl" aria-hidden>
        {icon}
      </span>
      <div className="min-w-0">
        <div className="text-sm font-semibold text-ink">{label}</div>
        <div className="text-xs text-ink-3">{sub}</div>
      </div>
    </Link>
  );
}
