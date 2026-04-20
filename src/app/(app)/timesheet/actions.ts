'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { getSession } from '@/server/session';
import { requireCapability } from '@/server/capabilities';
import { writeAudit } from '@/server/audit';
import { addDays, parseIsoDate, startOfWeek } from '@/lib/week';

const CellSchema = z.object({
  projectId: z.string().min(1),
  description: z.string().trim().max(300).default(''),
  hours: z.array(z.coerce.number().min(0).max(24)).length(7),
});

const SaveSchema = z.object({
  weekStart: z.string(),
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

  const weekStart = startOfWeek(parseIsoDate(String(formData.get('weekStart') ?? '')));
  const intent = formData.get('intent') === 'submit' ? 'submit' : 'save';

  // Rows come in as repeated fields. Collect projectIds from form, then read hours per project per day.
  const projectIds = formData.getAll('projectId').map(String);
  const rows: Array<z.infer<typeof CellSchema>> = [];
  for (const pid of projectIds) {
    const description = String(formData.get(`description::${pid}`) ?? '').trim();
    const hours: number[] = [];
    for (let i = 0; i < 7; i += 1) {
      const raw = formData.get(`hours::${pid}::${i}`);
      hours.push(Number(raw ?? 0));
    }
    rows.push({ projectId: pid, description, hours });
  }

  const parsed = SaveSchema.safeParse({ weekStart: String(formData.get('weekStart') ?? ''), intent, rows });
  if (!parsed.success) {
    return { status: 'error', message: 'Invalid timesheet payload' };
  }

  // Per-row validation: description required when any hours > 0.
  for (const row of parsed.data.rows) {
    const totalHours = row.hours.reduce((s, h) => s + h, 0);
    if (totalHours > 0 && !row.description) {
      return {
        status: 'error',
        message: `Description required on rows with logged hours (${row.projectId}).`,
      };
    }
  }

  const daily: Record<string, number> = {};
  for (const row of parsed.data.rows) {
    for (let i = 0; i < 7; i += 1) {
      const d = addDays(weekStart, i).toISOString().slice(0, 10);
      daily[d] = (daily[d] ?? 0) + row.hours[i]!;
    }
  }
  for (const [day, total] of Object.entries(daily)) {
    if (total > 24) {
      return { status: 'error', message: `Day ${day} exceeds 24h (${total}h logged).` };
    }
  }

  try {
    await prisma.$transaction(async (tx) => {
      for (const row of parsed.data.rows) {
        for (let i = 0; i < 7; i += 1) {
          const date = addDays(weekStart, i);
          const hours = row.hours[i]!;
          const existing = await tx.timesheetEntry.findFirst({
            where: {
              personId: session.person.id,
              projectId: row.projectId,
              date,
            },
          });

          if (hours === 0) {
            if (existing && existing.status === 'draft') {
              await tx.timesheetEntry.delete({ where: { id: existing.id } });
            }
            // Submitted/approved entries with 0 hours are left alone — they're historical record.
            continue;
          }

          const nextStatus = intent === 'submit' ? 'submitted' : 'draft';
          if (existing) {
            // Don't downgrade approved/billed entries from an edit.
            if (existing.status === 'approved' || existing.status === 'billed') continue;
            await tx.timesheetEntry.update({
              where: { id: existing.id },
              data: {
                hours,
                description: row.description,
                status: nextStatus,
              },
            });
          } else {
            await tx.timesheetEntry.create({
              data: {
                personId: session.person.id,
                projectId: row.projectId,
                date,
                hours,
                description: row.description,
                status: nextStatus,
              },
            });
          }
        }
      }

      await writeAudit(tx, {
        actor: { type: 'person', id: session.person.id },
        action: intent === 'submit' ? 'submitted' : 'saved',
        entity: {
          type: 'timesheet_week',
          id: `${session.person.id}:${weekStart.toISOString().slice(0, 10)}`,
          after: {
            weekStart: weekStart.toISOString().slice(0, 10),
            totalHours: Object.values(daily).reduce((s, h) => s + h, 0),
            rowCount: parsed.data.rows.length,
          },
        },
        source: 'web',
      });
    });
  } catch (err) {
    console.error('[timesheet.save] failed:', err);
    return { status: 'error', message: 'Save failed — try again.' };
  }

  revalidatePath('/timesheet');
  revalidatePath('/timesheet/approve');
  return {
    status: 'success',
    message: intent === 'submit' ? 'Submitted for approval.' : 'Draft saved.',
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
