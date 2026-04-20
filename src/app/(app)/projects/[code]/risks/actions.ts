'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { getSession } from '@/server/session';
import { requireCapability } from '@/server/capabilities';
import { writeAudit } from '@/server/audit';

const SEVERITIES = ['low', 'medium', 'high'] as const;
const STATUSES = ['open', 'mitigating', 'closed'] as const;

const RiskCreateSchema = z.object({
  projectId: z.string().min(1),
  title: z.string().trim().min(1).max(200),
  severity: z.enum(SEVERITIES),
  status: z.enum(STATUSES).default('open'),
  mitigation: z.string().trim().max(2000).optional().nullable(),
  ownerId: z.string().optional().nullable(),
});

export type RiskState = { status: 'idle' } | { status: 'error'; message: string };

export async function createRisk(
  _prev: RiskState,
  formData: FormData,
): Promise<RiskState> {
  const session = await getSession();
  try {
    requireCapability(session, 'project.edit');
  } catch {
    return { status: 'error', message: 'Not authorized' };
  }

  const parsed = RiskCreateSchema.safeParse({
    projectId: formData.get('projectId'),
    title: formData.get('title'),
    severity: formData.get('severity'),
    status: formData.get('status') || 'open',
    mitigation: formData.get('mitigation') || null,
    ownerId: formData.get('ownerId') || null,
  });
  if (!parsed.success) {
    return { status: 'error', message: parsed.error.issues[0]?.message ?? 'Invalid input' };
  }

  const project = await prisma.project.findUnique({
    where: { id: parsed.data.projectId },
    select: { id: true, code: true, managerId: true, primaryPartnerId: true },
  });
  if (!project) return { status: 'error', message: 'Project not found' };

  const canAll = session.person.roles.some((r) => ['super_admin', 'admin'].includes(r));
  if (!canAll && project.managerId !== session.person.id && project.primaryPartnerId !== session.person.id) {
    return { status: 'error', message: 'Not authorized for this project.' };
  }

  try {
    await prisma.$transaction(async (tx) => {
      const risk = await tx.risk.create({
        data: {
          projectId: parsed.data.projectId,
          title: parsed.data.title,
          severity: parsed.data.severity,
          status: parsed.data.status,
          mitigation: parsed.data.mitigation,
          ownerId: parsed.data.ownerId && parsed.data.ownerId !== '' ? parsed.data.ownerId : null,
        },
      });
      await writeAudit(tx, {
        actor: { type: 'person', id: session.person.id },
        action: 'created',
        entity: {
          type: 'risk',
          id: risk.id,
          after: {
            projectId: risk.projectId,
            title: risk.title,
            severity: risk.severity,
            status: risk.status,
            ownerId: risk.ownerId,
          },
        },
        source: 'web',
      });
    });
  } catch (err) {
    console.error('[risk.create] failed:', err);
    return { status: 'error', message: 'Create failed — try again.' };
  }

  revalidatePath(`/projects/${project.code}`);
  revalidatePath(`/projects/${project.code}/risks`);
  return { status: 'idle' };
}

const RiskUpdateSchema = z.object({
  riskId: z.string().min(1),
  field: z.enum(['status', 'severity']),
  value: z.string(),
});

export async function updateRiskField(
  _prev: RiskState,
  formData: FormData,
): Promise<RiskState> {
  const session = await getSession();
  try {
    requireCapability(session, 'project.edit');
  } catch {
    return { status: 'error', message: 'Not authorized' };
  }

  const parsed = RiskUpdateSchema.safeParse({
    riskId: formData.get('riskId'),
    field: formData.get('field'),
    value: formData.get('value'),
  });
  if (!parsed.success) return { status: 'error', message: 'Invalid input' };

  if (parsed.data.field === 'status' && !STATUSES.includes(parsed.data.value as typeof STATUSES[number])) {
    return { status: 'error', message: 'Bad status value' };
  }
  if (parsed.data.field === 'severity' && !SEVERITIES.includes(parsed.data.value as typeof SEVERITIES[number])) {
    return { status: 'error', message: 'Bad severity value' };
  }

  const risk = await prisma.risk.findUnique({
    where: { id: parsed.data.riskId },
    include: { project: { select: { code: true, managerId: true, primaryPartnerId: true } } },
  });
  if (!risk) return { status: 'error', message: 'Risk not found' };
  const canAll = session.person.roles.some((r) => ['super_admin', 'admin'].includes(r));
  if (!canAll && risk.project.managerId !== session.person.id && risk.project.primaryPartnerId !== session.person.id) {
    return { status: 'error', message: 'Not authorized.' };
  }

  try {
    await prisma.$transaction(async (tx) => {
      const before = { status: risk.status, severity: risk.severity };
      const updated = await tx.risk.update({
        where: { id: risk.id },
        data: { [parsed.data.field]: parsed.data.value },
      });
      await writeAudit(tx, {
        actor: { type: 'person', id: session.person.id },
        action: 'updated',
        entity: {
          type: 'risk',
          id: updated.id,
          before,
          after: { status: updated.status, severity: updated.severity },
        },
        source: 'web',
      });
    });
  } catch (err) {
    console.error('[risk.update] failed:', err);
    return { status: 'error', message: 'Update failed.' };
  }

  revalidatePath(`/projects/${risk.project.code}`);
  revalidatePath(`/projects/${risk.project.code}/risks`);
  return { status: 'idle' };
}
