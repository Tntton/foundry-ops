import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { BandSupplyReport, SupplyTotals } from '@/server/band-supply';

/**
 * Band supply — "how many analyst hours can we sell?" (TT, 2026-10-23).
 *
 * Daily strip covers the first fortnight, because that is the window a
 * staffing conversation actually happens in; the weekly row spans the
 * whole selected horizon. Both read the same totals, so a week column
 * is exactly the sum of its days.
 */

const DAYS_SHOWN = 14;

function hoursCell(t: SupplyTotals, dim: boolean) {
  const free = t.availableHours;
  return (
    <div className="leading-tight">
      <span
        className={`block text-xs font-semibold tabular-nums ${
          free > 0 ? 'text-ink' : 'text-ink-3'
        } ${dim ? 'opacity-50' : ''}`}
      >
        {free > 0 ? free : '—'}
      </span>
      {t.assumedFreeHours > 0 && (
        <span
          className="block text-[9px] tabular-nums text-ink-3"
          title={`${t.assumedFreeHours}h inferred from standing schedules, not an explicit forecast`}
        >
          {t.assumedFreeHours} est
        </span>
      )}
    </div>
  );
}

export function BandSupplyCard({
  supply,
  weeksAhead,
}: {
  supply: BandSupplyReport;
  weeksAhead: number;
}) {
  const dayCount = Math.min(DAYS_SHOWN, supply.days.length);
  const days = supply.days.slice(0, dayCount);
  const silentTotal = supply.rows.reduce((s, r) => s + r.silentCount, 0);
  const headcountTotal = supply.rows.reduce((s, r) => s + r.headcount, 0);
  const analyst = supply.rows.find((r) => r.band === 'Analyst');
  const analystThisWeek = analyst?.weeks[0]?.availableHours ?? 0;

  if (headcountTotal === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Hours available</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-ink-3">
            No salaried Analyst, Consultant or Expert staff on the books
            yet, so there is no band supply to report.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">
          Hours available · {analystThisWeek}h analyst this week
        </CardTitle>
        <p className="text-[11px] text-ink-3">
          Forecast hours with no project against them — what is left to
          sell. Hours already tagged to a project are committed and not
          counted. <span className="font-medium text-ink-2">est</span> hours
          are inferred from a person&apos;s standing schedule rather than a
          forecast they submitted.
          {silentTotal > 0 && (
            <>
              {' '}
              <span className="text-status-amber">
                {silentTotal} of {headcountTotal} have neither — their
                capacity is unknown, not free.
              </span>
            </>
          )}
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* ── Next fortnight, day by day ─────────────────────────── */}
        <div>
          <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-2">
            Next {dayCount} days · hours available
          </h4>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse">
              <thead>
                <tr>
                  <th className="w-24 border-b border-line bg-surface-subtle px-2 py-1.5 text-left text-[10px] font-medium uppercase tracking-wide text-ink-3">
                    Band
                  </th>
                  {days.map((d) => (
                    <th
                      key={d.iso}
                      className={`border-b border-line px-1 py-1.5 text-center text-[10px] font-medium ${
                        d.isWeekend
                          ? 'bg-surface-subtle/50 text-ink-3/60'
                          : 'bg-surface-subtle text-ink-3'
                      } ${d.isToday ? 'text-brand' : ''}`}
                    >
                      {d.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {supply.rows.map((r) => (
                  <tr key={r.band} className="border-b border-line last:border-b-0">
                    <td className="px-2 py-1 text-xs text-ink-2">
                      {r.band}
                      <span className="ml-1 text-[10px] text-ink-3">
                        ·{r.headcount}
                      </span>
                    </td>
                    {r.days.slice(0, dayCount).map((t, i) => (
                      <td
                        key={days[i]!.iso}
                        className={`px-1 py-1 text-center ${
                          days[i]!.isWeekend ? 'bg-surface-subtle/30' : ''
                        } ${days[i]!.isToday ? 'bg-brand-soft/25' : ''}`}
                      >
                        {hoursCell(t, days[i]!.isWeekend)}
                      </td>
                    ))}
                  </tr>
                ))}
                <tr className="border-t border-line bg-surface-subtle/40">
                  <td className="px-2 py-1 text-[11px] font-semibold text-ink">
                    All bands
                  </td>
                  {supply.totals.days.slice(0, dayCount).map((t, i) => (
                    <td key={days[i]!.iso} className="px-1 py-1 text-center">
                      <span className="text-xs font-semibold tabular-nums text-ink">
                        {t.availableHours > 0 ? t.availableHours : '—'}
                      </span>
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* ── Whole horizon, week by week ────────────────────────── */}
        <div>
          <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-2">
            Next {weeksAhead} weeks · hours available
          </h4>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] border-collapse">
              <thead>
                <tr>
                  <th className="w-24 border-b border-line bg-surface-subtle px-2 py-1.5 text-left text-[10px] font-medium uppercase tracking-wide text-ink-3">
                    Band
                  </th>
                  {supply.weeks.map((w) => (
                    <th
                      key={w.weekStartIso}
                      className="border-b border-line bg-surface-subtle px-1 py-1.5 text-center text-[10px] font-medium uppercase tracking-wide text-ink-3"
                    >
                      {w.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {supply.rows.map((r) => (
                  <tr key={r.band} className="border-b border-line last:border-b-0">
                    <td className="px-2 py-1 text-xs text-ink-2">
                      {r.band}
                      {r.silentCount > 0 && (
                        <span
                          className="ml-1 text-[10px] text-status-amber"
                          title={`${r.silentCount} with no forecast and no standing schedule`}
                        >
                          {r.silentCount} silent
                        </span>
                      )}
                    </td>
                    {r.weeks.map((t, i) => (
                      <td key={supply.weeks[i]!.weekStartIso} className="px-1 py-1 text-center">
                        {hoursCell(t, false)}
                      </td>
                    ))}
                  </tr>
                ))}
                <tr className="border-t border-line bg-surface-subtle/40">
                  <td className="px-2 py-1 text-[11px] font-semibold text-ink">
                    All bands
                  </td>
                  {supply.totals.weeks.map((t, i) => (
                    <td
                      key={supply.weeks[i]!.weekStartIso}
                      className="px-1 py-1 text-center text-xs font-semibold tabular-nums text-ink"
                    >
                      {t.availableHours > 0 ? t.availableHours : '—'}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
