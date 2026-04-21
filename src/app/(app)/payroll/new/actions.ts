'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import type { PayRunType } from '@prisma/client';
import { prisma } from '@/server/db';
import { getSession } from '@/server/session';
import { requireCapability } from '@/server/capabilities';
import { writeAudit } from '@/server/audit';
import { decryptText } from '@/server/crypto';

const PayRunCreate = z.object({
  type: z.enum(['payroll', 'super', 'contractor_ap', 'supplier_ap', 'mixed']),
  periodStart: z.coerce.date(),
  periodEnd: z.coerce.date(),
  billIds: z.array(z.string().min(1)).min(1).max(200),
});

export type NewPayRunState =
  | { status: 'idle' }
  | { status: 'error'; message: string; fieldErrors?: Record<string, string> };

export async function createPayRun(
  _prev: NewPayRunState,
  formData: FormData,
): Promise<NewPayRunState> {
  const session = await getSession();
  try {
    requireCapability(session, 'payrun.create');
  } catch {
    return { status: 'error', message: 'Not authorized' };
  }

  const parsed = PayRunCreate.safeParse({
    type: formData.get('type'),
    periodStart: formData.get('periodStart'),
    periodEnd: formData.get('periodEnd'),
    billIds: formData.getAll('billIds').map(String),
  });
  if (!parsed.success) {
    return {
      status: 'error',
      message: 'Please fix the highlighted fields.',
      fieldErrors: Object.fromEntries(
        parsed.error.issues.map((i) => [i.path.join('.'), i.message]),
      ),
    };
  }

  const { type, periodStart, periodEnd, billIds } = parsed.data;
  if (periodEnd.getTime() < periodStart.getTime()) {
    return {
      status: 'error',
      message: 'Period end must be on or after period start.',
      fieldErrors: { periodEnd: 'Must be ≥ period start' },
    };
  }

  // Fetch all bills + their supplier Person bank details so we can materialise
  // PayRunLine rows with BSB/acc at create time.
  const bills = await prisma.bill.findMany({
    where: { id: { in: billIds }, status: 'approved', abaBatchId: null },
  });
  if (bills.length !== billIds.length) {
    return {
      status: 'error',
      message:
        'Some selected bills are no longer approved or are already on another pay-run. Refresh and try again.',
    };
  }

  const personIds = bills
    .map((b) => b.supplierPersonId)
    .filter((id): id is string => id !== null);
  const people = personIds.length
    ? await prisma.person.findMany({
        where: { id: { in: personIds } },
        select: { id: true, bankBsb: true, bankAcc: true, firstName: true, lastName: true },
      })
    : [];
  const personById = new Map(people.map((p) => [p.id, p]));

  // Validate every bill has a BSB/acc — external orgs must have been entered
  // with banking info, contractor-persons must have bank_bsb / bank_acc set.
  const missing: string[] = [];
  for (const bill of bills) {
    if (bill.supplierPersonId) {
      const p = personById.get(bill.supplierPersonId);
      if (!p?.bankBsb || !p?.bankAcc) {
        missing.push(
          `${p ? `${p.firstName} ${p.lastName}` : bill.supplierPersonId} (no bank details on file)`,
        );
      }
    } else {
      // External suppliers don't store bank details on the Bill; they'd need
      // to be added at approve time. For MVP we reject.
      missing.push(`${bill.supplierName ?? 'Unnamed supplier'} (external org — no bank details)`);
    }
  }
  if (missing.length > 0) {
    return {
      status: 'error',
      message:
        'Missing bank details for: ' + missing.join('; ') + '. Add them on the Person / bill first.',
    };
  }

  let newId: string;
  try {
    newId = await prisma.$transaction(async (tx) => {
      const payRun = await tx.payRun.create({
        data: {
          type: type as PayRunType,
          periodStart,
          periodEnd,
          status: 'draft',
        },
      });
      for (const bill of bills) {
        const p = bill.supplierPersonId ? personById.get(bill.supplierPersonId) : null;
        if (!p?.bankBsb || !p?.bankAcc) continue; // already validated above
        let bsbPlain: string;
        let accPlain: string;
        try {
          bsbPlain = decryptText(p.bankBsb);
          accPlain = decryptText(p.bankAcc);
        } catch (err) {
          console.error('[payrun.create] decrypt failed for personId', bill.supplierPersonId, err);
          throw new Error(
            `Could not decrypt bank details for ${p.firstName} ${p.lastName}. Re-enter on their bank details page.`,
          );
        }
        await tx.payRunLine.create({
          data: {
            payRunId: payRun.id,
            ...(bill.supplierPersonId ? { personId: bill.supplierPersonId } : {}),
            billId: bill.id,
            amount: bill.amountTotal,
            bsb: bsbPlain,
            acc: accPlain,
            reference: (bill.supplierInvoiceNumber ?? bill.id).slice(0, 18).toUpperCase(),
          },
        });
        await tx.bill.update({
          where: { id: bill.id },
          data: { status: 'scheduled_for_payment', abaBatchId: payRun.id },
        });
      }
      await writeAudit(tx, {
        actor: { type: 'person', id: session.person.id },
        action: 'created',
        entity: {
          type: 'pay_run',
          id: payRun.id,
          after: {
            type: payRun.type,
            periodStart: payRun.periodStart.toISOString(),
            periodEnd: payRun.periodEnd.toISOString(),
            billCount: bills.length,
          },
        },
        source: 'web',
      });
      return payRun.id;
    });
  } catch (err) {
    console.error('[payrun.create] failed:', err);
    return { status: 'error', message: 'Create failed — try again.' };
  }

  revalidatePath('/payroll');
  revalidatePath('/bills');
  revalidatePath('/ap');
  redirect(`/payroll/${newId}`);
}
