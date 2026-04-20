'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/server/db';
import { getSession } from '@/server/session';
import { requireCapability } from '@/server/capabilities';
import { writeAudit } from '@/server/audit';
import { getXeroIntegration } from '@/server/integrations/xero';
import { pushBillToXero } from '@/server/integrations/xero-bills';

export type BillXeroPushState =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | { status: 'success'; message: string };

export async function pushBillXero(
  billId: string,
  _prev: BillXeroPushState,
  _formData: FormData,
): Promise<BillXeroPushState> {
  const session = await getSession();
  try {
    requireCapability(session, 'bill.approve');
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
    const xeroBillId = await pushBillToXero(billId);
    await prisma.$transaction(async (tx) => {
      await writeAudit(tx, {
        actor: { type: 'person', id: session.person.id },
        action: 'xero_pushed',
        entity: {
          type: 'bill',
          id: billId,
          after: { xeroBillId },
        },
        source: 'web',
      });
    });
    revalidatePath(`/bills/${billId}`);
    return {
      status: 'success',
      message: `Pushed to Xero (${xeroBillId.slice(0, 8)}…).`,
    };
  } catch (err) {
    console.error('[bill.xero-push] failed:', err);
    return {
      status: 'error',
      message: `Push failed: ${(err as Error).message}`,
    };
  }
}
