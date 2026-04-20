'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { getSession } from '@/server/session';
import { requireCapability } from '@/server/capabilities';
import { writeAudit } from '@/server/audit';
import { getXeroIntegration } from '@/server/integrations/xero';
import { syncClientToXero } from '@/server/integrations/xero-contacts';

export type XeroSyncState =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | { status: 'success'; message: string };

export async function syncClientXero(
  clientId: string,
  _prev: XeroSyncState,
  _formData: FormData,
): Promise<XeroSyncState> {
  const session = await getSession();
  try {
    requireCapability(session, 'client.edit');
  } catch {
    return { status: 'error', message: 'Not authorized' };
  }

  const xeroRow = await getXeroIntegration();
  if (!xeroRow || xeroRow.status !== 'connected') {
    return {
      status: 'error',
      message: 'Xero not connected. Connect at /admin/integrations/xero first.',
    };
  }

  try {
    const contactId = await syncClientToXero(clientId);
    await prisma.$transaction(async (tx) => {
      await writeAudit(tx, {
        actor: { type: 'person', id: session.person.id },
        action: 'xero_synced',
        entity: {
          type: 'client',
          id: clientId,
          after: { xeroContactId: contactId },
        },
        source: 'web',
      });
    });
    revalidatePath(`/directory/clients/${clientId}`);
    return { status: 'success', message: `Synced (Xero contact ${contactId.slice(0, 8)}…).` };
  } catch (err) {
    console.error('[client.xero-sync] failed:', err);
    return {
      status: 'error',
      message: `Sync failed: ${(err as Error).message}`,
    };
  }
}

export type ClientDeleteState =
  | { status: 'idle' }
  | { status: 'error'; message: string };

const DeleteSchema = z.object({ confirmCode: z.string().trim() });

/**
 * Hard delete — super_admin only, and only when the client has zero projects,
 * deals, or invoices. No soft-archive on Client yet (no field on the schema),
 * so the choice is delete-if-clean or leave it. Xero contact is *not* removed
 * from Xero — that lives in the accounting system of record.
 */
export async function deleteClient(
  clientId: string,
  _prev: ClientDeleteState,
  formData: FormData,
): Promise<ClientDeleteState> {
  const session = await getSession();
  try {
    requireCapability(session, 'client.delete');
  } catch {
    return { status: 'error', message: 'Not authorized' };
  }

  const parsed = DeleteSchema.safeParse({ confirmCode: formData.get('confirmCode') });
  if (!parsed.success) return { status: 'error', message: 'Invalid input' };

  const client = await prisma.client.findUnique({ where: { id: clientId } });
  if (!client) return { status: 'error', message: 'Client not found' };

  if (parsed.data.confirmCode.toUpperCase() !== client.code) {
    return {
      status: 'error',
      message: `Code didn't match. To confirm, type "${client.code}" exactly.`,
    };
  }

  const [projectCount, dealCount, invoiceCount] = await Promise.all([
    prisma.project.count({ where: { clientId } }),
    prisma.deal.count({ where: { clientId } }),
    prisma.invoice.count({ where: { clientId } }),
  ]);
  const blockers: string[] = [];
  if (projectCount) blockers.push(`${projectCount} project${projectCount === 1 ? '' : 's'}`);
  if (dealCount) blockers.push(`${dealCount} deal${dealCount === 1 ? '' : 's'}`);
  if (invoiceCount) blockers.push(`${invoiceCount} invoice${invoiceCount === 1 ? '' : 's'}`);
  if (blockers.length) {
    return {
      status: 'error',
      message: `Can't delete — client still has ${blockers.join(', ')}. Remove those first.`,
    };
  }

  try {
    await prisma.$transaction(async (tx) => {
      await writeAudit(tx, {
        actor: { type: 'person', id: session.person.id },
        action: 'deleted',
        entity: {
          type: 'client',
          id: clientId,
          before: {
            code: client.code,
            legalName: client.legalName,
            primaryPartnerId: client.primaryPartnerId,
          },
          after: null,
        },
        source: 'web',
      });
      await tx.client.delete({ where: { id: clientId } });
    });
  } catch (err) {
    console.error('[client.delete] failed:', err);
    return { status: 'error', message: 'Delete failed — try again.' };
  }

  revalidatePath('/directory/clients');
  redirect('/directory/clients?deleted=1');
}
