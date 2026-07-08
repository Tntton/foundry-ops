'use server';

import { randomBytes } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { getSession } from '@/server/session';
import { requireCapability } from '@/server/capabilities';
import { writeAudit } from '@/server/audit';
import { notifyApproversOfNewApproval } from '@/server/user-updates';
import { resolveRequiredRole } from '@/server/approval-policies';
import { EXPENSE_CATEGORY_VALUES } from '@/lib/expense-categories';
import { uploadReceiptToSharePoint } from '@/server/integrations/sharepoint-receipts';

// Receipt-attachment limits — mirrors the /bills/intake dropzone.
// 20MB is a generous ceiling (Foundry's biggest receipt to date is a
// 6MB scanned travel bundle) and comfortably under Vercel's request
// body limit on the Pro plan. Types match extensionFromMime in the
// uploader.
const MAX_RECEIPT_BYTES = 20 * 1024 * 1024;
const ALLOWED_RECEIPT_MIME = new Set([
  'application/pdf',
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/heic',
  'image/heif',
]);

// Bills + expenses both post into Xero as expense lines, so they share
// one canonical category list (see src/lib/expense-categories.ts) that
// matches the AU starter chart of accounts + ATO Income Tax Assessment
// Act 1997 deductibility splits.
const EXPENSE_CATEGORIES = EXPENSE_CATEGORY_VALUES;

const ExpenseCreate = z
  .object({
    projectId: z.string().optional().nullable(),
    date: z.coerce.date(),
    amountDollars: z.coerce.number().min(0.01).max(100_000),
    gstDollars: z.coerce.number().min(0).max(100_000),
    category: z.enum(EXPENSE_CATEGORIES),
    vendor: z.string().trim().max(200).optional().nullable(),
    description: z.string().trim().max(1000).optional().nullable(),
  })
  .refine((v) => v.gstDollars <= v.amountDollars, {
    message: 'GST cannot exceed total',
    path: ['gstDollars'],
  });

export type NewExpenseState =
  | { status: 'idle' }
  | { status: 'error'; message: string; fieldErrors?: Record<string, string> };

export async function submitExpense(
  _prev: NewExpenseState,
  formData: FormData,
): Promise<NewExpenseState> {
  const session = await getSession();
  try {
    requireCapability(session, 'expense.submit');
  } catch {
    return { status: 'error', message: 'Not authorized' };
  }

  const raw = {
    projectId: formData.get('projectId') || null,
    date: formData.get('date'),
    amountDollars: formData.get('amountDollars'),
    gstDollars: formData.get('gstDollars'),
    category: formData.get('category'),
    vendor: formData.get('vendor') || null,
    description: formData.get('description') || null,
  };

  const parsed = ExpenseCreate.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path.join('.');
      if (!fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return { status: 'error', message: 'Please fix the highlighted fields.', fieldErrors };
  }

  // Pre-validate the receipt file (if attached) BEFORE opening the
  // transaction. Uploading to SharePoint happens inside the tx path
  // below so we can capture the URL + drive-item id on the Expense row
  // atomically with the Approval + audit.
  const receiptFile = formData.get('receipt');
  let receiptCheck: { file: File; mimeType: string } | null = null;
  if (receiptFile instanceof File && receiptFile.size > 0) {
    if (receiptFile.size > MAX_RECEIPT_BYTES) {
      return {
        status: 'error',
        message: 'Receipt too large — max 20MB. Try compressing or splitting the file.',
        fieldErrors: { receipt: 'File exceeds 20MB limit.' },
      };
    }
    const mimeType = receiptFile.type || 'application/octet-stream';
    if (!ALLOWED_RECEIPT_MIME.has(mimeType.toLowerCase())) {
      return {
        status: 'error',
        message: 'Receipt format not accepted — use PDF, JPG, PNG, GIF, WEBP, or HEIC.',
        fieldErrors: { receipt: `Unsupported type: ${mimeType}` },
      };
    }
    receiptCheck = { file: receiptFile, mimeType };
  }

  const data = parsed.data;
  const amountCents = Math.round(data.amountDollars * 100);
  const gstCents = Math.round(data.gstDollars * 100);
  const requiredRole = await resolveRequiredRole('expense', amountCents);
  const projectId =
    data.projectId && data.projectId !== '' ? data.projectId : null;

  // If the expense is tagged to a project that defaults to pass-through
  // billing (T&M / cost-plus contracts), seed `rebillable=true` so the
  // line surfaces in the Payables / Reimbursables "rebillable" float
  // automatically. Reviewer can still untoggle per row.
  let rebillableDefault = false;
  if (projectId) {
    const proj = await prisma.project.findUnique({
      where: { id: projectId },
      select: { defaultExpensesRebillable: true },
    });
    rebillableDefault = proj?.defaultExpensesRebillable ?? false;
  }

  // If a receipt was attached, upload it to SharePoint BEFORE opening
  // the Expense transaction. If Graph is down, the upload is a soft
  // failure — the expense still lands without a receipt link, and a
  // warning surfaces in the audit event. This trades atomicity for
  // resilience: better to have an approvable Expense with a missing
  // receipt (which owner can attach later on /expenses/[id]) than to
  // block the whole submission on a SharePoint outage.
  //
  // Filename uses a random shortId (not the Expense.id) so the upload
  // can complete before the row is created; the Expense.id + shortId
  // are cross-referenced through the AuditEvent delta.
  let uploadedReceiptUrl: string | null = null;
  let uploadedReceiptDriveItemId: string | null = null;
  let receiptFilename: string | null = null;
  let uploadWarning: string | null = null;
  if (receiptCheck) {
    try {
      const buffer = Buffer.from(await receiptCheck.file.arrayBuffer());
      const shortId = randomBytes(4).toString('hex');
      const upload = await uploadReceiptToSharePoint({
        kind: 'expense',
        date: data.date,
        vendor: data.vendor,
        amountCents,
        ownerInitials: session.person.initials,
        id: shortId,
        buffer,
        mimeType: receiptCheck.mimeType,
        originalFilename: receiptCheck.file.name,
      });
      if (upload) {
        uploadedReceiptUrl = upload.webUrl;
        uploadedReceiptDriveItemId = upload.driveItemId;
        receiptFilename = upload.filename;
      } else {
        uploadWarning =
          'SharePoint not configured — expense saved without a receipt link. Set SHAREPOINT_SITE_URL to enable receipt archiving.';
      }
    } catch (err) {
      console.error('[expense.submit] receipt upload failed:', err);
      uploadWarning = `Receipt upload failed: ${(err as Error).message.slice(0, 120)}. Expense saved without a receipt — attach later from the detail page.`;
    }
  }

  let createdExpenseId: string | null = null;
  try {
    await prisma.$transaction(async (tx) => {
      const expense = await tx.expense.create({
        data: {
          personId: session.person.id,
          projectId,
          date: data.date,
          amount: amountCents,
          gst: gstCents,
          category: data.category,
          vendor: data.vendor,
          description: data.description,
          status: 'submitted',
          rebillable: rebillableDefault,
          receiptSharepointUrl: uploadedReceiptUrl,
          receiptDriveItemId: uploadedReceiptDriveItemId,
        },
      });
      const approval = await tx.approval.create({
        data: {
          subjectType: 'expense',
          subjectId: expense.id,
          requestedById: session.person.id,
          requiredRole,
          thresholdContext: {
            amount_cents: amountCents,
            threshold_cents: 200_000,
          },
          channel: 'web',
        },
        select: { id: true },
      });
      // Notify the approver pool so they don't have to refresh
      // /approvals to see new work landing.
      await notifyApproversOfNewApproval(tx, {
        approvalId: approval.id,
        subjectType: 'expense',
        subjectId: expense.id,
        requiredRole,
        requestedById: session.person.id,
        amountCents,
        summary: `${data.vendor ?? 'Expense'} · $${(amountCents / 100).toFixed(0)}`,
      });
      await writeAudit(tx, {
        actor: { type: 'person', id: session.person.id },
        action: 'submitted',
        entity: {
          type: 'expense',
          id: expense.id,
          after: {
            projectId: expense.projectId,
            amount: expense.amount,
            gst: expense.gst,
            category: expense.category,
            vendor: expense.vendor,
            status: expense.status,
            receipt: uploadedReceiptUrl
              ? {
                  filename: receiptFilename,
                  driveItemId: uploadedReceiptDriveItemId,
                  webUrl: uploadedReceiptUrl,
                }
              : uploadWarning
                ? { attempted: true, warning: uploadWarning }
                : { attempted: false },
          },
        },
        source: 'web',
      });
      createdExpenseId = expense.id;
    });
  } catch (err) {
    console.error('[expense.submit] failed:', err);
    return { status: 'error', message: 'Submit failed — try again.' };
  }

  revalidatePath('/expenses');
  revalidatePath('/approvals');
  // ?submitted= drives the green confirmation banner on the list page
  // — a bare redirect gave no feedback that the expense landed.
  redirect(
    createdExpenseId ? `/expenses?submitted=${createdExpenseId}` : '/expenses',
  );
}
