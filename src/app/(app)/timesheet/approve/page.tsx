import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSession } from '@/server/session';
import { hasAnyRole } from '@/server/roles';
import {
  listPendingTimesheetEntriesForApprover,
  listRecentDecidedEntriesForApprover,
} from '@/server/timesheet';
import { prisma } from '@/server/db';
import { PersonAvatar } from '@/components/person-avatar';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ApproveTimesheetForm } from './form';
import { ApproveAllPendingButton } from './approve-all-button';

export default async function TimesheetApprovePage({
  searchParams,
}: {
  searchParams: { tab?: string };
}) {
  const session = await getSession();
  if (!session || !hasAnyRole(session, ['super_admin', 'admin', 'manager'])) notFound();

  const [pending, recentDecided] = await Promise.all([
    listPendingTimesheetEntriesForApprover(session),
    listRecentDecidedEntriesForApprover(session, 30),
  ]);

  // Group pending by person → week bucket.
  type PendingGroup = {
    personId: string;
    personName: string;
    initials: string;
    headshotUrl: string | null;
    weekStart: Date;
    entries: typeof pending;
    totalHours: number;
    submittedByInitials: string | null; // when ≠ target person — i.e. SU on behalf
    submittedByName: string | null;
  };
  const pendingGroups = new Map<string, PendingGroup>();
  for (const e of pending) {
    const weekStart = startOfWeek(e.date);
    const key = `${e.personId}|${weekStart.toISOString()}`;
    if (!pendingGroups.has(key)) {
      pendingGroups.set(key, {
        personId: e.personId,
        personName: `${e.person.firstName} ${e.person.lastName}`,
        initials: e.person.initials,
        headshotUrl: e.person.headshotUrl,
        weekStart,
        entries: [],
        totalHours: 0,
        submittedByInitials: null,
        submittedByName: null,
      });
    }
    const g = pendingGroups.get(key)!;
    g.entries.push(e);
    g.totalHours += Number(e.hours);
  }
  const sortedPending = Array.from(pendingGroups.values()).sort(
    (a, b) => a.weekStart.getTime() - b.weekStart.getTime(),
  );

  // Surface "submitted on behalf by X" on the approval card. Read the most
  // recent `submitted` audit event for each (target person × week) bucket
  // and fill in the actor when it's not the target — that's the super-admin
  // override case the auditor / approver wants to see.
  if (sortedPending.length > 0) {
    const auditRows = await prisma.auditEvent.findMany({
      where: {
        entityType: 'timesheet_range',
        action: 'submitted',
        OR: sortedPending.map((g) => ({
          entityId: {
            startsWith: `${g.personId}:${g.weekStart.toISOString().slice(0, 10)}:`,
          },
        })),
      },
      orderBy: { at: 'desc' },
      include: {
        actor: {
          select: { id: true, initials: true, headshotUrl: true, firstName: true, lastName: true },
        },
      },
    });
    for (const row of auditRows) {
      // entityId looks like `<personId>:YYYY-MM-DD:<dayCount>` — match it
      // back to the bucket and only write the marker when the actor != target.
      const [targetPersonId, weekStartIso] = row.entityId.split(':');
      if (!targetPersonId || !weekStartIso) continue;
      const bucketKey = `${targetPersonId}|${new Date(`${weekStartIso}T00:00:00.000Z`).toISOString()}`;
      const bucket = pendingGroups.get(bucketKey);
      if (!bucket) continue;
      if (bucket.submittedByInitials) continue; // newest already taken
      if (!row.actor) continue;
      if (row.actor.id === bucket.personId) continue; // self-submit, no marker
      bucket.submittedByInitials = row.actor.initials;
      bucket.submittedByName = `${row.actor.firstName} ${row.actor.lastName}`;
    }
  }

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

  const totalPendingHours = sortedPending.reduce((s, g) => s + g.totalHours, 0);
  const totalDecidedHours = sortedHistory.reduce((s, g) => s + g.totalHours, 0);
  const initialTab = searchParams.tab === 'history' ? 'history' : 'queue';

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-ink">Timesheet approvals</h1>
          <p className="text-sm text-ink-3">
            {pending.length} pending · {recentDecided.length} decided in last 30 days. Approved
            entries flow into project P&amp;L, contractor draft bills, and the directory profile.
          </p>
        </div>
        <div className="flex items-center gap-3 text-sm">
          {/* Top-of-queue "Approve all" — only renders when there's
              actual pending work. Guarded by a native confirm()
              dialog (see ApproveAllPendingButton) so a rage-click
              can't bulk-approve in a blink. */}
          {pending.length > 0 && (
            <ApproveAllPendingButton
              entryIds={pending.map((e) => e.id)}
              totalHours={totalPendingHours}
              peopleCount={sortedPending.length}
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
            Pending ({pending.length} entries · {totalPendingHours.toFixed(1)}h)
          </TabsTrigger>
          <TabsTrigger value="history">
            Recent decisions ({recentDecided.length} · {totalDecidedHours.toFixed(1)}h)
          </TabsTrigger>
        </TabsList>

        <TabsContent value="queue">
          {sortedPending.length === 0 ? (
            <Card>
              <div className="p-12 text-center text-sm text-ink-3">
                Nothing to approve. Submitted timesheet entries land here when team members hit
                Submit.
              </div>
            </Card>
          ) : (
            <div className="space-y-4">
              {sortedPending.map((group) => {
                const weekLabel = `${group.weekStart.toLocaleDateString('en-AU')} – ${new Date(
                  group.weekStart.getTime() + 6 * 24 * 3600 * 1000,
                ).toLocaleDateString('en-AU')}`;
                return (
                  <Card
                    key={`${group.personId}|${group.weekStart.toISOString()}`}
                    className="p-4"
                  >
                    <div className="mb-3 flex flex-wrap items-center gap-2">
                      <PersonAvatar
  className="h-7 w-7"
  fallbackClassName="text-[10px]"
  initials={group.initials}
  headshotUrl={group.headshotUrl}
/>
                      <div className="font-medium text-ink">{group.personName}</div>
                      <span className="text-sm text-ink-3">· week of {weekLabel}</span>
                      {group.submittedByInitials && (
                        <Badge
                          variant="outline"
                          className="text-[10px]"
                          title={`Super-admin override: ${group.submittedByName} submitted on behalf of ${group.personName}.`}
                        >
                          submitted on behalf · {group.submittedByInitials}
                        </Badge>
                      )}
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
                            variant={e.status === 'billed' ? 'blue' : 'green'}
                            className="text-[10px]"
                          >
                            {e.status}
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
