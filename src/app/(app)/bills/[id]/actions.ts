'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
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

export type BillDeleteState =
  | { status: 'idle' }
  | { status: 'error'; message: string };

/**
 * Delete a pre-approval (pending_review) bill. Once approved the bill has
 * been pushed to Xero and possibly batched for payment — void there instead.
 */
export async function deleteDraftBill(
  billId: string,
  _prev: BillDeleteState,
  _formData: FormData,
): Promise<BillDeleteState> {
  const session = await getSession();
  try {
    requireCapability(session, 'bill.delete_draft');
  } catch {
    return { status: 'error', message: 'Not authorized' };
  }

  const bill = await prisma.bill.findUnique({
    where: { id: billId },
    select: {
      id: true,
      status: true,
      amountTotal: true,
      supplierName: true,
      supplierInvoiceNumber: true,
    },
  });
  if (!bill) return { status: 'error', message: 'Bill not found' };

  if (bill.status !== 'pending_review') {
    return {
      status: 'error',
      message: `Can't delete — bill is ${bill.status}. Void it in Xero instead.`,
    };
  }

  try {
    await prisma.$transaction(async (tx) => {
      await writeAudit(tx, {
        actor: { type: 'person', id: session.person.id },
        action: 'deleted',
        entity: {
          type: 'bill',
          id: bill.id,
          before: {
            supplierName: bill.supplierName,
            supplierInvoiceNumber: bill.supplierInvoiceNumber,
            status: bill.status,
            amountTotal: bill.amountTotal,
          },
          after: null,
        },
        source: 'web',
      });
      // Clear any pending approval row (no FK, would orphan otherwise).
      await tx.approval.deleteMany({
        where: { subjectType: 'bill', subjectId: bill.id },
      });
      await tx.bill.delete({ where: { id: bill.id } });
    });
  } catch (err) {
    console.error('[bill.delete_draft] failed:', err);
    return { status: 'error', message: 'Delete failed — try again.' };
  }

  revalidatePath('/bills');
  redirect('/bills?deleted=1');
}
