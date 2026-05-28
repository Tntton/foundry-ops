'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { getSession } from '@/server/session';
import { writeAudit } from '@/server/audit';
import { renderWorkOrderMarkdown } from '@/server/work-order-template';

export type PaperworkState =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | { status: 'success'; message: string };

const FILE_SIZE_CAP = 12 * 1024 * 1024; // 12 MB — matches serverActions body limit

function ensureCanEdit(roles: string[]): boolean {
  return roles.some((r) =>
    ['super_admin', 'admin', 'partner', 'manager'].includes(r),
  );
}

const UploadSchema = z.object({
  projectId: z.string().min(1),
  kind: z.enum(['csa', 'workOrder']),
  fileBase64: z.string().min(1),
  fileMime: z.string().min(1),
  fileName: z.string().min(1).max(200),
});

/**
 * Persist an uploaded CSA or Work Order PDF on the project. We stash the
 * file as a `data:` URL on the relevant column for now — same approach
 * the Receipt Upload uses — so the document is viewable inline without a
 * SharePoint round-trip. Real SharePoint sync lands when the Graph
 * integration is wired (TASK-082).
 */
export async function uploadEngagementDoc(
  _prev: PaperworkState,
  formData: FormData,
): Promise<PaperworkState> {
  const session = await getSession();
  if (!session) return { status: 'error', message: 'Not signed in' };
  if (!ensureCanEdit(session.person.roles)) {
    return { status: 'error', message: 'Not authorized' };
  }

  const parsed = UploadSchema.safeParse({
    projectId: formData.get('projectId'),
    kind: formData.get('kind'),
    fileBase64: formData.get('fileBase64'),
    fileMime: formData.get('fileMime'),
    fileName: formData.get('fileName'),
  });
  if (!parsed.success) {
    return {
      status: 'error',
      message: parsed.error.issues[0]?.message ?? 'Invalid upload',
    };
  }
  const { projectId, kind, fileBase64, fileMime, fileName } = parsed.data;
  if (fileBase64.length > FILE_SIZE_CAP * 1.4) {
    // Base64 ~33% inflation — guard so we don't try to write a 50MB string.
    return { status: 'error', message: 'File too large — max 12 MB.' };
  }
  const dataUrl = `data:${fileMime};base64,${fileBase64}`;

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, code: true },
  });
  if (!project) return { status: 'error', message: 'Project not found' };

  try {
    await prisma.$transaction(async (tx) => {
      const now = new Date();
      if (kind === 'csa') {
        await tx.project.update({
          where: { id: projectId },
          data: {
            csaSharepointUrl: dataUrl,
            csaUploadedAt: now,
          },
        });
      } else {
        await tx.project.update({
          where: { id: projectId },
          data: {
            workOrderSharepointUrl: dataUrl,
            workOrderUploadedAt: now,
            // Once a signed PDF is uploaded the generated draft is
            // superseded — clear it so the UI prefers the canonical doc.
            workOrderDraftText: null,
          },
        });
      }
      await writeAudit(tx, {
        actor: { type: 'person', id: session.person.id },
        action: 'updated',
        entity: {
          type: 'project',
          id: projectId,
          after: {
            via: 'paperwork_upload',
            kind,
            fileName,
            fileMime,
            fileSize: fileBase64.length,
          },
        },
        source: 'web',
      });
    });
  } catch (err) {
    console.error('[paperwork.upload] failed:', err);
    return { status: 'error', message: 'Upload failed — try again.' };
  }

  revalidatePath(`/projects/${project.code}`);
  revalidatePath(`/projects/${project.code}/settings`);
  return {
    status: 'success',
    message: `${kind === 'csa' ? 'CSA' : 'Work Order'} uploaded.`,
  };
}

const GenerateSchema = z.object({
  projectId: z.string().min(1),
});

/**
 * Render a Work Order draft from the project's commercial fields and
 * stash it as Markdown on `workOrderDraftText`. Idempotent — running it
 * again overwrites the previous draft. Surfaced as a "Generate WO draft"
 * button on the paperwork section; once the partner is happy with the
 * text they upload the executed PDF (which clears the draft).
 */
export async function generateWorkOrderDraft(
  _prev: PaperworkState,
  formData: FormData,
): Promise<PaperworkState> {
  const session = await getSession();
  if (!session) return { status: 'error', message: 'Not signed in' };
  if (!ensureCanEdit(session.person.roles)) {
    return { status: 'error', message: 'Not authorized' };
  }
  const parsed = GenerateSchema.safeParse({
    projectId: formData.get('projectId'),
  });
  if (!parsed.success) return { status: 'error', message: 'Invalid input' };

  const project = await prisma.project.findUnique({
    where: { id: parsed.data.projectId },
    select: { id: true, code: true },
  });
  if (!project) return { status: 'error', message: 'Project not found' };

  let markdown: string;
  try {
    markdown = await renderWorkOrderMarkdown(project.id);
  } catch (err) {
    console.error('[paperwork.generate] failed:', err);
    return { status: 'error', message: 'Could not render Work Order template.' };
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.project.update({
        where: { id: project.id },
        data: {
          workOrderDraftText: markdown,
          workOrderGeneratedAt: new Date(),
        },
      });
      await writeAudit(tx, {
        actor: { type: 'person', id: session.person.id },
        action: 'updated',
        entity: {
          type: 'project',
          id: project.id,
          after: { via: 'work_order_draft_generated' },
        },
        source: 'web',
      });
    });
  } catch (err) {
    console.error('[paperwork.generate] write failed:', err);
    return { status: 'error', message: 'Save failed — try again.' };
  }

  revalidatePath(`/projects/${project.code}`);
  revalidatePath(`/projects/${project.code}/settings`);
  return { status: 'success', message: 'Work Order draft generated.' };
}

const SaveDraftSchema = z.object({
  projectId: z.string().min(1),
  workOrderDraftText: z.string().min(1).max(50_000),
});

export async function saveWorkOrderDraft(
  _prev: PaperworkState,
  formData: FormData,
): Promise<PaperworkState> {
  const session = await getSession();
  if (!session) return { status: 'error', message: 'Not signed in' };
  if (!ensureCanEdit(session.person.roles)) {
    return { status: 'error', message: 'Not authorized' };
  }
  const parsed = SaveDraftSchema.safeParse({
    projectId: formData.get('projectId'),
    workOrderDraftText: formData.get('workOrderDraftText'),
  });
  if (!parsed.success) {
    return {
      status: 'error',
      message: parsed.error.issues[0]?.message ?? 'Invalid input',
    };
  }
  const project = await prisma.project.findUnique({
    where: { id: parsed.data.projectId },
    select: { id: true, code: true },
  });
  if (!project) return { status: 'error', message: 'Project not found' };

  try {
    await prisma.$transaction(async (tx) => {
      await tx.project.update({
        where: { id: project.id },
        data: { workOrderDraftText: parsed.data.workOrderDraftText },
      });
      await writeAudit(tx, {
        actor: { type: 'person', id: session.person.id },
        action: 'updated',
        entity: {
          type: 'project',
          id: project.id,
          after: { via: 'work_order_draft_edited' },
        },
        source: 'web',
      });
    });
  } catch (err) {
    console.error('[paperwork.save] failed:', err);
    return { status: 'error', message: 'Save failed — try again.' };
  }

  revalidatePath(`/projects/${project.code}/settings`);
  return { status: 'success', message: 'Draft saved.' };
}
