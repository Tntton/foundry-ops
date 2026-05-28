import Link from 'next/link';
import type { AvailabilityWeek } from '@/server/timesheet';

/**
 * Read-only schedule overlay — shows each week's scheduled hours
 * (project allocation × 38h baseline) vs what's already booked on the
 * timesheet. Lives below the editable AvailabilityEditor so the staff
 * member can sanity-check what's already planned for them before
 * declaring their forecast.
 */
export function ScheduleTable({
  weeks,
  targetFirstName,
}: {
  weeks: AvailabilityWeek[];
  targetFirstName: string;
}) {
  const projectsRow: Array<{ id: string; code: string; name: string }> = [];
  const seen = new Set<string>();
  for (const w of weeks) {
    for (const p of w.byProject) {
      if (!seen.has(p.projectId)) {
        seen.add(p.projectId);
        projectsRow.push({ id: p.projectId, code: p.projectCode, name: p.projectName });
      }
    }
  }
  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-base font-semibold text-ink">
          Project schedule · {targetFirstName}
        </h2>
        <p className="text-xs text-ink-3">
          Scheduled = project team allocation × 38h baseline. Booked is
          what&apos;s already on the timesheet for that week. Use this as
          a sanity check when declaring availability above.
        </p>
      </div>
      {projectsRow.length === 0 ? (
        <div className="rounded-lg border border-dashed border-line bg-card p-8 text-center text-sm text-ink-3">
          No active project allocations. Get added to a project team to
          populate the schedule.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line bg-card">
          <table className="w-full text-sm">
            <thead className="bg-surface-subtle text-ink-3">
              <tr className="border-b border-line">
                <th className="sticky left-0 z-10 min-w-[220px] bg-surface-subtle px-3 py-2 text-left text-[10px] uppercase tracking-wide">
                  Project
                </th>
                {weeks.map((w) => (
                  <th
                    key={w.weekStart.toISOString()}
                    className="min-w-[80px] px-2 py-2 text-center text-[10px] font-medium uppercase tracking-wide"
                  >
                    {w.weekStart.toLocaleDateString('en-AU', {
                      day: 'numeric',
                      month: 'short',
                    })}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {projectsRow.map((p) => (
                <tr key={p.id} className="border-b border-line last:border-b-0">
                  <td className="sticky left-0 z-10 bg-card px-3 py-2">
                    <Link
                      href={`/projects/${p.code}`}
                      className="font-mono text-xs text-ink hover:underline"
                    >
                      {p.code}
                    </Link>
                    <div className="text-xs text-ink-3">{p.name}</div>
                  </td>
                  {weeks.map((w) => {
                    const cell = w.byProject.find((c) => c.projectId === p.id);
                    if (!cell || cell.scheduledHours === 0)
                      return (
                        <td
                          key={w.weekStart.toISOString()}
                          className="px-2 py-2 text-center text-[11px] text-ink-4"
                        >
                          —
                        </td>
                      );
                    const ratio = cell.bookedHours / Math.max(1, cell.scheduledHours);
                    const tone =
                      cell.bookedHours === 0
                        ? 'text-ink-3'
                        : ratio < 0.5
                          ? 'text-status-amber'
                          : ratio > 1
                            ? 'text-status-red'
                            : 'text-status-green';
                    return (
                      <td
                        key={w.weekStart.toISOString()}
                        className="px-2 py-2 text-center text-[11px] tabular-nums"
                      >
                        <div className={tone}>
                          {cell.bookedHours.toFixed(0)} / {cell.scheduledHours}h
                        </div>
                        <div className="text-[9px] text-ink-3">
                          {cell.allocationPct}% alloc
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
              <tr className="bg-brand text-brand-ink">
                <td className="sticky left-0 z-10 bg-brand px-3 py-2 text-left text-[10px] font-mono uppercase tracking-wide">
                  Weekly total
                </td>
                {weeks.map((w) => (
                  <td
                    key={w.weekStart.toISOString()}
                    className="px-2 py-2 text-center text-xs font-semibold tabular-nums"
                  >
                    {w.bookedHours.toFixed(0)} / {w.scheduledHours}h
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
