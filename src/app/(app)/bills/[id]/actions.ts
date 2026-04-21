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

export type BillTransitionState =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | { status: 'success'; message: string };

/**
 * Schedule an approved bill for payment. Represents "it's in the pay queue".
 * Actual ABA file export ships with TASK-100 — this is a local bookkeeping flip.
 */
export async function scheduleBillForPayment(
  billId: string,
  _prev: BillTransitionState,
  _formData: FormData,
): Promise<BillTransitionState> {
  const session = await getSession();
  try {
    requireCapability(session, 'bill.approve');
  } catch {
    return { status: 'error', message: 'Not authorized' };
  }

  const bill = await prisma.bill.findUnique({
    where: { id: billId },
    select: { id: true, status: true, supplierName: true },
  });
  if (!bill) return { status: 'error', message: 'Bill not found' };
  if (bill.status !== 'approved') {
    return {
      status: 'error',
      message: `Can't schedule — bill is ${bill.status}. Only approved bills can be scheduled.`,
    };
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.bill.update({
        where: { id: billId },
        data: { status: 'scheduled_for_payment' },
      });
      await writeAudit(tx, {
        actor: { type: 'person', id: session.person.id },
        action: 'scheduled_for_payment',
        entity: {
          type: 'bill',
          id: billId,
          before: { status: bill.status },
          after: { status: 'scheduled_for_payment' },
        },
        source: 'web',
      });
    });
  } catch (err) {
    console.error('[bill.schedule] failed:', err);
    return { status: 'error', message: 'Schedule failed — try again.' };
  }

  revalidatePath('/bills');
  revalidatePath(`/bills/${billId}`);
  revalidatePath('/ap');
  return { status: 'success', message: 'Scheduled for payment.' };
}

/**
 * Mark a bill as paid. Terminal state — no partial payments at the schema
 * level (single-line bills).
 */
export async function markBillPaid(
  billId: string,
  _prev: BillTransitionState,
  _formData: FormData,
): Promise<BillTransitionState> {
  const session = await getSession();
  try {
    requireCapability(session, 'bill.approve');
  } catch {
    return { status: 'error', message: 'Not authorized' };
  }

  const bill = await prisma.bill.findUnique({
    where: { id: billId },
    select: { id: true, status: true, supplierName: true },
  });
  if (!bill) return { status: 'error', message: 'Bill not found' };
  if (bill.status !== 'approved' && bill.status !== 'scheduled_for_payment') {
    return {
      status: 'error',
      message: `Can't mark paid — bill is ${bill.status}.`,
    };
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.bill.update({
        where: { id: billId },
        data: { status: 'paid' },
      });
      await writeAudit(tx, {
        actor: { type: 'person', id: session.person.id },
        action: 'marked_paid',
        entity: {
          type: 'bill',
          id: billId,
          before: { status: bill.status },
          after: { status: 'paid' },
        },
        source: 'web',
      });
    });
  } catch (err) {
    console.error('[bill.markPaid] failed:', err);
    return { status: 'error', message: 'Mark-paid failed — try again.' };
  }

  revalidatePath('/bills');
  revalidatePath(`/bills/${billId}`);
  revalidatePath('/ap');
  return { status: 'success', message: 'Bill marked paid.' };
}
