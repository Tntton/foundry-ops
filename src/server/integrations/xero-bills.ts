import { prisma } from '@/server/db';
import { optionalEnv } from '@/server/env';
import { xeroRequest } from '@/server/integrations/xero';
import { ensureProjectTrackingOption } from '@/server/integrations/xero-projects';

const TRACKING_CATEGORY_NAME = 'Projects';

type XeroLineItem = {
  Description: string;
  Quantity: number;
  UnitAmount: number;
  AccountCode?: string;
  TaxType?: string;
  Tracking?: Array<{ Name: string; Option: string }>;
};

type XeroBillContact =
  | { ContactID: string }
  | { Name: string };

type XeroBillPayload = {
  Type: 'ACCPAY';
  Contact: XeroBillContact;
  Date: string;
  DueDate: string;
  InvoiceNumber?: string;
  Reference?: string;
  LineAmountTypes: 'Inclusive';
  LineItems: XeroLineItem[];
  Status: 'DRAFT';
};

type XeroInvoiceResponse = {
  Invoices: Array<{
    InvoiceID: string;
    Status: string;
    Contact: { ContactID: string };
  }>;
};

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function humanCategory(raw: string): string {
  return raw
    .split('_')
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(' ');
}

export type BillPayloadInput = {
  supplier: { xeroContactId: string } | { name: string };
  supplierInvoiceNumber?: string | null;
  issueDate: Date;
  dueDate: Date;
  amountTotalCents: number; // inclusive of GST
  category: string;
  supplierLabel: string; // used in line description; supplier name or Person display name
  projectCode?: string | null;
  expenseAccountCode?: string | null;
};

/**
 * Pure builder for the Xero /Invoices POST body (ACCPAY / bill).
 * Bills are single-line: the Foundry Bill only stores a category + total,
 * not line-by-line detail like an AR invoice. If a project is set, the line
 * gets a tracking option so the expense shows up in project reporting.
 */
export function buildBillPayload(input: BillPayloadInput): XeroBillPayload {
  const contact: XeroBillContact =
    'xeroContactId' in input.supplier
      ? { ContactID: input.supplier.xeroContactId }
      : { Name: input.supplier.name };

  const description = `${humanCategory(input.category)} — ${input.supplierLabel}`;

  const line: XeroLineItem = {
    Description: description,
    Quantity: 1,
    UnitAmount: input.amountTotalCents / 100,
    ...(input.expenseAccountCode ? { AccountCode: input.expenseAccountCode } : {}),
    TaxType: 'INPUT',
    ...(input.projectCode
      ? { Tracking: [{ Name: TRACKING_CATEGORY_NAME, Option: input.projectCode }] }
      : {}),
  };

  return {
    Type: 'ACCPAY',
    Contact: contact,
    Date: ymd(input.issueDate),
    DueDate: ymd(input.dueDate),
    ...(input.supplierInvoiceNumber ? { InvoiceNumber: input.supplierInvoiceNumber } : {}),
    ...(input.projectCode ? { Reference: input.projectCode } : {}),
    LineAmountTypes: 'Inclusive',
    LineItems: [line],
    Status: 'DRAFT',
  };
}

/**
 * Push an approved Foundry Bill to Xero as a DRAFT ACCPAY invoice.
 * Idempotent on Bill.xeroBillId.
 */
export async function pushBillToXero(billId: string): Promise<string> {
  const bill = await prisma.bill.findUniqueOrThrow({
    where: { id: billId },
    include: {
      project: { select: { id: true, code: true, xeroTrackingCategoryValue: true } },
    },
  });
  const supplierPerson = bill.supplierPersonId
    ? await prisma.person.findUnique({
        where: { id: bill.supplierPersonId },
        select: { xeroContactId: true, firstName: true, lastName: true },
      })
    : null;

  if (bill.status !== 'approved' && bill.status !== 'scheduled_for_payment' && bill.status !== 'paid') {
    throw new Error(
      `Bill ${bill.id} is ${bill.status}; only approved bills can be pushed to Xero.`,
    );
  }

  // Ensure project tracking option exists if we're going to reference it.
  if (bill.project && !bill.project.xeroTrackingCategoryValue) {
    await ensureProjectTrackingOption(bill.project.id);
  }

  const supplier: BillPayloadInput['supplier'] = supplierPerson?.xeroContactId
    ? { xeroContactId: supplierPerson.xeroContactId }
    : { name: supplierPerson ? `${supplierPerson.firstName} ${supplierPerson.lastName}` : bill.supplierName ?? 'Supplier' };

  const supplierLabel = supplierPerson
    ? `${supplierPerson.firstName} ${supplierPerson.lastName}`
    : bill.supplierName ?? 'Supplier';

  const expenseAccount = optionalEnv('XERO_EXPENSE_ACCOUNT_CODE');

  const payload = buildBillPayload({
    supplier,
    supplierInvoiceNumber: bill.supplierInvoiceNumber,
    issueDate: bill.issueDate,
    dueDate: bill.dueDate,
    amountTotalCents: bill.amountTotal,
    category: bill.category,
    supplierLabel,
    projectCode: bill.project?.code ?? null,
    expenseAccountCode: expenseAccount ?? null,
  });

  const body = bill.xeroBillId
    ? { Invoices: [{ ...payload, InvoiceID: bill.xeroBillId }] }
    : { Invoices: [payload] };

  const res = await xeroRequest<XeroInvoiceResponse>('POST', '/api.xro/2.0/Invoices', body);
  const created = res.Invoices[0];
  if (!created) throw new Error('Xero returned no invoice');

  if (bill.xeroBillId !== created.InvoiceID) {
    await prisma.bill.update({
      where: { id: bill.id },
      data: { xeroBillId: created.InvoiceID },
    });
  }
  return created.InvoiceID;
}
