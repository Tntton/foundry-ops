import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { PersonTimesheetEntry } from '@/server/timesheet';

const STATUS_VARIANT: Record<
  PersonTimesheetEntry['status'],
  'outline' | 'amber' | 'green' | 'blue'
> = {
  draft: 'outline',
  submitted: 'amber',
  approved: 'green',
  billed: 'blue',
};

function startOfWeekUTC(date: Date): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dow = d.getUTCDay();
  const offset = dow === 0 ? -6 : 1 - dow;
  d.setUTCDate(d.getUTCDate() + offset);
  return d;
}

/**
 * Submitted-and-decided overview for the timesheet page. Lives below the
 * entry grid so the user can see, in one place: what they're still editing
 * (the grid above) AND the running record of every entry that's left their
 * draft state — submitted but not yet decided, approved, or billed.
 */
export function TimesheetSubmittedOverview({
  entries,
  csvHref,
}: {
  entries: PersonTimesheetEntry[];
  csvHref: string;
}) {
  // Counts + hours per status — high-level glance.
  const totals = { submitted: 0, approved: 0, billed: 0 };
  const hours = { submitted: 0, approved: 0, billed: 0 };
  for (const e of entries) {
    if (e.status === 'draft') continue;
    totals[e.status] += 1;
    hours[e.status] += e.hours;
  }

  // Bucket by (week × project × status) for the rolled summary.
  type Bucket = {
    weekStart: Date;
    projectId: string;
    projectCode: string;
    projectName: string;
    submittedHours: number;
    approvedHours: number;
    billedHours: number;
    submittedAt: Date | null; // earliest submission for this bucket
    decidedAt: Date | null; // latest approvedAt for this bucket (if any)
  };
  const bucketMap = new Map<string, Bucket>();
  for (const e of entries) {
    if (e.status === 'draft') continue;
    const ws = startOfWeekUTC(e.date);
    const key = `${ws.toISOString()}|${e.project.id}`;
    const cur =
      bucketMap.get(key) ??
      ({
        weekStart: ws,
        projectId: e.project.id,
        projectCode: e.project.code,
        projectName: e.project.name,
        submittedHours: 0,
        approvedHours: 0,
        billedHours: 0,
        submittedAt: null,
        decidedAt: null,
      } satisfies Bucket);
    if (e.status === 'submitted') cur.submittedHours += e.hours;
    if (e.status === 'approved') cur.approvedHours += e.hours;
    if (e.status === 'billed') cur.billedHours += e.hours;
    if (e.approvedAt) {
      cur.decidedAt =
        cur.decidedAt && cur.decidedAt > e.approvedAt ? cur.decidedAt : e.approvedAt;
    }
    bucketMap.set(key, cur);
  }
  const buckets = Array.from(bucketMap.values()).sort(
    (a, b) =>
      b.weekStart.getTime() - a.weekStart.getTime() ||
      a.projectCode.localeCompare(b.projectCode),
  );

  if (buckets.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Submitted history</CardTitle>
        </CardHeader>
        <CardContent className="py-6 text-center text-sm text-ink-3">
          Nothing submitted yet. Once you hit Submit on a draft, it shows up here with
          its current status — submitted → approved → billed.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div>
          <CardTitle>Submitted history</CardTitle>
          <p className="mt-0.5 text-xs text-ink-3">
            Every entry that&apos;s left draft state. Tracks the lifecycle —
            submitted → approved (lands in project P&amp;L) → billed (linked to
            invoice).
          </p>
        </div>
        <Link href={csvHref} className="text-xs text-brand hover:underline">
          Download CSV →
        </Link>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-3 gap-3 text-sm">
          <Stat
            label="Awaiting approval"
            value={`${hours.submitted.toFixed(1)}h`}
            sub={`${totals.submitted} ${totals.submitted === 1 ? 'entry' : 'entries'}`}
            tone="amber"
          />
          <Stat
            label="Approved"
            value={`${hours.approved.toFixed(1)}h`}
            sub={`${totals.approved} ${totals.approved === 1 ? 'entry' : 'entries'} · in P&L`}
            tone="green"
          />
          <Stat
            label="Billed"
            value={`${hours.billed.toFixed(1)}h`}
            sub={`${totals.billed} ${totals.billed === 1 ? 'entry' : 'entries'} · on invoice`}
            tone="blue"
          />
        </div>

        <div className="-mx-5">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Week of</TableHead>
                <TableHead>Project</TableHead>
                <TableHead className="text-right">Submitted</TableHead>
                <TableHead className="text-right">Approved</TableHead>
                <TableHead className="text-right">Billed</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Decided</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {buckets.map((b, i) => {
                const prev = i > 0 ? buckets[i - 1] : null;
                const showWeek =
                  !prev || prev.weekStart.getTime() !== b.weekStart.getTime();
                const dominant: PersonTimesheetEntry['status'] =
                  b.billedHours > 0
                    ? 'billed'
                    : b.approvedHours > 0
                      ? 'approved'
                      : 'submitted';
                return (
                  <TableRow key={`${b.weekStart.toISOString()}|${b.projectId}`}>
                    <TableCell className="text-xs tabular-nums text-ink-3">
                      {showWeek
                        ? b.weekStart.toLocaleDateString('en-AU', {
                            day: 'numeric',
                            month: 'short',
                          })
                        : ''}
                    </TableCell>
                    <TableCell>
                      <Link
                        href={`/projects/${b.projectCode}`}
                        className="font-mono text-xs hover:underline"
                      >
                        {b.projectCode}
                      </Link>
                      <span className="ml-2 text-xs text-ink-3">{b.projectName}</span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-status-amber">
                      {b.submittedHours > 0 ? b.submittedHours.toFixed(1) : '—'}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-status-green">
                      {b.approvedHours > 0 ? b.approvedHours.toFixed(1) : '—'}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-ink-2">
                      {b.billedHours > 0 ? b.billedHours.toFixed(1) : '—'}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={STATUS_VARIANT[dominant]}
                        className="text-[10px] uppercase tracking-wide"
                      >
                        {dominant}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs tabular-nums text-ink-3">
                      {b.decidedAt
                        ? b.decidedAt.toLocaleDateString('en-AU')
                        : '—'}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub: string;
  tone: 'amber' | 'green' | 'blue';
}) {
  const cls =
    tone === 'amber'
      ? 'text-status-amber'
      : tone === 'green'
        ? 'text-status-green'
        : 'text-ink';
  return (
    <div className="rounded-md border border-line bg-surface-subtle/40 px-3 py-2">
      <div className="text-[10px] font-medium uppercase tracking-wide text-ink-3">
        {label}
      </div>
      <div className={`text-lg font-semibold tabular-nums ${cls}`}>{value}</div>
      <div className="text-[11px] text-ink-3">{sub}</div>
    </div>
  );
}
