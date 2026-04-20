import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSession } from '@/server/session';
import { hasAnyRole } from '@/server/roles';
import { listPendingTimesheetEntriesForApprover } from '@/server/timesheet';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { ApproveTimesheetForm } from './form';

export default async function TimesheetApprovePage() {
  const session = await getSession();
  if (!session || !hasAnyRole(session, ['super_admin', 'admin', 'manager'])) notFound();

  const entries = await listPendingTimesheetEntriesForApprover(session);

  // Group by person → week bucket.
  type Key = string;
  const groups = new Map<
    Key,
    {
      personId: string;
      personName: string;
      initials: string;
      weekStart: Date;
      entries: typeof entries;
      totalHours: number;
    }
  >();
  for (const e of entries) {
    const weekStart = startOfWeek(e.date);
    const key = `${e.personId}|${weekStart.toISOString()}`;
    if (!groups.has(key)) {
      groups.set(key, {
        personId: e.personId,
        personName: `${e.person.firstName} ${e.person.lastName}`,
        initials: e.person.initials,
        weekStart,
        entries: [],
        totalHours: 0,
      });
    }
    const g = groups.get(key)!;
    g.entries.push(e);
    g.totalHours += Number(e.hours);
  }

  const sorted = Array.from(groups.values()).sort(
    (a, b) => a.weekStart.getTime() - b.weekStart.getTime(),
  );

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-ink">Timesheet approvals</h1>
          <p className="text-sm text-ink-3">
            {entries.length} submitted {entries.length === 1 ? 'entry' : 'entries'} awaiting your
            decision.
          </p>
        </div>
        <Link href="/timesheet" className="text-sm text-ink-3 hover:text-ink">
          ← Back to my timesheet
        </Link>
      </header>

      {sorted.length === 0 ? (
        <Card>
          <div className="p-12 text-center text-sm text-ink-3">
            Nothing to approve. Submitted timesheet entries land here when team members hit
            Submit.
          </div>
        </Card>
      ) : (
        <div className="space-y-4">
          {sorted.map((group) => {
            const weekLabel = `${group.weekStart.toLocaleDateString('en-AU')} – ${new Date(
              group.weekStart.getTime() + 6 * 24 * 3600 * 1000,
            ).toLocaleDateString('en-AU')}`;
            return (
              <Card key={`${group.personId}|${group.weekStart.toISOString()}`} className="p-4">
                <div className="mb-3 flex items-center gap-2">
                  <Avatar className="h-7 w-7">
                    <AvatarFallback className="text-[10px]">{group.initials}</AvatarFallback>
                  </Avatar>
                  <div className="font-medium text-ink">{group.personName}</div>
                  <span className="text-sm text-ink-3">· week of {weekLabel}</span>
                  <Badge variant="amber" className="ml-auto">
                    {group.totalHours.toFixed(1)}h total
                  </Badge>
                </div>

                <ApproveTimesheetForm
                  entries={group.entries.map((e) => ({
                    id: e.id,
                    date: e.date.toLocaleDateString('en-AU'),
                    hours: Number(e.hours),
                    description: e.description ?? '',
                    projectCode: e.project.code,
                    projectName: e.project.name,
                  }))}
                />
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

function startOfWeek(date: Date): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dow = d.getUTCDay();
  const offset = dow === 0 ? -6 : 1 - dow;
  d.setUTCDate(d.getUTCDate() + offset);
  return d;
}
