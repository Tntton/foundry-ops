'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { getSession } from '@/server/session';
import { requireCapability } from '@/server/capabilities';
import { writeAudit } from '@/server/audit';

const optionalDate = z
  .union([z.coerce.date(), z.literal('').transform(() => null)])
  .optional()
  .nullable();

const ProjectEditSchema = z
  .object({
    // Code is editable so a project can be re-coded mid-flight —
    // e.g. a client engagement that gets pulled becomes an internal
    // FHP project. Uppercase letters / digits / hyphens, 3–16 chars.
    code: z
      .string()
      .trim()
      .min(3, 'Code must be 3–16 chars')
      .max(16, 'Code must be 3–16 chars')
      .regex(/^[A-Z0-9-]+$/, 'Code must be uppercase letters, digits, hyphens'),
    name: z.string().trim().min(3).max(200),
    description: z.string().trim().max(2000).optional().nullable(),
    stage: z.enum(['kickoff', 'delivery', 'closing', 'archived']),
    startDate: optionalDate,
    endDate: optionalDate,
    contractValueDollars: z.coerce.number().min(0).max(10_000_000),
    currency: z.enum(['AUD', 'NZD', 'USD', 'GBP', 'EUR', 'SGD']),
    primaryPartnerId: z.string().min(1),
    managerId: z.string().min(1),
    actualEndDate: z.coerce.date().optional().nullable().or(z.literal('').transform(() => null)),
    // Checkbox sends '1' when checked, missing when unchecked. Coerce to bool.
    defaultExpensesRebillable: z
      .union([z.literal('1'), z.literal('on'), z.null(), z.undefined()])
      .transform((v) => v === '1' || v === 'on'),
  })
  .refine(
    (v) => {
      if (!(v.startDate instanceof Date) || !(v.endDate instanceof Date)) return true;
      return v.endDate.getTime() > v.startDate.getTime();
    },
    { message: 'End date must be after start date', path: ['endDate'] },
  )
  .refine(
    (v) => {
      // Reconciliation gate — moving to closing/archived requires both dates set.
      if (v.stage !== 'closing' && v.stage !== 'archived') return true;
      return v.startDate instanceof Date && v.endDate instanceof Date;
    },
    {
      message:
        'Set both theoretical start and end before moving the project to closing or archived.',
      path: ['stage'],
    },
  );

export type ProjectEditState =
  | { status: 'idle' }
  | { status: 'error'; message: string; fieldErrors?: Record<string, string> };

export async function updateProject(
  projectId: string,
  _prev: ProjectEditState,
  formData: FormData,
): Promise<ProjectEditState> {
  const session = await getSession();
  try {
    requireCapability(session, 'project.edit');
  } catch {
    return { status: 'error', message: 'Not authorized' };
  }

  const parsed = ProjectEditSchema.safeParse({
    code: (formData.get('code') as string | null)?.toUpperCase(),
    name: formData.get('name'),
    description: formData.get('description') || null,
    stage: formData.get('stage'),
    startDate: formData.get('startDate') || null,
    endDate: formData.get('endDate') || null,
    contractValueDollars: formData.get('contractValueDollars'),
    currency: formData.get('currency'),
    primaryPartnerId: formData.get('primaryPartnerId'),
    managerId: formData.get('managerId'),
    actualEndDate: formData.get('actualEndDate') || null,
    defaultExpensesRebillable: formData.get('defaultExpensesRebillable'),
  });
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path.join('.');
      if (!fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return { status: 'error', message: 'Please fix the highlighted fields.', fieldErrors };
  }
  const data = parsed.data;

  const existing = await prisma.project.findUnique({ where: { id: projectId } });
  if (!existing) return { status: 'error', message: 'Project not found' };

  const canAll = session.person.roles.some((r) => ['super_admin', 'admin'].includes(r));
  if (!canAll && existing.managerId !== session.person.id && existing.primaryPartnerId !== session.person.id) {
    return { status: 'error', message: 'Only project leadership / admin can edit settings.' };
  }

  // Code-change check — uniqueness across all projects. Only super_admin /
  // admin can rename the code (it's load-bearing for invoices, time entries,
  // SharePoint folders etc., so we don't want partners renaming under us).
  const codeChanged = data.code !== existing.code;
  if (codeChanged) {
    if (!canAll) {
      return {
        status: 'error',
        message: 'Only super_admin / admin can rename a project code.',
      };
    }
    const collision = await prisma.project.findUnique({ where: { code: data.code } });
    if (collision && collision.id !== projectId) {
      return {
        status: 'error',
        message: `Code "${data.code}" is already taken by ${collision.name}.`,
        fieldErrors: { code: 'Already in use' },
      };
    }
  }

  const contractValue = Math.round(data.contractValueDollars * 100);
  const actualEndDate = data.actualEndDate instanceof Date ? data.actualEndDate : null;
  const startDate = data.startDate instanceof Date ? data.startDate : null;
  const endDate = data.endDate instanceof Date ? data.endDate : null;

  const before = {
    code: existing.code,
    name: existing.name,
    description: existing.description,
    stage: existing.stage,
    startDate: existing.startDate ? existing.startDate.toISOString() : null,
    endDate: existing.endDate ? existing.endDate.toISOString() : null,
    actualEndDate: existing.actualEndDate ? existing.actualEndDate.toISOString() : null,
    contractValue: existing.contractValue,
    currency: existing.currency,
    primaryPartnerId: existing.primaryPartnerId,
    managerId: existing.managerId,
    defaultExpensesRebillable: existing.defaultExpensesRebillable,
  };
  const after = {
    code: data.code,
    name: data.name,
    description: data.description,
    stage: data.stage,
    startDate: startDate ? startDate.toISOString() : null,
    endDate: endDate ? endDate.toISOString() : null,
    actualEndDate: actualEndDate ? actualEndDate.toISOString() : null,
    contractValue,
    currency: data.currency,
    primaryPartnerId: data.primaryPartnerId,
    managerId: data.managerId,
    defaultExpensesRebillable: data.defaultExpensesRebillable,
  };

  try {
    await prisma.$transaction(async (tx) => {
      await tx.project.update({
        where: { id: projectId },
        data: {
          code: data.code,
          name: data.name,
          description: data.description,
          stage: data.stage,
          startDate,
          endDate,
          actualEndDate,
          contractValue,
          currency: data.currency,
          primaryPartnerId: data.primaryPartnerId,
          managerId: data.managerId,
          defaultExpensesRebillable: data.defaultExpensesRebillable,
        },
      });
      await writeAudit(tx, {
        actor: { type: 'person', id: session.person.id },
        action: 'updated',
        entity: { type: 'project', id: projectId, before, after },
        source: 'web',
      });
    });
  } catch (err) {
    console.error('[project.update] failed:', err);
    return { status: 'error', message: 'Save failed — try again.' };
  }

  revalidatePath('/projects');
  revalidatePath(`/projects/${existing.code}`);
  if (codeChanged) revalidatePath(`/projects/${data.code}`);
  redirect(`/projects/${data.code}`);
}
