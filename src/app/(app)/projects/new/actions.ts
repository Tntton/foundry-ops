'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { getSession } from '@/server/session';
import { requireCapability } from '@/server/capabilities';
import { writeAudit } from '@/server/audit';

const ProjectCreate = z
  .object({
    code: z
      .string()
      .trim()
      .regex(/^[A-Z][A-Z0-9]{2,9}$/u, '3-10 uppercase letters/digits, letter first'),
    clientId: z.string().min(1, 'Client is required'),
    name: z.string().trim().min(3).max(200),
    description: z.string().trim().max(2000).optional().nullable(),
    contractValueDollars: z.coerce.number().min(0).max(10_000_000),
    startDate: z.coerce.date(),
    endDate: z.coerce.date(),
    primaryPartnerId: z.string().min(1),
    managerId: z.string().min(1),
  })
  .refine((v) => v.endDate.getTime() > v.startDate.getTime(), {
    message: 'End date must be after start date',
    path: ['endDate'],
  });

export type NewProjectState =
  | { status: 'idle' }
  | { status: 'error'; message: string; fieldErrors?: Record<string, string> };

export async function createProject(
  _prev: NewProjectState,
  formData: FormData,
): Promise<NewProjectState> {
  const session = await getSession();
  try {
    requireCapability(session, 'project.create');
  } catch {
    return { status: 'error', message: 'Not authorized' };
  }

  const raw = {
    code: String(formData.get('code') ?? '').toUpperCase(),
    clientId: formData.get('clientId'),
    name: formData.get('name'),
    description: formData.get('description') || null,
    contractValueDollars: formData.get('contractValueDollars'),
    startDate: formData.get('startDate'),
    endDate: formData.get('endDate'),
    primaryPartnerId: formData.get('primaryPartnerId'),
    managerId: formData.get('managerId'),
  };

  const parsed = ProjectCreate.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path.join('.');
      if (!fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return { status: 'error', message: 'Please fix the highlighted fields.', fieldErrors };
  }

  const data = parsed.data;

  const existingCode = await prisma.project.findUnique({ where: { code: data.code } });
  if (existingCode) {
    return {
      status: 'error',
      message: 'Code already in use.',
      fieldErrors: { code: 'Already used' },
    };
  }

  const contractValue = Math.round(data.contractValueDollars * 100);
  let newCode: string;
  try {
    newCode = await prisma.$transaction(async (tx) => {
      const project = await tx.project.create({
        data: {
          code: data.code,
          clientId: data.clientId,
          name: data.name,
          description: data.description,
          contractValue,
          startDate: data.startDate,
          endDate: data.endDate,
          primaryPartnerId: data.primaryPartnerId,
          managerId: data.managerId,
          stage: 'kickoff',
        },
      });
      await writeAudit(tx, {
        actor: { type: 'person', id: session.person.id },
        action: 'created',
        entity: {
          type: 'project',
          id: project.id,
          after: {
            code: project.code,
            clientId: project.clientId,
            name: project.name,
            contractValue: project.contractValue,
            primaryPartnerId: project.primaryPartnerId,
            managerId: project.managerId,
            stage: project.stage,
          },
        },
        source: 'web',
      });
      return project.code;
    });
  } catch (err) {
    console.error('[project.create] failed:', err);
    return { status: 'error', message: 'Create failed — try again.' };
  }

  revalidatePath('/projects');
  redirect(`/projects/${newCode}`);
}
