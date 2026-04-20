import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSession } from '@/server/session';
import { hasCapability } from '@/server/capabilities';
import { hasAnyRole } from '@/server/roles';
import { getWeekForPerson } from '@/server/timesheet';
import { prisma } from '@/server/db';
import {
  addDays,
  formatIsoDate,
  parseIsoDate,
  startOfWeek,
  weekDates as weekDatesFn,
} from '@/lib/week';
import { Button } from '@/components/ui/button';
import { TimesheetGrid } from './grid';

export default async function TimesheetPage({
  searchParams,
}: {
  searchParams: { week?: string };
}) {
  const session = await getSession();
  if (!session || !hasCapability(session, 'timesheet.submit')) notFound();

  const weekStart = startOfWeek(parseIsoDate(searchParams.week));
  const weekEnd = addDays(weekStart, 6);
  const weekDates = weekDatesFn(weekStart);
  const prevWeek = formatIsoDate(addDays(weekStart, -7));
  const nextWeek = formatIsoDate(addDays(weekStart, 7));

  const rows = await getWeekForPerson(session.person.id, weekStart);
  // Any active project — staff can self-log against any (common at Foundry; team
  // membership may lag behind real work).
  const allProjects = await prisma.project.findMany({
    where: { stage: { not: 'archived' } },
    orderBy: { code: 'asc' },
    select: { id: true, code: true, name: true },
  });

  const canApprove = hasAnyRole(session, ['super_admin', 'admin', 'manager']);

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-ink">Timesheet</h1>
          <p className="text-sm text-ink-3">
            Week of {weekStart.toLocaleDateString('en-AU')} – {weekEnd.toLocaleDateString('en-AU')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href={`/timesheet?week=${prevWeek}`}>← Previous</Link>
          </Button>
          <Button asChild variant="ghost" size="sm">
            <Link href="/timesheet">This week</Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href={`/timesheet?week=${nextWeek}`}>Next →</Link>
          </Button>
          {canApprove && (
            <Button asChild variant="outline" size="sm">
              <Link href="/timesheet/approve">Approve queue</Link>
            </Button>
          )}
        </div>
      </header>

      {allProjects.length === 0 ? (
        <div className="rounded-lg border border-dashed border-line bg-card p-10 text-center">
          <h2 className="text-sm font-medium text-ink">No active projects yet</h2>
          <p className="mt-2 text-sm text-ink-3">
            There&apos;s nothing to log time against. Ask a partner or admin to create a project
            first.
          </p>
          {hasAnyRole(session, ['super_admin', 'admin', 'partner']) && (
            <Button asChild size="sm" className="mt-4">
              <Link href="/projects/new">Create project</Link>
            </Button>
          )}
        </div>
      ) : (
        <TimesheetGrid
          weekStart={formatIsoDate(weekStart)}
          initialRows={rows}
          weekDates={weekDates}
          allProjects={allProjects}
        />
      )}
    </div>
  );
}
