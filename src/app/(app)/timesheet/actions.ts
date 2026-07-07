'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '@/server/db';
import { getSession } from '@/server/session';
import { requireCapability } from '@/server/capabilities';
import { hasAnyRole } from '@/server/roles';
import { writeAudit, computeDelta } from '@/server/audit';
import { emitUserUpdateMany } from '@/server/user-updates';
import { addDays, parseIsoDate, startOfWeek, todayInFirmTz } from '@/lib/week';
import { revalidateScheduleSurfaces } from '@/server/revalidate-schedule';

// Snap hours to the nearest 0.5 — the granularity the timesheet grid uses.
// Users typing odd values (e.g. 0.65) get auto-rounded; legacy 0.25-step
// entries already in the DB are untouched until they're re-saved.
const halfHour = z.coerce
  .number()
  .min(0)
  .max(24)
  .transform((n) => Math.round(n * 2) / 2);

const CellSchema = z.object({
  projectId: z.string().min(1),
  description: z.string().trim().max(300).default(''),
  hours: z.array(halfHour).min(1).max(31),
});

const SaveSchema = z.object({
  rangeStart: z.string(),
  dayCount: z.coerce.number().int().min(1).max(31),
  intent: z.enum(['save', 'submit']),
  rows: z.array(CellSchema),
});

export type TimesheetSaveState =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | { status: 'success'; message: string };

export async function saveTimesheet(
  _prev: TimesheetSaveState,
  formData: FormData,
): Promise<TimesheetSaveState> {
  const session = await getSession();
  try {
    requireCapability(session, 'timesheet.submit');
  } catch {
    return { status: 'error', message: 'Not signed in' };
  }

  // Acting on behalf is allowed for:
  //   - super_admin / admin: any project, any person
  //   - manager: only their own projects (per-project gate enforced after
  //     we have the row list — see below)
  // Self-saves (targetPersonId === session.person.id) require no extra check.
  const rawTargetPersonId = String(formData.get('targetPersonId') ?? '').trim();
  const isSuperAdmin = hasAnyRole(session, ['super_admin']);
  const isAdminGroup = hasAnyRole(session, ['super_admin', 'admin']);
  const isManagerRole = hasAnyRole(session, ['manager']);
  const canActAsLead = isAdminGroup || isManagerRole;
  const targetPersonId =
    rawTargetPersonId && rawTargetPersonId !== session.person.id
      ? rawTargetPersonId
      : session.person.id;
  const actingOnBehalf = targetPersonId !== session.person.id;
  if (actingOnBehalf && !canActAsLead) {
    return {
      status: 'error',
      message:
        'Only super admins, admins, or project managers can edit another person’s timesheet.',
    };
  }

  // Inactive (soft-paused) gate — refuses any saves until the profile
  // is reactivated. Self-saves, on-behalf saves, project-manager saves
  // are all blocked uniformly.
  const targetState = await prisma.person.findUnique({
    where: { id: targetPersonId },
    select: { inactiveAt: true, endDate: true },
  });
  if (!targetState) {
    return { status: 'error', message: 'Person not found' };
  }
  if (targetState.endDate !== null) {
    return { status: 'error', message: 'Person is no longer active.' };
  }
  if (targetState.inactiveAt !== null) {
    return {
      status: 'error',
      message:
        'Profile is marked inactive — reactivate it to log timesheet entries.',
    };
  }

  const rangeStartIso = String(formData.get('rangeStart') ?? formData.get('weekStart') ?? '');
  const rangeStart = rangeStartIso
    ? parseIsoDate(rangeStartIso)
    : startOfWeek(todayInFirmTz());
  const dayCount = Math.max(
    1,
    Math.min(31, Number(formData.get('dayCount') ?? 7) || 7),
  );
  const intent = formData.get('intent') === 'submit' ? 'submit' : 'save';

  // Rows come in as repeated fields. Collect projectIds from form, then read hours per project per day.
  const projectIds = formData.getAll('projectId').map(String);
  const rows: Array<z.infer<typeof CellSchema>> = [];
  for (const pid of projectIds) {
    const description = String(formData.get(`description::${pid}`) ?? '').trim();
    const hours: number[] = [];
    for (let i = 0; i < dayCount; i += 1) {
      const raw = formData.get(`hours::${pid}::${i}`);
      hours.push(Number(raw ?? 0));
    }
    rows.push({ projectId: pid, description, hours });
  }

  const parsed = SaveSchema.safeParse({
    rangeStart: rangeStartIso || rangeStart.toISOString().slice(0, 10),
    dayCount,
    intent,
    rows,
  });
  if (!parsed.success) {
    return { status: 'error', message: 'Invalid timesheet payload' };
  }

  // Description is now optional — the `Description (optional)` label in the
  // grid matches. Anything the user types still gets persisted.

  const daily: Record<string, number> = {};
  for (const row of parsed.data.rows) {
    for (let i = 0; i < dayCount; i += 1) {
      const d = addDays(rangeStart, i).toISOString().slice(0, 10);
      daily[d] = (daily[d] ?? 0) + (row.hours[i] ?? 0);
    }
  }
  for (const [day, total] of Object.entries(daily)) {
    if (total > 24) {
      return { status: 'error', message: `Day ${day} exceeds 24h (${total}h logged).` };
    }
  }

  // Track which projects we'll need to ensure ProjectTeam membership for —
  // any project where this save lands billable hours but the person isn't yet
  // a team member should auto-add them so resource planning sees them.
  const projectsWithHours = new Set<string>();
  for (const row of parsed.data.rows) {
    if (row.hours.some((h) => h > 0)) projectsWithHours.add(row.projectId);
  }
  const projectIdsInScope = parsed.data.rows.map((r) => r.projectId);

  // Pre-fetch BEFORE the transaction so the interactive transaction window
  // is short. Earlier this code did per-cell findFirst INSIDE the
  // transaction, which made a 4-project × 28-day month-view save fire 112
  // sequential round-trips — Prisma's default 5s interactive-tx timeout
  // (P2028 "Transaction already closed") tripped on slow links / when
  // super-admins were editing on behalf of others.
  const rangeEndDate = addDays(rangeStart, dayCount);
  const [existingTeamRows, existingEntries, projectManagers] = await Promise.all([
    prisma.projectTeam.findMany({
      where: {
        personId: targetPersonId,
        projectId: { in: Array.from(projectsWithHours) },
      },
      select: { projectId: true },
    }),
    projectIdsInScope.length === 0
      ? Promise.resolve([])
      : prisma.timesheetEntry.findMany({
          where: {
            personId: targetPersonId,
            projectId: { in: projectIdsInScope },
            date: { gte: rangeStart, lt: rangeEndDate },
          },
          select: { id: true, projectId: true, date: true, status: true },
        }),
    // Project leadership lookup — needed to (a) gate non-admin on-behalf
    // saves to projects the manager actually leads, and (b) decide which
    // rows auto-approve when a leader is logging on behalf.
    projectIdsInScope.length === 0
      ? Promise.resolve([])
      : prisma.project.findMany({
          where: { id: { in: projectIdsInScope } },
          select: {
            id: true,
            code: true,
            stage: true,
            managerId: true,
            primaryPartnerId: true,
          },
        }),
  ]);

  // Build the per-project leadership index. A row auto-approves when the
  // actor (a) is acting on someone else's behalf AND (b) is super_admin /
  // admin OR is the project's own manager / primary partner.
  const projectMetaById = new Map(
    projectManagers.map((p) => [p.id, p]),
  );
  if (actingOnBehalf && !isAdminGroup) {
    // Manager case — every project in scope must be one they lead.
    const unauthorised = parsed.data.rows
      .map((r) => projectMetaById.get(r.projectId))
      .filter(
        (p): p is NonNullable<typeof p> =>
          !!p &&
          p.managerId !== session.person.id &&
          p.primaryPartnerId !== session.person.id,
      );
    if (unauthorised.length > 0) {
      const codes = Array.from(new Set(unauthorised.map((p) => p.code)));
      return {
        status: 'error',
        message: `Not authorized to log on behalf for ${codes.join(', ')} — only projects you lead.`,
      };
    }
  }
  // Auto-approve rules:
  //   - super_admin: every save skips the approval queue (own + on-behalf)
  //   - on-behalf save by admin / project's manager / project's primary
  //     partner: auto-approve those rows so the leader's edit IS the approval
  //   - everyone else: standard draft → submitted → approved flow
  //
  // Override: archived (closed) projects ALWAYS require explicit approval
  // (TT 2026-06-16) — late hours on a wrapped engagement should never
  // skip the queue, even for super-admin self-saves. The project is
  // closed; the manager needs a chance to challenge the entry.
  const autoApproveProjectIds = new Set<string>();
  const nonArchivedProjects = projectManagers.filter((p) => p.stage !== 'archived');
  if (isSuperAdmin) {
    for (const p of nonArchivedProjects) autoApproveProjectIds.add(p.id);
  } else if (actingOnBehalf) {
    for (const p of nonArchivedProjects) {
      if (
        isAdminGroup ||
        p.managerId === session.person.id ||
        p.primaryPartnerId === session.person.id
      ) {
        autoApproveProjectIds.add(p.id);
      }
    }
  }
  const autoApproveStamp = new Date();
  const autoApprovedEntryRefs: string[] = [];
  const teamProjectIds = new Set(existingTeamRows.map((r) => r.projectId));
  // Map keyed by `${projectId}|YYYY-MM-DD` so the loop below is O(1).
  const existingByKey = new Map<
    string,
    {
      id: string;
      status: 'draft' | 'submitted' | 'approved' | 'billed';
    }
  >();
  for (const e of existingEntries) {
    const dayKey = e.date.toISOString().slice(0, 10);
    existingByKey.set(`${e.projectId}|${dayKey}`, { id: e.id, status: e.status });
  }
  const autoAddedProjects: string[] = [];
  const overriddenLockedEntries: string[] = [];

  // Build the operations as an array so we can fire them as a single
  // `prisma.$transaction([...])` batch. Array-form transactions don't open
  // an interactive session — they pipeline through one round-trip and
  // release the connection immediately. That avoids both the 5s
  // interactive-tx timeout (P2028) AND the connection-pool starvation we
  // saw on Submit (the 30s session was holding the only free connection
  // while the pool was capped at 21).
  const ops: Prisma.PrismaPromise<unknown>[] = [];

  // Auto-add the person to the project team for any project with hours that
  // isn't already on their team. allocationPct=0 + a placeholder role flag
  // indicates "logged via timesheet" so resource planning can distinguish
  // from a deliberate allocation.
  for (const projectId of projectsWithHours) {
    if (teamProjectIds.has(projectId)) continue;
    ops.push(
      prisma.projectTeam.create({
        data: {
          projectId,
          personId: targetPersonId,
          roleOnProject: 'Logged via timesheet',
          allocationPct: 0,
        },
      }),
    );
    autoAddedProjects.push(projectId);
  }

  for (const row of parsed.data.rows) {
    for (let i = 0; i < dayCount; i += 1) {
      const date = addDays(rangeStart, i);
      const hours = row.hours[i] ?? 0;
      const dayKey = date.toISOString().slice(0, 10);
      const existing = existingByKey.get(`${row.projectId}|${dayKey}`);

      if (hours === 0) {
        if (
          existing &&
          (existing.status === 'draft' ||
            (isSuperAdmin && existing.status === 'submitted'))
        ) {
          ops.push(
            prisma.timesheetEntry.delete({ where: { id: existing.id } }),
          );
        } else if (existing && isSuperAdmin && existing.status !== 'billed') {
          // Super-admin clearing a non-billed approved entry — convert to a
          // 0-hour deletion so it stops counting in P&L.
          ops.push(
            prisma.timesheetEntry.delete({ where: { id: existing.id } }),
          );
          overriddenLockedEntries.push(existing.id);
        }
        // Billed entries with 0 hours are left alone — they're historical
        // record + already invoiced. Editing those needs a manual void.
        continue;
      }

      const baseStatus = intent === 'submit' ? 'submitted' : 'draft';
      const willAutoApprove = autoApproveProjectIds.has(row.projectId);
      const nextStatus = willAutoApprove ? 'approved' : baseStatus;
      if (existing) {
        const isLocked =
          existing.status === 'approved' || existing.status === 'billed';
        if (isLocked && !isSuperAdmin) continue;
        // Status decisions on existing rows:
        //   - billed → preserve (super-admin override edits hours only)
        //   - approved → preserve (don't replace the original approver/time)
        //   - draft / submitted → promote to nextStatus (which is 'approved'
        //     when auto-approve is on, else baseStatus)
        const statusToSet = isLocked ? existing.status : nextStatus;
        if (isLocked) overriddenLockedEntries.push(existing.id);
        const wasNotYetApproved =
          existing.status === 'draft' || existing.status === 'submitted';
        const stampApproval = willAutoApprove && wasNotYetApproved;
        if (stampApproval) autoApprovedEntryRefs.push(existing.id);
        ops.push(
          prisma.timesheetEntry.update({
            where: { id: existing.id },
            data: {
              hours,
              description: row.description,
              status: statusToSet,
              ...(stampApproval
                ? {
                    approvedById: session.person.id,
                    approvedAt: autoApproveStamp,
                  }
                : {}),
            },
          }),
        );
      } else {
        const stampApproval = willAutoApprove;
        if (stampApproval) {
          autoApprovedEntryRefs.push(
            `${row.projectId}|${date.toISOString().slice(0, 10)}`,
          );
        }
        // Upsert on the (personId, projectId, date) unique key — the
        // pre-transaction read above can race (two tabs, a retry, a
        // WhatsApp log landing mid-save). With the DB constraint in
        // place, the race resolves to one row instead of a duplicate
        // that the grid hides but P&L counts twice.
        ops.push(
          prisma.timesheetEntry.upsert({
            where: {
              personId_projectId_date: {
                personId: targetPersonId,
                projectId: row.projectId,
                date,
              },
            },
            create: {
              personId: targetPersonId,
              projectId: row.projectId,
              date,
              hours,
              description: row.description,
              status: nextStatus,
              ...(stampApproval
                ? {
                    approvedById: session.person.id,
                    approvedAt: autoApproveStamp,
                  }
                : {}),
            },
            update: {
              hours,
              description: row.description,
              status: nextStatus,
              ...(stampApproval
                ? {
                    approvedById: session.person.id,
                    approvedAt: autoApproveStamp,
                  }
                : {}),
            },
          }),
        );
      }
    }
  }

  // Audit row — inlined so we can fire it inside the array-form batch.
  // Mirrors writeAudit() but skips its `tx` requirement (we're not in an
  // interactive session). `computeDelta(undefined, after)` yields the
  // expected `{ created: after }` shape this codebase uses elsewhere.
  const auditAfter: Record<string, unknown> = {
    targetPersonId,
    actingOnBehalf,
    actorIsSuperAdmin: isSuperAdmin,
    rangeStart: rangeStart.toISOString().slice(0, 10),
    dayCount,
    totalHours: Object.values(daily).reduce((s, h) => s + h, 0),
    rowCount: parsed.data.rows.length,
    ...(autoAddedProjects.length > 0 ? { autoAddedProjects } : {}),
    ...(overriddenLockedEntries.length > 0 ? { overriddenLockedEntries } : {}),
    ...(autoApprovedEntryRefs.length > 0
      ? {
          autoApproved: {
            count: autoApprovedEntryRefs.length,
            refs: autoApprovedEntryRefs,
            reason: isSuperAdmin
              ? 'super_admin_skip_queue'
              : 'leader_on_behalf',
          },
        }
      : {}),
  };
  const auditDelta = computeDelta(undefined, auditAfter);
  // Action label reflects what landed: full auto-approval reads as
  // 'auto_approved' so the audit log makes the queue-skip explicit.
  const auditAction =
    autoApprovedEntryRefs.length > 0 &&
    autoApprovedEntryRefs.length === parsed.data.rows.length
      ? 'auto_approved'
      : intent === 'submit'
        ? 'submitted'
        : 'saved';
  ops.push(
    prisma.auditEvent.create({
      data: {
        actorId: session.person.id,
        actorType: 'person',
        action: auditAction,
        entityType: 'timesheet_range',
        entityId: `${targetPersonId}:${rangeStart.toISOString().slice(0, 10)}:${dayCount}`,
        entityDelta:
          auditDelta === null
            ? Prisma.JsonNull
            : (auditDelta as Prisma.InputJsonValue),
        source: 'web',
      },
    }),
  );

  // Avoid lint warnings on an unused import — we keep `writeAudit` imported
  // because other branches of this module may want to grow back to the
  // interactive form.
  void writeAudit;

  try {
    await prisma.$transaction(ops);
  } catch (err) {
    console.error('[timesheet.save] failed:', err);
    const message =
      err instanceof Error && err.message.includes('Transaction already closed')
        ? 'Save took longer than expected — try saving fewer rows at a time.'
        : err instanceof Error && err.message.includes('connection pool')
          ? 'DB busy right now — save again in a sec.'
          : 'Save failed — try again.';
    return { status: 'error', message };
  }

  // Reconcile every dependent schedule surface — actuals on a
  // timesheet shift utilisation, the heatmap "booked" overlay, the
  // dashboard team-week, and the project's hours / budget actuals.
  // Project-level pages refresh on next navigation through their own
  // dynamic rendering; the firm-wide and person-level paths are the
  // ones currently held by the user's router cache.
  revalidatePath('/timesheet/approve');
  revalidateScheduleSurfaces({ personId: targetPersonId });
  const parts: string[] = [];
  if (autoApprovedEntryRefs.length > 0) {
    parts.push(
      isSuperAdmin
        ? 'Approved + posted (super-admin saves skip the queue).'
        : 'Approved on behalf — landed straight in project P&L.',
    );
  } else {
    parts.push(intent === 'submit' ? 'Submitted for approval.' : 'Draft saved.');
  }
  if (autoAddedProjects.length > 0) {
    parts.push(
      `Auto-added to ${autoAddedProjects.length} project ${autoAddedProjects.length === 1 ? 'team' : 'teams'}.`,
    );
  }
  if (overriddenLockedEntries.length > 0) {
    parts.push(
      `Super-admin override applied to ${overriddenLockedEntries.length} locked ${overriddenLockedEntries.length === 1 ? 'entry' : 'entries'}.`,
    );
  }
  return { status: 'success', message: parts.join(' ') };
}

/**
 * Pull a row of submitted entries back into draft so the submitter can edit
 * them without bouncing through the approver. Runs at row-level (one project
 * × one date range × one person) and only touches entries whose status is
 * `submitted` — already-approved or billed entries refuse the recall and the
 * UI nudges the user to ask the approver to roll back from `/timesheet/approve`.
 *
 * Allowed only when the caller is the entry's owner OR a super-admin override.
 */
/**
 * Promote every `submitted` entry currently visible on a person's sheet
 * (one person × one date range) to `approved`. Used to clear backlogs that
 * were submitted *before* the auto-approve rule was wired in — i.e. hours a
 * super-admin or project lead had filed on someone's behalf and that are
 * still parked in the approval queue.
 *
 * Allowed for:
 *   - super_admin / admin: any project
 *   - manager / partner: only entries on projects they lead (per-project gate
 *     mirrors saveTimesheet's leader gate)
 */
const PromoteSchema = z.object({
  targetPersonId: z.string().min(1),
  rangeStart: z.string().min(1),
  dayCount: z.coerce.number().int().min(1).max(31),
});

export type TimesheetPromoteState =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | { status: 'success'; message: string };

export async function promoteSubmittedToApproved(
  _prev: TimesheetPromoteState,
  formData: FormData,
): Promise<TimesheetPromoteState> {
  const session = await getSession();
  if (!session) return { status: 'error', message: 'Not signed in' };
  const isSuperAdmin = hasAnyRole(session, ['super_admin']);
  const isAdminGroup = hasAnyRole(session, ['super_admin', 'admin']);
  const isManagerOrLead = hasAnyRole(session, ['manager', 'partner']);
  if (!isAdminGroup && !isManagerOrLead) {
    return {
      status: 'error',
      message:
        'Only super admins, admins, or project leads can promote submitted hours to approved.',
    };
  }

  const parsed = PromoteSchema.safeParse({
    targetPersonId: formData.get('targetPersonId'),
    rangeStart: formData.get('rangeStart'),
    dayCount: formData.get('dayCount'),
  });
  if (!parsed.success) return { status: 'error', message: 'Invalid input' };

  const { targetPersonId, dayCount } = parsed.data;
  const rangeStart = parseIsoDate(parsed.data.rangeStart);
  const rangeEnd = addDays(rangeStart, dayCount);

  const submitted = await prisma.timesheetEntry.findMany({
    where: {
      personId: targetPersonId,
      date: { gte: rangeStart, lt: rangeEnd },
      status: 'submitted',
    },
    include: {
      project: { select: { id: true, code: true, managerId: true, primaryPartnerId: true } },
    },
  });
  if (submitted.length === 0) {
    return { status: 'error', message: 'No submitted hours in this range to promote.' };
  }

  // Per-project gate for non-admins.
  const allowedIds = isAdminGroup
    ? submitted.map((e) => e.id)
    : submitted
        .filter(
          (e) =>
            e.project.managerId === session.person.id ||
            e.project.primaryPartnerId === session.person.id,
        )
        .map((e) => e.id);
  if (allowedIds.length === 0) {
    return {
      status: 'error',
      message: 'None of the submitted entries are on projects you lead.',
    };
  }
  const skippedCount = submitted.length - allowedIds.length;

  const stamp = new Date();
  try {
    await prisma.$transaction([
      prisma.timesheetEntry.updateMany({
        where: { id: { in: allowedIds } },
        data: {
          status: 'approved',
          approvedById: session.person.id,
          approvedAt: stamp,
        },
      }),
      prisma.auditEvent.create({
        data: {
          actorId: session.person.id,
          actorType: 'person',
          action: 'auto_approved',
          entityType: 'timesheet_range',
          entityId: `${targetPersonId}:${rangeStart.toISOString().slice(0, 10)}:${dayCount}`,
          entityDelta: {
            promoted: {
              entryIds: allowedIds,
              count: allowedIds.length,
              skipped: skippedCount,
              reason: 'backlog_promotion',
              actorIsSuperAdmin: isSuperAdmin,
            },
          } as Prisma.InputJsonValue,
          source: 'web',
        },
      }),
    ]);
  } catch (err) {
    console.error('[timesheet.promote] failed:', err);
    return { status: 'error', message: 'Promote failed — try again.' };
  }

  revalidatePath('/timesheet');
  revalidatePath('/timesheet/approve');
  revalidatePath('/');
  if (targetPersonId !== session.person.id) {
    revalidatePath(`/directory/people/${targetPersonId}`);
  }
  const lead = `${allowedIds.length} ${allowedIds.length === 1 ? 'entry' : 'entries'} approved.`;
  const tail =
    skippedCount > 0
      ? ` ${skippedCount} skipped — not on a project you lead.`
      : '';
  return { status: 'success', message: lead + tail };
}

const RecallSchema = z.object({
  targetPersonId: z.string().min(1),
  projectId: z.string().min(1),
  rangeStart: z.string().min(1),
  dayCount: z.coerce.number().int().min(1).max(31),
});

export type TimesheetRecallState =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | { status: 'success'; message: string };

export async function recallSubmittedTimesheet(
  _prev: TimesheetRecallState,
  formData: FormData,
): Promise<TimesheetRecallState> {
  const session = await getSession();
  try {
    requireCapability(session, 'timesheet.submit');
  } catch {
    return { status: 'error', message: 'Not signed in' };
  }

  const parsed = RecallSchema.safeParse({
    targetPersonId: formData.get('targetPersonId'),
    projectId: formData.get('projectId'),
    rangeStart: formData.get('rangeStart'),
    dayCount: formData.get('dayCount'),
  });
  if (!parsed.success) return { status: 'error', message: 'Invalid input' };

  const { targetPersonId, projectId, dayCount } = parsed.data;
  const rangeStart = parseIsoDate(parsed.data.rangeStart);
  const rangeEnd = addDays(rangeStart, dayCount);

  const isSuperAdmin = hasAnyRole(session, ['super_admin']);
  if (targetPersonId !== session.person.id && !isSuperAdmin) {
    return { status: 'error', message: 'Not authorized to recall on this sheet.' };
  }

  // Look at every entry in scope so we can be specific in the response.
  const inScope = await prisma.timesheetEntry.findMany({
    where: {
      personId: targetPersonId,
      projectId,
      date: { gte: rangeStart, lt: rangeEnd },
    },
    select: { id: true, status: true },
  });
  const submittedIds = inScope.filter((e) => e.status === 'submitted').map((e) => e.id);
  const blocked = inScope.filter((e) => e.status === 'approved' || e.status === 'billed');

  if (submittedIds.length === 0) {
    if (blocked.length > 0) {
      return {
        status: 'error',
        message: `Can't recall — these hours are already ${blocked[0]?.status}. Ask the approver to roll back from the approval queue.`,
      };
    }
    return { status: 'error', message: 'Nothing to recall — no submitted entries here.' };
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.timesheetEntry.updateMany({
        where: { id: { in: submittedIds } },
        data: { status: 'draft', approvedById: null, approvedAt: null },
      });
      await writeAudit(tx, {
        actor: { type: 'person', id: session.person.id },
        action: 'recalled_from_approval',
        entity: {
          type: 'timesheet_range',
          id: `${targetPersonId}:${projectId}:${rangeStart.toISOString().slice(0, 10)}:${dayCount}`,
          before: { status: 'submitted' },
          after: {
            status: 'draft',
            entryIds: submittedIds,
            byPersonId: targetPersonId,
            actingOnBehalf: targetPersonId !== session.person.id,
          },
        },
        source: 'web',
      });
    });
  } catch (err) {
    console.error('[timesheet.recall] failed:', err);
    return { status: 'error', message: 'Recall failed — try again.' };
  }

  revalidatePath('/timesheet');
  revalidatePath('/timesheet/approve');
  if (targetPersonId !== session.person.id) {
    revalidatePath(`/directory/people/${targetPersonId}`);
  }
  const partial = blocked.length > 0;
  return {
    status: 'success',
    message: partial
      ? `Recalled ${submittedIds.length} entries. ${blocked.length} already ${blocked[0]?.status} — left untouched.`
      : `Recalled ${submittedIds.length} ${submittedIds.length === 1 ? 'entry' : 'entries'} to draft.`,
  };
}

const DecideSchema = z.object({
  entryIds: z.array(z.string()).min(1),
  decision: z.enum(['approved', 'rejected']),
  note: z.string().trim().max(500).optional().nullable(),
});

export async function decideTimesheetEntries(
  _prev: TimesheetSaveState,
  formData: FormData,
): Promise<TimesheetSaveState> {
  const session = await getSession();
  if (!session) return { status: 'error', message: 'Not signed in' };

  const rawIds = formData.getAll('entryId').map(String);
  const parsed = DecideSchema.safeParse({
    entryIds: rawIds,
    decision: formData.get('decision'),
    note: formData.get('note') || null,
  });
  if (!parsed.success) {
    return { status: 'error', message: 'Invalid input' };
  }
  if (parsed.data.decision === 'rejected' && !parsed.data.note) {
    return { status: 'error', message: 'Note required on reject' };
  }

  const entries = await prisma.timesheetEntry.findMany({
    where: { id: { in: parsed.data.entryIds }, status: 'submitted' },
    include: { project: { select: { managerId: true } } },
  });
  if (entries.length !== parsed.data.entryIds.length) {
    return { status: 'error', message: 'Some entries already decided or missing.' };
  }
  const canDecideAll = session.person.roles.includes('super_admin') || session.person.roles.includes('admin');
  if (!canDecideAll) {
    const unauthorised = entries.some((e) => e.project.managerId !== session.person.id);
    if (unauthorised) return { status: 'error', message: 'Not the manager for some of these.' };
  }

  const { decision, note } = parsed.data;
  try {
    await prisma.$transaction(async (tx) => {
      for (const entry of entries) {
        await tx.timesheetEntry.update({
          where: { id: entry.id },
          data:
            decision === 'approved'
              ? {
                  status: 'approved',
                  approvedById: session.person.id,
                  approvedAt: new Date(),
                }
              : {
                  status: 'draft',
                  approvedById: null,
                  approvedAt: null,
                },
        });
        await writeAudit(tx, {
          actor: { type: 'person', id: session.person.id },
          action: decision,
          entity: {
            type: 'timesheet_entry',
            id: entry.id,
            before: { status: entry.status },
            after: { status: decision === 'approved' ? 'approved' : 'draft', note: note ?? null },
          },
          source: 'web',
        });
      }

      // Per-person feed: notify the submitters that their timesheet
      // entries were approved / rejected. We collapse multi-entry
      // decisions into a single feed item per person — managers
      // typically approve a whole week at once and it'd be noisy to
      // emit 7 rows.
      const byPerson = new Map<string, number>();
      for (const e of entries) {
        if (e.personId === session.person.id) continue; // skip self
        byPerson.set(e.personId, (byPerson.get(e.personId) ?? 0) + 1);
      }
      for (const [personId, count] of byPerson) {
        await emitUserUpdateMany(tx, [personId], {
          kind: decision === 'approved' ? 'timesheet_approved' : 'timesheet_rejected',
          title:
            decision === 'approved'
              ? `Your timesheet was approved (${count} ${count === 1 ? 'entry' : 'entries'})`
              : `Your timesheet was sent back (${count} ${count === 1 ? 'entry' : 'entries'})`,
          body: note ?? null,
          href: '/timesheet',
          entityType: 'timesheet_entry',
          entityId: null,
        });
      }
    });
  } catch (err) {
    console.error('[timesheet.decide] failed:', err);
    return { status: 'error', message: 'Decision failed — try again.' };
  }

  revalidatePath('/timesheet/approve');
  return {
    status: 'success',
    message: `${decision === 'approved' ? 'Approved' : 'Sent back'} ${entries.length} entries.`,
  };
}
