import Link from 'next/link';
import { PersonAvatar } from '@/components/person-avatar';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { ProjectTimesheetEntry } from '@/server/timesheet';

const STATUS_VARIANT: Record<
  ProjectTimesheetEntry['status'],
  'outline' | 'amber' | 'green' | 'blue'
> = {
  draft: 'outline',
  submitted: 'amber',
  approved: 'green',
  billed: 'blue',
};

function formatMoney(cents: number): string {
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

export function ProjectHoursPanel({
  projectCode,
  entries,
  canSeePnL,
}: {
  projectCode: string;
  entries: ProjectTimesheetEntry[];
  canSeePnL: boolean;
}) {
  if (entries.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-ink-3">
          No timesheet entries yet. Time logged on this project will land here as
          team members submit each week.
        </CardContent>
      </Card>
    );
  }

  // Group by person → status totals
  type PersonRoll = {
    personId: string;
    initials: string;
    firstName: string;
    lastName: string;
    submittedHours: number;
    approvedHours: number;
    billedHours: number;
    draftHours: number;
    costCents: number;
    headshotUrl: string | null;
  };
  const byPerson = new Map<string, PersonRoll>();
  let totalHours = 0;
  let totalCost = 0;
  const totals = { draft: 0, submitted: 0, approved: 0, billed: 0 };

  for (const e of entries) {
    totalHours += e.hours;
    totalCost += e.costCents;
    totals[e.status] += e.hours;
    const cur =
      byPerson.get(e.person.id) ??
      ({
        personId: e.person.id,
        initials: e.person.initials,
        firstName: e.person.firstName,
        lastName: e.person.lastName,
        submittedHours: 0,
        approvedHours: 0,
        billedHours: 0,
        draftHours: 0,
        costCents: 0,
        headshotUrl: e.person.headshotUrl,
      } satisfies PersonRoll);
    cur.costCents += e.costCents;
    if (e.status === 'draft') cur.draftHours += e.hours;
    if (e.status === 'submitted') cur.submittedHours += e.hours;
    if (e.status === 'approved') cur.approvedHours += e.hours;
    if (e.status === 'billed') cur.billedHours += e.hours;
    byPerson.set(e.person.id, cur);
  }
  const personRolls = Array.from(byPerson.values()).sort(
    (a, b) =>
      b.approvedHours +
      b.billedHours -
      (a.approvedHours + a.billedHours),
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <SummaryCard label="Total" value={`${totalHours.toFixed(1)}h`} />
        <SummaryCard
          label="Approved + billed cost"
          value={canSeePnL ? formatMoney(totalCost) : '—'}
          sub={canSeePnL ? 'at logger cost rate' : 'P&L hidden'}
        />
        <SummaryCard
          label="Draft / submitted"
          value={`${(totals.draft + totals.submitted).toFixed(1)}h`}
          sub="Not yet in P&L"
        />
        <SummaryCard label="Approved" value={`${totals.approved.toFixed(1)}h`} sub="In P&L" />
        <SummaryCard
          label="Billed"
          value={`${totals.billed.toFixed(1)}h`}
          sub="Linked to invoice"
        />
      </div>

      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-ink">By person</h3>
        <Link
          href={`/api/reports/timesheet?projectCode=${encodeURIComponent(projectCode)}`}
          className="text-xs text-brand hover:underline"
        >
          Download CSV →
        </Link>
      </div>

      <Card className="p-0">
        <table className="w-full text-sm">
          <thead className="bg-surface-subtle text-ink-3">
            <tr className="border-b border-line">
              <th className="px-3 py-2 text-left">Person</th>
              <th className="px-3 py-2 text-right">Draft</th>
              <th className="px-3 py-2 text-right">Submitted</th>
              <th className="px-3 py-2 text-right">Approved</th>
              <th className="px-3 py-2 text-right">Billed</th>
              <th className="px-3 py-2 text-right">Total</th>
              {canSeePnL && (
                <th className="px-3 py-2 text-right">Cost (appr+billed)</th>
              )}
            </tr>
          </thead>
          <tbody>
            {personRolls.map((r) => {
              const total =
                r.draftHours + r.submittedHours + r.approvedHours + r.billedHours;
              return (
                <tr key={r.personId} className="border-b border-line last:border-b-0">
                  <td className="px-3 py-2">
                    <Link
                      href={`/directory/people/${r.personId}`}
                      className="flex items-center gap-2 hover:underline"
                    >
                      <PersonAvatar
  className="h-6 w-6"
  fallbackClassName="text-[10px]"
  initials={r.initials}
  headshotUrl={r.headshotUrl}
/>
                      <span className="text-ink">
                        {r.firstName} {r.lastName}
                      </span>
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-ink-3">
                    {r.draftHours > 0 ? r.draftHours.toFixed(1) : '—'}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-status-amber">
                    {r.submittedHours > 0 ? r.submittedHours.toFixed(1) : '—'}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-status-green">
                    {r.approvedHours > 0 ? r.approvedHours.toFixed(1) : '—'}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-ink-2">
                    {r.billedHours > 0 ? r.billedHours.toFixed(1) : '—'}
                  </td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums text-ink">
                    {total.toFixed(1)}
                  </td>
                  {canSeePnL && (
                    <td className="px-3 py-2 text-right tabular-nums text-ink">
                      {formatMoney(r.costCents)}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Detail (most recent first)</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="bg-surface-subtle text-ink-3">
              <tr className="border-b border-line">
                <th className="px-3 py-2 text-left">Date</th>
                <th className="px-3 py-2 text-left">Person</th>
                <th className="px-3 py-2 text-right">Hours</th>
                <th className="px-3 py-2 text-left">Description</th>
                <th className="px-3 py-2 text-left">Status</th>
                {canSeePnL && <th className="px-3 py-2 text-right">Cost</th>}
              </tr>
            </thead>
            <tbody>
              {entries.slice(0, 100).map((e) => (
                <tr key={e.id} className="border-b border-line last:border-b-0">
                  <td className="px-3 py-2 text-xs tabular-nums text-ink-3">
                    {e.date.toLocaleDateString('en-AU')}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    <span className="text-ink-2">
                      {e.person.firstName} {e.person.lastName}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-ink">
                    {e.hours.toFixed(2)}
                  </td>
                  <td className="px-3 py-2 text-xs text-ink-3">
                    {e.description ?? <span className="text-ink-4">—</span>}
                  </td>
                  <td className="px-3 py-2">
                    <Badge variant={STATUS_VARIANT[e.status]} className="text-[10px]">
                      {e.status}
                    </Badge>
                  </td>
                  {canSeePnL && (
                    <td className="px-3 py-2 text-right text-xs tabular-nums text-ink-3">
                      {(e.status === 'approved' || e.status === 'billed')
                        ? formatMoney(e.costCents)
                        : '—'}
                    </td>
                  )}
                </tr>
              ))}
              {entries.length > 100 && (
                <tr>
                  <td
                    colSpan={canSeePnL ? 6 : 5}
                    className="p-3 text-center text-xs text-ink-4"
                  >
                    Showing newest 100 — download CSV for the full set ({entries.length}{' '}
                    rows).
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <Card>
      <CardHeader className="pb-1">
        <CardTitle className="text-xs font-medium uppercase tracking-wide text-ink-3">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-lg font-semibold tabular-nums text-ink">{value}</div>
        {sub && <div className="text-[11px] text-ink-3">{sub}</div>}
      </CardContent>
    </Card>
  );
}
