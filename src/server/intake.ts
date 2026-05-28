import { prisma } from '@/server/db';

/**
 * Derive a display filename for an intake bill. Preferred order:
 *   1. Last path segment of `attachmentSharepointUrl` when it's a real URL
 *      (https://… or sharepoint:… or pending-upload:…)
 *   2. Synthetic `<Supplier>-<InvoiceNumber>.pdf` so the queue isn't full of
 *      'untitled'. Used for inline data URLs (where the URL itself is the
 *      file body and has no useful path segment).
 */
function deriveFileName(b: {
  attachmentSharepointUrl: string | null;
  supplierName: string | null;
  supplierInvoiceNumber: string | null;
  id: string;
}): string {
  const url = b.attachmentSharepointUrl ?? '';
  const synthetic = `${b.supplierName ?? 'untitled'}-${b.supplierInvoiceNumber ?? b.id.slice(0, 6)}.pdf`;
  if (url.startsWith('data:') || url === '') return synthetic;
  const segment = url.split('/').pop();
  return segment && segment.length > 0 ? segment : synthetic;
}

export type IntakeBillStatus = 'reviewing' | 'needs_match' | 'auto_categ' | 'unknown';

export type IntakeQueueRow = {
  id: string;
  fileName: string;
  status: IntakeBillStatus;
  amountTotalCents: number;
  projectCode: string | null;
  category: string;
  supplierName: string | null;
  receivedVia: string;
  createdAt: Date;
};

/**
 * Bills in the intake queue — `pending_review` only. Sort newest first.
 * The intake "status" badge is derived: needs_match when there's no
 * projectId on a non-OPEX bill, auto_categ when the category is set but
 * still pending review, reviewing for everything else.
 *
 * Excludes bills that already have a pending Approval row — once a bill
 * has been "Approve & post"-ed, it lives in the AP approval queue, not
 * the intake one. Without this filter the user sees their just-posted
 * bill still here and clicking the button again hits a duplicate error.
 */
export async function listIntakeBills(): Promise<IntakeQueueRow[]> {
  const submittedIds = await prisma.approval.findMany({
    where: { subjectType: 'bill', status: 'pending' },
    select: { subjectId: true },
  });
  const submittedSet = new Set(submittedIds.map((a) => a.subjectId));
  const bills = await prisma.bill.findMany({
    where: {
      status: 'pending_review',
      ...(submittedSet.size > 0
        ? { id: { notIn: Array.from(submittedSet) } }
        : {}),
    },
    orderBy: [{ createdAt: 'desc' }],
    select: {
      id: true,
      supplierName: true,
      supplierInvoiceNumber: true,
      attachmentSharepointUrl: true,
      receivedVia: true,
      amountTotal: true,
      category: true,
      projectId: true,
      createdAt: true,
      project: { select: { code: true } },
    },
  });

  return bills.map((b) => {
    const isOpex = b.category.toLowerCase().includes('opex') || !b.projectId;
    let status: IntakeBillStatus;
    if (!b.projectId && !isOpex) status = 'needs_match';
    else if (b.projectId) status = 'reviewing';
    else status = 'auto_categ';
    const fileName = deriveFileName(b);
    return {
      id: b.id,
      fileName,
      status,
      amountTotalCents: b.amountTotal,
      projectCode: b.project?.code ?? null,
      category: b.category,
      supplierName: b.supplierName,
      receivedVia: b.receivedVia,
      createdAt: b.createdAt,
    };
  });
}

export type IntakeFieldConfidence =
  | { state: 'high'; pct: number }
  | { state: 'medium'; pct: number }
  | { state: 'inferred'; pct: number; note?: string }
  | { state: 'missing' }
  | { state: 'auto_matched' }
  | { state: 'suggested' };

export type IntakeBill = {
  id: string;
  fileName: string;
  attachmentSharepointUrl: string | null;
  receivedVia: string;
  supplierPersonId: string | null;
  supplierName: string | null;
  supplierInvoiceNumber: string | null;
  issueDate: Date;
  dueDate: Date;
  amountTotalCents: number;
  gstCents: number;
  category: string;
  projectId: string | null;
  projectCode: string | null;
  projectName: string | null;
  /** Person the cost is attributed to for utilisation reporting —
   *  e.g. the traveller on a Navan-imported flight. Null for OPEX
   *  bills where no one in particular triggered the cost. */
  attributedToPersonId: string | null;
  attributedToName: string | null;
  status: 'pending_review' | 'approved' | 'rejected' | 'scheduled_for_payment' | 'paid';
  ocrConfidence: number; // overall, 0-100
  fields: {
    supplier: IntakeFieldConfidence;
    abn: IntakeFieldConfidence; // not stored on Bill but derived from supplier-person record if linked
    invoiceNumber: IntakeFieldConfidence;
    issueDate: IntakeFieldConfidence;
    dueDate: IntakeFieldConfidence;
    amount: IntakeFieldConfidence;
    gst: IntakeFieldConfidence;
    project: IntakeFieldConfidence;
    category: IntakeFieldConfidence;
  };
};

/**
 * Build the review payload for one bill. Confidence values are derived from
 * data quality heuristics (presence, format, GST=10%-of-net check, etc.) —
 * acts as a stand-in until the OCR agent ships extraction confidence as
 * structured fields. Real values would feed in via the Bill row's
 * extension JSON column once the agent lands.
 */
export async function getIntakeBill(billId: string): Promise<IntakeBill | null> {
  const b = await prisma.bill.findUnique({
    where: { id: billId },
    include: {
      project: { select: { id: true, code: true, name: true } },
      attributedTo: { select: { id: true, firstName: true, lastName: true } },
    },
  });
  if (!b) return null;
  const supplierPerson = b.supplierPersonId
    ? await prisma.person.findUnique({
        where: { id: b.supplierPersonId },
        select: { id: true, firstName: true, lastName: true, xeroContactId: true },
      })
    : null;

  const fileName = deriveFileName(b);

  const supplier: IntakeFieldConfidence = b.supplierName
    ? { state: 'high', pct: 96 }
    : { state: 'missing' };
  const abn: IntakeFieldConfidence = supplierPerson?.xeroContactId
    ? { state: 'high', pct: 99 }
    : { state: 'missing' };
  const invoiceNumber: IntakeFieldConfidence = b.supplierInvoiceNumber
    ? { state: 'high', pct: 99 }
    : { state: 'missing' };
  const issueDate: IntakeFieldConfidence = { state: 'high', pct: 95 };
  // Inferred when due is exactly issue + 30 days (the default we stamp on
  // auto-bills) — flag so the reviewer sanity-checks against the PDF.
  const due30 =
    Math.round((b.dueDate.getTime() - b.issueDate.getTime()) / 86_400_000) ===
    30;
  const dueDate: IntakeFieldConfidence = due30
    ? { state: 'inferred', pct: 65, note: '30 days from invoice date' }
    : { state: 'high', pct: 95 };
  const amount: IntakeFieldConfidence = { state: 'high', pct: 99 };
  // GST is 10% of (total - gst) — flag if missing or off.
  const expectedGst = Math.round((b.amountTotal - b.gst) * 0.1);
  const gstClose = Math.abs(expectedGst - b.gst) <= 1;
  const gst: IntakeFieldConfidence =
    b.gst === 0
      ? { state: 'missing' }
      : gstClose
        ? { state: 'high', pct: 99 }
        : { state: 'medium', pct: 70 };
  const project: IntakeFieldConfidence = b.projectId
    ? { state: 'auto_matched' }
    : { state: 'missing' };
  const category: IntakeFieldConfidence = b.category
    ? { state: 'suggested' }
    : { state: 'missing' };

  // Roll-up confidence — average of all field % scores, fallback to 0 for
  // missing/auto_matched/suggested. Capped at 99.
  const numeric = [
    supplier,
    abn,
    invoiceNumber,
    issueDate,
    dueDate,
    amount,
    gst,
  ]
    .map((f) => ('pct' in f ? f.pct : 0))
    .filter((p) => p > 0);
  const ocrConfidence =
    numeric.length === 0
      ? 0
      : Math.min(99, Math.round(numeric.reduce((s, p) => s + p, 0) / numeric.length));

  return {
    id: b.id,
    fileName,
    attachmentSharepointUrl: b.attachmentSharepointUrl,
    receivedVia: b.receivedVia,
    supplierPersonId: b.supplierPersonId,
    supplierName: b.supplierName,
    supplierInvoiceNumber: b.supplierInvoiceNumber,
    issueDate: b.issueDate,
    dueDate: b.dueDate,
    amountTotalCents: b.amountTotal,
    gstCents: b.gst,
    category: b.category,
    projectId: b.projectId,
    projectCode: b.project?.code ?? null,
    projectName: b.project?.name ?? null,
    attributedToPersonId: b.attributedToPersonId,
    attributedToName: b.attributedTo
      ? `${b.attributedTo.firstName} ${b.attributedTo.lastName}`
      : null,
    status: b.status,
    ocrConfidence,
    fields: {
      supplier,
      abn,
      invoiceNumber,
      issueDate,
      dueDate,
      amount,
      gst,
      project,
      category,
    },
  };
}
