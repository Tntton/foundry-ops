'use server';

import { revalidatePath } from 'next/cache';
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
