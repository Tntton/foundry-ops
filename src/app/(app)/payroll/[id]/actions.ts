'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { prisma } from '@/server/db';
import { getSession } from '@/server/session';
import { requireCapability } from '@/server/capabilities';
import { writeAudit } from '@/server/audit';

export type PayRunActionState =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | { status: 'success'; message: string };

export async function approvePayRun(
  payRunId: string,
  _prev: PayRunActionState,
  _formData: FormData,
): Promise<PayRunActionState> {
  const session = await getSession();
  try {
    requireCapability(session, 'payrun.approve');
  } catch {
    return { status: 'error', message: 'Not authorized' };
  }

  const payRun = await prisma.payRun.findUnique({
    where: { id: payRunId },
    include: { lineItems: { select: { id: true } } },
  });
  if (!payRun) return { status: 'error', message: 'Pay-run not found' };
  if (payRun.status !== 'draft') {
    return { status: 'error', message: `Can't approve — status is ${payRun.status}.` };
  }
  if (payRun.lineItems.length === 0) {
    return { status: 'error', message: 'Cannot approve a pay-run with zero lines.' };
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.payRun.update({
        where: { id: payRunId },
        data: {
          status: 'approved',
          approvedById: session.person.id,
          approvedAt: new Date(),
        },
      });
      await writeAudit(tx, {
        actor: { type: 'person', id: session.person.id },
        action: 'approved',
        entity: {
          type: 'pay_run',
          id: payRunId,
          before: { status: payRun.status },
          after: { status: 'approved' },
        },
        source: 'web',
      });
    });
  } catch (err) {
    console.error('[payrun.approve] failed:', err);
    return { status: 'error', message: 'Approval failed — try again.' };
  }

  revalidatePath('/payroll');
  revalidatePath(`/payroll/${payRunId}`);
  return { status: 'success', message: 'Pay-run approved.' };
}

export async function markPayRunAbaGenerated(
  payRunId: string,
  _prev: PayRunActionState,
  _formData: FormData,
): Promise<PayRunActionState> {
  const session = await getSession();
  try {
    requireCapability(session, 'payrun.approve');
  } catch {
    return { status: 'error', message: 'Not authorized' };
  }

  const payRun = await prisma.payRun.findUnique({ where: { id: payRunId } });
  if (!payRun) return { status: 'error', message: 'Pay-run not found' };
  if (payRun.status !== 'approved' && payRun.status !== 'aba_generated') {
    return {
      status: 'error',
      message: 'Generate an ABA from an approved pay-run only.',
    };
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.payRun.update({
        where: { id: payRunId },
        data: { status: 'aba_generated' },
      });
      await writeAudit(tx, {
        actor: { type: 'person', id: session.person.id },
        action: 'aba_generated',
        entity: {
          type: 'pay_run',
          id: payRunId,
          before: { status: payRun.status },
          after: { status: 'aba_generated' },
        },
        source: 'web',
      });
    });
  } catch (err) {
    console.error('[payrun.abaGenerated] failed:', err);
    return { status: 'error', message: 'Update failed.' };
  }
  revalidatePath(`/payroll/${payRunId}`);
  return { status: 'success', message: 'Marked as ABA generated.' };
}

export async function markPayRunPaid(
  payRunId: string,
  _prev: PayRunActionState,
  _formData: FormData,
): Promise<PayRunActionState> {
  const session = await getSession();
  try {
    requireCapability(session, 'payrun.approve');
  } catch {
    return { status: 'error', message: 'Not authorized' };
  }

  const payRun = await prisma.payRun.findUnique({
    where: { id: payRunId },
    include: { bills: { select: { id: true } } },
  });
  if (!payRun) return { status: 'error', message: 'Pay-run not found' };
  if (
    payRun.status !== 'approved' &&
    payRun.status !== 'aba_generated' &&
    payRun.status !== 'uploaded_to_paydotcomau'
  ) {
    return { status: 'error', message: 'Pay-run must be approved or further along.' };
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.payRun.update({
        where: { id: payRunId },
        data: { status: 'paid' },
      });
      await tx.bill.updateMany({
        where: { abaBatchId: payRunId, status: 'scheduled_for_payment' },
        data: { status: 'paid' },
      });
      await writeAudit(tx, {
        actor: { type: 'person', id: session.person.id },
        action: 'marked_paid',
        entity: {
          type: 'pay_run',
          id: payRunId,
          before: { status: payRun.status },
          after: {
            status: 'paid',
            cascadedBillCount: payRun.bills.length,
          },
        },
        source: 'web',
      });
    });
  } catch (err) {
    console.error('[payrun.markPaid] failed:', err);
    return { status: 'error', message: 'Mark-paid failed.' };
  }

  revalidatePath('/payroll');
  revalidatePath(`/payroll/${payRunId}`);
  revalidatePath('/ap');
  revalidatePath('/bills');
  return { status: 'success', message: 'Pay-run + bills marked paid.' };
}

export async function deleteDraftPayRun(
  payRunId: string,
  _prev: PayRunActionState,
  _formData: FormData,
): Promise<PayRunActionState> {
  const session = await getSession();
  try {
    requireCapability(session, 'payrun.approve');
  } catch {
    return { status: 'error', message: 'Not authorized' };
  }

  const payRun = await prisma.payRun.findUnique({
    where: { id: payRunId },
    include: { bills: { select: { id: true } } },
  });
  if (!payRun) return { status: 'error', message: 'Pay-run not found' };
  if (payRun.status !== 'draft') {
    return {
      status: 'error',
      message: `Can't delete — only draft pay-runs can be deleted. Status is ${payRun.status}.`,
    };
  }

  try {
    await prisma.$transaction(async (tx) => {
      // Un-link bills back to approved.
      await tx.bill.updateMany({
        where: { abaBatchId: payRunId },
        data: { status: 'approved', abaBatchId: null },
      });
      await writeAudit(tx, {
        actor: { type: 'person', id: session.person.id },
        action: 'deleted',
        entity: {
          type: 'pay_run',
          id: payRunId,
          before: {
            status: payRun.status,
            type: payRun.type,
            billCount: payRun.bills.length,
          },
          after: null,
        },
        source: 'web',
      });
      // Lines cascade via FK.
      await tx.payRun.delete({ where: { id: payRunId } });
    });
  } catch (err) {
    console.error('[payrun.delete] failed:', err);
    return { status: 'error', message: 'Delete failed.' };
  }

  revalidatePath('/payroll');
  revalidatePath('/bills');
  revalidatePath('/ap');
  redirect('/payroll');
}
