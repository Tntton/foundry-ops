import Link from 'next/link';
import type { TimesheetPeriodState } from '@prisma/client';
import type {
  TimesheetQuarterSummary,
  TimesheetSummaryStatus,
} from '@/server/timesheet';
import { formatIsoDate } from '@/lib/week';
import { cn } from '@/lib/utils';

/**
 * Quarter review: projects down, the quarter's three months across.
 *
 * Read-only on purpose. A quarter is 90-odd days and will not fit an
 * editable day grid, and reviewing a quarter is not an editing job — it is
 * "what did I log and has it been signed off". Anything that still needs
 * work is one click away through the month link in each column header.
 */
export function TimesheetQuarterView({
  summary,
  monthHref,
  hourlyRateCents,
}: {
  summary: TimesheetQuarterSummary;
  /** Builds the link into the month grid for a given month start. */
  monthHref: (monthStart: Date) => string;
  /** 0 hides the money column. */
  hourlyRateCents: number;
}) {
  const showMoney = hourlyRateCents > 0;

  if (summary.rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-line bg-card p-10 text-center">
        <h2 className="text-sm font-medium text-ink">
          No hours logged this quarter
        </h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-ink-3">
          Nothing was booked against any project between{' '}
          {summary.months[0]?.label} and {summary.months[2]?.label}. Open a
          month to log or review the days inside it.
        </p>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          {summary.months.map((m) => (
            <Link
              key={m.label}
              href={monthHref(m.start)}
              className="rounded-md border border-line px-2 py-1 text-xs text-ink-2 hover:bg-surface-hover"
            >
              {m.label} →
            </Link>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <QuarterStat label="Logged" value={`${summary.totalHours.toFixed(1)}h`} />
        <QuarterStat
          label="Approved / billed"
          value={`${summary.lockedHours.toFixed(1)}h`}
          tone="green"
        />
        <QuarterStat
          label="Awaiting approval"
          value={`${summary.submittedHours.toFixed(1)}h`}
          tone={summary.submittedHours > 0 ? 'amber' : undefined}
        />
        <QuarterStat
          label="Still draft"
          value={`${summary.draftHours.toFixed(1)}h`}
          tone={summary.draftHours > 0 ? 'red' : undefined}
        />
      </div>

      <div className="overflow-x-auto rounded-lg border border-line bg-card">
        <table className="w-full text-sm">
          <thead className="bg-surface-subtle text-ink-3">
            <tr className="border-b border-line">
              <th className="min-w-[240px] px-3 py-2 text-left">Project</th>
              {summary.months.map((m) => (
                <th key={m.label} className="min-w-[150px] px-3 py-2 text-right">
                  <Link
                    href={monthHref(m.start)}
                    className="text-ink-2 hover:text-brand hover:underline"
                  >
                    {m.label} →
                  </Link>
                  <div className="mt-1 flex justify-end">
                    <PeriodDot state={m.state} />
                  </div>
                </th>
              ))}
              <th className="px-3 py-2 text-right">Total</th>
              {showMoney && <th className="px-3 py-2 text-right">$ accrued</th>}
            </tr>
          </thead>
          <tbody>
            {summary.rows.map((r) => (
              <tr key={r.projectId} className="border-b border-line last:border-b-0">
                <td className="px-3 py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-[11px] text-ink-3">
                      {r.projectCode}
                    </span>
                    <span className="text-sm font-medium text-ink">
                      {r.projectName}
                    </span>
                  </div>
                  <span className="text-[11px] capitalize text-ink-3">
                    {r.projectStage}
                  </span>
                </td>
                {r.cells.map((c) => (
                  <td
                    key={formatIsoDate(c.monthStart)}
                    className="px-3 py-2 text-right align-top"
                  >
                    {c.hours === 0 ? (
                      <span className="text-ink-4">—</span>
                    ) : (
                      <div className="flex flex-col items-end gap-0.5">
                        <span className="font-medium tabular-nums text-ink">
                          {c.hours.toFixed(1)}h
                        </span>
                        <SummaryStatusChip
                          status={c.status}
                          lockedHours={c.lockedHours}
                          totalHours={c.hours}
                        />
                      </div>
                    )}
                  </td>
                ))}
                <td className="px-3 py-2 text-right font-semibold tabular-nums text-ink">
                  {r.totalHours.toFixed(1)}h
                </td>
                {showMoney && (
                  <td className="px-3 py-2 text-right tabular-nums text-ink-2">
                    {formatAccrued(r.totalHours * hourlyRateCents)}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
          <tfoot className="bg-brand text-white">
            <tr>
              <td className="px-3 py-2 text-left font-mono text-xs uppercase tracking-wide">
                Quarter total
              </td>
              {summary.months.map((m) => (
                <td
                  key={m.label}
                  className="px-3 py-2 text-right font-semibold tabular-nums"
                >
                  {m.hours.toFixed(1)}h
                </td>
              ))}
              <td className="px-3 py-2 text-right font-semibold tabular-nums">
                {summary.totalHours.toFixed(1)}h
              </td>
              {showMoney && (
                <td className="px-3 py-2 text-right font-semibold tabular-nums">
                  {formatAccrued(summary.totalHours * hourlyRateCents)}
                </td>
              )}
            </tr>
          </tfoot>
        </table>
      </div>

      <p className="text-[11px] text-ink-3">
        Read-only. Open a month to edit — approved and billed days are locked
        there too.
      </p>
    </div>
  );
}

function QuarterStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'green' | 'amber' | 'red';
}) {
  return (
    <div className="rounded-lg border border-line bg-card px-3 py-2">
      <div className="text-[10px] font-medium uppercase tracking-wide text-ink-3">
        {label}
      </div>
      <div
        className={cn(
          'mt-1 text-xl font-semibold tabular-nums',
          tone === 'green' && 'text-status-green',
          tone === 'amber' && 'text-status-amber',
          tone === 'red' && 'text-status-red',
          !tone && 'text-ink',
        )}
      >
        {value}
      </div>
    </div>
  );
}

/**
 * Where a month sits in the lodgement chain, as a dot rather than the full
 * chip — three of these sit in a header row and the chips crowded it.
 */
function PeriodDot({ state }: { state: TimesheetPeriodState }) {
  const copy: Record<
    TimesheetPeriodState,
    { label: string; text: string; dot: string }
  > = {
    open: { label: 'Open', text: 'text-ink-3', dot: 'bg-ink-4' },
    lodged: { label: 'Lodged', text: 'text-status-amber', dot: 'bg-status-amber' },
    approved: {
      label: 'Approved',
      text: 'text-status-green',
      dot: 'bg-status-green',
    },
    invoiced: { label: 'Invoiced', text: 'text-brand', dot: 'bg-brand' },
  };
  const c = copy[state];
  return (
    <span className={cn('inline-flex items-center gap-1 text-[10px]', c.text)}>
      <span className={cn('inline-block h-1.5 w-1.5 rounded-full', c.dot)} />
      {c.label}
    </span>
  );
}

function SummaryStatusChip({
  status,
  lockedHours,
  totalHours,
}: {
  status: TimesheetSummaryStatus;
  lockedHours: number;
  totalHours: number;
}) {
  if (status === 'none') return null;
  // A mixed month is the common case and the one worth being precise about:
  // say how much of it is locked rather than just "mixed".
  if (status === 'mixed') {
    return (
      <span
        title={`${lockedHours.toFixed(1)}h of ${totalHours.toFixed(1)}h approved or billed; the rest is still draft or awaiting approval.`}
        className="text-[10px] text-ink-3"
      >
        {lockedHours > 0
          ? `${lockedHours.toFixed(1)}h locked`
          : 'draft + submitted'}
      </span>
    );
  }
  const tone: Record<Exclude<TimesheetSummaryStatus, 'none' | 'mixed'>, string> = {
    draft: 'text-ink-3',
    submitted: 'text-status-amber',
    approved: 'text-status-green',
    billed: 'text-status-blue',
  };
  return <span className={cn('text-[10px]', tone[status])}>{status}</span>;
}

/** Cents as $X,XXX — a quick read, not GL precision. Mirrors the day grid. */
function formatAccrued(cents: number): string {
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    maximumFractionDigits: 0,
  }).format(Math.round(cents / 100));
}
