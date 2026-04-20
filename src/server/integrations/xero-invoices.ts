import { prisma } from '@/server/db';
import { optionalEnv } from '@/server/env';
import { xeroRequest } from '@/server/integrations/xero';
import { syncClientToXero } from '@/server/integrations/xero-contacts';
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

type XeroInvoicePayload = {
  Type: 'ACCREC';
  Contact: { ContactID: string };
  Date: string; // YYYY-MM-DD
  DueDate: string;
  InvoiceNumber?: string;
  Reference?: string;
  LineAmountTypes: 'Exclusive';
  LineItems: XeroLineItem[];
  Status: 'DRAFT';
};

type XeroInvoiceResponse = {
  Invoices: Array<{
    InvoiceID: string;
    InvoiceNumber: string;
    Status: string;
  }>;
};

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export type InvoicePayloadInput = {
  invoiceNumber: string;
  issueDate: Date;
  dueDate: Date;
  projectCode: string;
  contactId: string;
  lineItems: Array<{ label: string; amountCents: number }>;
  salesAccountCode?: string;
};

/**
 * Pure builder for the Xero /Invoices POST body. Broken out from the network
 * path so we can unit-test payload shape without mocking the Xero client.
 */
export function buildInvoicePayload(input: InvoicePayloadInput): XeroInvoicePayload {
  return {
    Type: 'ACCREC',
    Contact: { ContactID: input.contactId },
    Date: ymd(input.issueDate),
    DueDate: ymd(input.dueDate),
    InvoiceNumber: input.invoiceNumber,
    Reference: input.projectCode,
    LineAmountTypes: 'Exclusive',
    LineItems: input.lineItems.map((l) => ({
      Description: l.label,
      Quantity: 1,
      UnitAmount: l.amountCents / 100,
      ...(input.salesAccountCode ? { AccountCode: input.salesAccountCode } : {}),
      TaxType: 'OUTPUT',
      Tracking: [{ Name: TRACKING_CATEGORY_NAME, Option: input.projectCode }],
    })),
    Status: 'DRAFT',
  };
}

/**
 * Push an approved Foundry invoice to Xero as a DRAFT ACCREC invoice.
 * Idempotent on Invoice.xeroInvoiceId: re-running updates the existing Xero
 * invoice rather than creating a duplicate.
 *
 * Auto-ensures Xero prerequisites:
 *   - Client has xeroContactId (creates contact if missing)
 *   - Project has xeroTrackingCategoryValue (creates option if missing)
 */
export async function pushInvoiceToXero(invoiceId: string): Promise<string> {
  const invoice = await prisma.invoice.findUniqueOrThrow({
    where: { id: invoiceId },
    include: {
      lineItems: { orderBy: { id: 'asc' } },
      client: { select: { id: true, xeroContactId: true } },
      project: { select: { id: true, code: true, xeroTrackingCategoryValue: true } },
    },
  });

  if (invoice.status !== 'approved' && invoice.status !== 'sent' && invoice.status !== 'partial') {
    throw new Error(
      `Invoice ${invoice.number} is ${invoice.status}; only approved invoices can be pushed to Xero.`,
    );
  }
  if (invoice.lineItems.length === 0) {
    throw new Error(`Invoice ${invoice.number} has no line items.`);
  }

  const contactId = invoice.client.xeroContactId ?? (await syncClientToXero(invoice.client.id));
  if (!invoice.project.xeroTrackingCategoryValue) {
    await ensureProjectTrackingOption(invoice.project.id);
  }

  const salesAccount = optionalEnv('XERO_SALES_ACCOUNT_CODE');
  const payload = buildInvoicePayload({
    invoiceNumber: invoice.number,
    issueDate: invoice.issueDate,
    dueDate: invoice.dueDate,
    projectCode: invoice.project.code,
    contactId,
    lineItems: invoice.lineItems.map((l) => ({ label: l.label, amountCents: l.amount })),
    ...(salesAccount ? { salesAccountCode: salesAccount } : {}),
  });

  const body = invoice.xeroInvoiceId
    ? { Invoices: [{ ...payload, InvoiceID: invoice.xeroInvoiceId }] }
    : { Invoices: [payload] };

  const res = await xeroRequest<XeroInvoiceResponse>('POST', '/api.xro/2.0/Invoices', body);
  const created = res.Invoices[0];
  if (!created) throw new Error('Xero returned no invoice');

  if (invoice.xeroInvoiceId !== created.InvoiceID) {
    await prisma.invoice.update({
      where: { id: invoice.id },
      data: { xeroInvoiceId: created.InvoiceID },
    });
  }
  return created.InvoiceID;
}
