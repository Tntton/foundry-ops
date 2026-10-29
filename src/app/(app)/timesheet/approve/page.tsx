import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSession } from '@/server/session';
import { hasAnyRole } from '@/server/roles';
import {
  listPendingMonthCards,
  listRecentDecidedEntriesForApprover,
  toDisplayStatus,
} from '@/server/timesheet';
import { prisma } from '@/server/db';
import { PersonAvatar } from '@/components/person-avatar';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ApproveMonthCard } from './month-card';
import { ApproveAllPendingButton } from './approve-all-button';

export default async function TimesheetApprovePage({
  searchParams,
}: {
  searchParams: { tab?: string };
}) {
  const session = await getSession();
  if (!session || !hasAnyRole(session, ['super_admin', 'admin', 'manager'])) notFound();

  const [monthCards, recentDecided] = await Promise.all([
    listPendingMonthCards(session),
    listRecentDecidedEntriesForApprover(session, 30),
  ]);

  // Resolve the names of the leads who owe the decisions this viewer can't
  // make, so a partial month says "with Michael" rather than an opaque id.
  const owedIds = Array.from(
    new Set(
      monthCards.flatMap((c) =>
        c.projects.map((p) => p.owedByPersonId).filter((id): id is string => id !== null),
      ),
    ),
  );
  const owedNames = new Map<string, string>();
  if (owedIds.length > 0) {
    const people = await prisma.person.findMany({
      where: { id: { in: owedIds } },
      select: { id: true, firstName: true, lastName: true },
    });
    for (const p of people) owedNames.set(p.id, `${p.firstName} ${p.lastName}`);
  }

  const decidableEntryIds = monthCards.flatMap((c) => c.decidableEntryIds);
  const totalPendingHours = monthCards.reduce((s, c) => s + c.decidableHours, 0);

  // Group history by week of decision for a tidy timeline.
  const historyByWeek = new Map<
    string,
    { weekStart: Date; entries: typeof recentDecided; totalHours: number }
  >();
  for (const e of recentDecided) {
    if (!e.approvedAt) continue;
    const weekStart = startOfWeek(e.approvedAt);
    const key = weekStart.toISOString();
    if (!historyByWeek.has(key)) {
      historyByWeek.set(key, { weekStart, entries: [], totalHours: 0 });
    }
    const g = historyByWeek.get(key)!;
    g.entries.push(e);
    g.totalHours += Number(e.hours);
  }
  const sortedHistory = Array.from(historyByWeek.values()).sort(
    (a, b) => b.weekStart.getTime() - a.weekStart.getTime(),
  );

  const totalDecidedHours = sortedHistory.reduce((s, g) => s + g.totalHours, 0);
  const initialTab = searchParams.tab === 'history' ? 'history' : 'queue';

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-ink">Timesheet approvals</h1>
          <p className="text-sm text-ink-3">
            {monthCards.length} person-{monthCards.length === 1 ? 'month' : 'months'} pending ·{' '}
            {recentDecided.length} decided in last 30 days. Approved entries flow into project
            P&amp;L, contractor draft bills, and the directory profile. A month closes — and any
            contractor invoice is raised — only once every project in it is approved.
          </p>
        </div>
        <div className="flex items-center gap-3 text-sm">
          {/* Top-of-queue "Approve all" — only renders when there's
              actual pending work. Guarded by a native confirm()
              dialog (see ApproveAllPendingButton) so a rage-click
              can't bulk-approve in a blink. */}
          {decidableEntryIds.length > 0 && (
            <ApproveAllPendingButton
              entryIds={decidableEntryIds}
              totalHours={totalPendingHours}
              monthCount={monthCards.length}
              peopleCount={new Set(monthCards.map((c) => c.personId)).size}
            />
          )}
          <Link
            href="/api/reports/timesheet?status=approved"
            className="text-ink-3 hover:text-ink"
          >
            Download CSV
          </Link>
          <Link href="/timesheet" className="text-ink-3 hover:text-ink">
            ← Back to my timesheet
          </Link>
        </div>
      </header>

      <Tabs defaultValue={initialTab}>
        <TabsList>
          <TabsTrigger value="queue">
            Pending ({monthCards.length} · {totalPendingHours.toFixed(1)}h)
          </TabsTrigger>
          <TabsTrigger value="history">
            Recent decisions ({recentDecided.length} · {totalDecidedHours.toFixed(1)}h)
          </TabsTrigger>
        </TabsList>

        <TabsContent value="queue">
          {monthCards.length === 0 ? (
            <Card>
              <div className="p-12 text-center text-sm text-ink-3">
                Nothing to approve. A person&apos;s month lands here when they lodge it from
                their timesheet — or entry by entry if they submit week to week.
              </div>
            </Card>
          ) : (
            <div className="space-y-4">
              {monthCards.map((card) => (
                <ApproveMonthCard
                  key={`${card.personId}|${card.year}-${card.month}`}
                  personName={card.personName}
                  initials={card.initials}
                  headshotUrl={card.headshotUrl}
                  monthLabel={card.monthLabel}
                  periodState={card.periodState}
                  totalHours={card.totalHours}
                  decidableHours={card.decidableHours}
                  decidableEntryIds={card.decidableEntryIds}
                  projects={card.projects.map((p) => ({
                    projectId: p.projectId,
                    projectCode: p.projectCode,
                    projectName: p.projectName,
                    hours: p.hours,
                    entryIds: p.entryIds,
                    canDecide: p.canDecide,
                    owedByName: p.owedByPersonId
                      ? (owedNames.get(p.owedByPersonId) ?? null)
                      : null,
                  }))}
                  entries={card.entries.map((e) => ({
                    id: e.id,
                    date: e.date.toLocaleDateString('en-AU'),
                    hours: e.hours,
                    description: e.description,
                    projectCode: e.projectCode,
                    canDecide: e.canDecide,
                  }))}
                />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="history">
          {sortedHistory.length === 0 ? (
            <Card>
              <div className="p-12 text-center text-sm text-ink-3">
                No decisions in the last 30 days. After you approve, entries appear here as a
                running record. Approved hours immediately flow into project P&amp;L; rolled-back
                entries return to the submitter as drafts.
              </div>
            </Card>
          ) : (
            <div className="space-y-4">
              {sortedHistory.map((g) => {
                const weekLabel = g.weekStart.toLocaleDateString('en-AU', {
                  day: 'numeric',
                  month: 'short',
                });
                return (
                  <Card key={g.weekStart.toISOString()} className="p-4">
                    <div className="mb-3 flex items-center justify-between">
                      <div className="text-sm font-medium text-ink">
                        Decided week of {weekLabel}
                      </div>
                      <Badge variant="green">{g.totalHours.toFixed(1)}h approved</Badge>
                    </div>
                    <ul className="divide-y divide-line text-sm">
                      {g.entries.map((e) => (
                        <li
                          key={e.id}
                          className="grid grid-cols-[120px_220px_60px_1fr_auto] items-center gap-2 py-1"
                        >
                          <span className="text-xs text-ink-3 tabular-nums">
                            {e.date.toLocaleDateString('en-AU')}
                          </span>
                          <span className="flex items-center gap-1 text-xs">
                            <PersonAvatar
  className="h-4 w-4"
  fallbackClassName="text-[9px]"
  initials={e.person.initials}
  headshotUrl={e.person.headshotUrl}
/>
                            <span className="text-ink-2">
                              {e.person.firstName} {e.person.lastName}
                            </span>
                          </span>
                          <span className="text-right text-xs tabular-nums text-ink">
                            {Number(e.hours).toFixed(2)}h
                          </span>
                          <span className="truncate text-xs text-ink-3">
                            <span className="font-mono text-ink-4">{e.project.code}</span>{' '}
                            {e.description ?? ''}
                          </span>
                          <Badge
                            variant={toDisplayStatus(e) === 'billed' ? 'blue' : 'green'}
                            className="text-[10px]"
                          >
                            {toDisplayStatus(e)}
                          </Badge>
                        </li>
                      ))}
                    </ul>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>
      </Tabs>
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
