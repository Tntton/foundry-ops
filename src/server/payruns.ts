import type { PayRunStatus, PayRunType } from '@prisma/client';
import { prisma } from '@/server/db';

export type PayRunListRow = {
  id: string;
  type: PayRunType;
  status: PayRunStatus;
  periodStart: Date;
  periodEnd: Date;
  totalCents: number;
  lineCount: number;
  billCount: number;
  approvedAt: Date | null;
  createdAt: Date;
};

export async function listPayRuns(): Promise<PayRunListRow[]> {
  const payRuns = await prisma.payRun.findMany({
    orderBy: [{ createdAt: 'desc' }],
    include: {
      lineItems: { select: { amount: true } },
      bills: { select: { id: true } },
    },
  });
  return payRuns.map((p) => ({
    id: p.id,
    type: p.type,
    status: p.status,
    periodStart: p.periodStart,
    periodEnd: p.periodEnd,
    totalCents: p.lineItems.reduce((s, l) => s + l.amount, 0),
    lineCount: p.lineItems.length,
    billCount: p.bills.length,
    approvedAt: p.approvedAt,
    createdAt: p.createdAt,
  }));
}

export type PayRunDetail = {
  id: string;
  type: PayRunType;
  status: PayRunStatus;
  periodStart: Date;
  periodEnd: Date;
  totalCents: number;
  approvedAt: Date | null;
  approvedBy: { initials: string; firstName: string; lastName: string } | null;
  createdAt: Date;
  lines: Array<{
    id: string;
    amountCents: number;
    bsb: string;
    acc: string;
    reference: string;
    bill: {
      id: string;
      supplierName: string;
      supplierInvoiceNumber: string | null;
      category: string;
    } | null;
    person: {
      id: string;
      initials: string;
      firstName: string;
      lastName: string;
    } | null;
  }>;
  abaFileUrl: string | null;
};

export async function getPayRun(id: string): Promise<PayRunDetail | null> {
  const payRun = await prisma.payRun.findUnique({
    where: { id },
    include: {
      lineItems: {
        orderBy: { reference: 'asc' },
      },
    },
  });
  if (!payRun) return null;

  const approver = payRun.approvedById
    ? await prisma.person.findUnique({
        where: { id: payRun.approvedById },
        select: { initials: true, firstName: true, lastName: true },
      })
    : null;

  const billIds = payRun.lineItems
    .map((l) => l.billId)
    .filter((id): id is string => id !== null);
  const personIds = payRun.lineItems
    .map((l) => l.personId)
    .filter((id): id is string => id !== null);
  const [bills, people] = await Promise.all([
    billIds.length
      ? prisma.bill.findMany({
          where: { id: { in: billIds } },
          select: {
            id: true,
            supplierName: true,
            supplierInvoiceNumber: true,
            category: true,
          },
        })
      : Promise.resolve([]),
    personIds.length
      ? prisma.person.findMany({
          where: { id: { in: personIds } },
          select: { id: true, initials: true, firstName: true, lastName: true },
        })
      : Promise.resolve([]),
  ]);
  const billById = new Map(bills.map((b) => [b.id, b]));
  const personById = new Map(people.map((p) => [p.id, p]));

  return {
    id: payRun.id,
    type: payRun.type,
    status: payRun.status,
    periodStart: payRun.periodStart,
    periodEnd: payRun.periodEnd,
    totalCents: payRun.lineItems.reduce((s, l) => s + l.amount, 0),
    approvedAt: payRun.approvedAt,
    approvedBy: approver ?? null,
    createdAt: payRun.createdAt,
    abaFileUrl: payRun.abaFileUrl,
    lines: payRun.lineItems.map((l) => ({
      id: l.id,
      amountCents: l.amount,
      bsb: l.bsb,
      acc: l.acc,
      reference: l.reference,
      bill: l.billId
        ? (() => {
            const b = billById.get(l.billId);
            return b
              ? {
                  id: b.id,
                  supplierName: b.supplierName ?? 'Unnamed',
                  supplierInvoiceNumber: b.supplierInvoiceNumber,
                  category: b.category,
                }
              : null;
          })()
        : null,
      person: l.personId
        ? (() => {
            const p = personById.get(l.personId);
            return p ? p : null;
          })()
        : null,
    })),
  };
}

export type UnbatchedBill = {
  id: string;
  supplierName: string;
  supplierInvoiceNumber: string | null;
  amountTotalCents: number;
  dueDate: Date;
  category: string;
  supplierBsb: string | null;
  supplierAcc: string | null;
  supplierPersonId: string | null;
};

/**
 * List approved bills that aren't on any pay-run yet, so they can be batched.
 * For contractor-person bills we also surface whether the Person has bank
 * details on file (so the bill-picker can warn if we'd be missing BSB/acc at
 * ABA time).
 */
export async function listUnbatchedApprovedBills(): Promise<UnbatchedBill[]> {
  const bills = await prisma.bill.findMany({
    where: {
      status: 'approved',
      abaBatchId: null,
    },
    orderBy: { dueDate: 'asc' },
    select: {
      id: true,
      supplierName: true,
      supplierInvoiceNumber: true,
      amountTotal: true,
      dueDate: true,
      category: true,
      supplierPersonId: true,
    },
  });
  const personIds = bills
    .map((b) => b.supplierPersonId)
    .filter((id): id is string => id !== null);
  const people = personIds.length
    ? await prisma.person.findMany({
        where: { id: { in: personIds } },
        select: { id: true, bankBsb: true, bankAcc: true },
      })
    : [];
  const personById = new Map(people.map((p) => [p.id, p]));
  return bills.map((b) => {
    const p = b.supplierPersonId ? personById.get(b.supplierPersonId) : null;
    return {
      id: b.id,
      supplierName: b.supplierName ?? 'Unnamed',
      supplierInvoiceNumber: b.supplierInvoiceNumber,
      amountTotalCents: b.amountTotal,
      dueDate: b.dueDate,
      category: b.category,
      supplierBsb: p?.bankBsb ?? null,
      supplierAcc: p?.bankAcc ?? null,
      supplierPersonId: b.supplierPersonId,
    };
  });
}
