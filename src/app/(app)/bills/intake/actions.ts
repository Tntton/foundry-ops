'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { getSession } from '@/server/session';
import { hasAnyRole } from '@/server/roles';
import { hasCapability } from '@/server/capabilities';
import { writeAudit } from '@/server/audit';
import { notifyApproversOfNewApproval } from '@/server/user-updates';
import { resolveRequiredRole } from '@/server/approval-policies';

/**
 * The intake dropzone is shared between two cost types:
 *
 *   - kind='expense' — personal out-of-pocket spend dropped by any staff
 *     member. Creates an `Expense` row in `submitted` status and an Approval
 *     row routed by the standard expense policy. Available to anyone with
 *     `expense.submit`.
 *
 *   - kind='bill' — vendor invoice destined for AP. Creates a `Bill` row in
 *     `pending_review`; the reviewer (admin / partner) finishes fields and
 *     posts to AP queue from the review pane. Restricted to roles allowed to
 *     create bills.
 *
 * Both kinds share the same OCR pipeline below — only the persistence step
 * differs.
 */
export type IntakeKind = 'bill' | 'expense';

export type IntakeActionState =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | { status: 'success'; message: string };

const optionalDate = z
  .union([z.coerce.date(), z.literal('').transform(() => null)])
  .optional()
  .nullable();

const PatchSchema = z.object({
  // All these string fields can come in as null (the action coerces
  // empty form values to null with `|| null`). Original schema used
  // .optional().or(z.literal('').transform(() => null)) which only
  // accepts undefined-or-string, not null — caused "Validation failed
  // on projectId: Invalid input" when the OPEX (no-project) option
  // was selected.
  supplierName: z.string().trim().max(200).nullable().optional(),
  supplierInvoiceNumber: z.string().trim().max(80).nullable().optional(),
  issueDate: optionalDate,
  dueDate: optionalDate,
  amountTotalDollars: z.coerce.number().min(0).max(10_000_000).optional(),
  gstDollars: z.coerce.number().min(0).max(1_000_000).optional(),
  category: z.string().trim().max(80),
  projectId: z.string().trim().max(40).nullable().optional(),
});

function ensureCanReview(roles: string[]): boolean {
  return roles.some((r) => ['super_admin', 'admin', 'partner'].includes(r));
}

/**
 * Save edits to a bill in the intake queue. Doesn't change status — that's
 * what `approveIntakeBill` does. Used by the inline review pane's "Save
 * draft" button.
 */
export async function patchIntakeBill(
  billId: string,
  _prev: IntakeActionState,
  formData: FormData,
): Promise<IntakeActionState> {
  const session = await getSession();
  if (!session) return { status: 'error', message: 'Not signed in' };
  if (!ensureCanReview(session.person.roles))
    return { status: 'error', message: 'Not authorized' };

  const parsed = PatchSchema.safeParse({
    supplierName: formData.get('supplierName') || null,
    supplierInvoiceNumber: formData.get('supplierInvoiceNumber') || null,
    issueDate: formData.get('issueDate') || null,
    dueDate: formData.get('dueDate') || null,
    amountTotalDollars: formData.get('amountTotalDollars') ?? undefined,
    gstDollars: formData.get('gstDollars') ?? undefined,
    category: formData.get('category') ?? '',
    projectId: formData.get('projectId') || null,
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue?.path.join('.') ?? 'unknown';
    const msg = issue?.message ?? 'invalid';
    return {
      status: 'error',
      message: `Validation failed on "${path}": ${msg}`,
    };
  }

  const existing = await prisma.bill.findUnique({ where: { id: billId } });
  if (!existing) return { status: 'error', message: 'Bill not found' };

  const data = parsed.data;
  const amountTotal =
    data.amountTotalDollars !== undefined
      ? Math.round(data.amountTotalDollars * 100)
      : existing.amountTotal;
  const gst =
    data.gstDollars !== undefined ? Math.round(data.gstDollars * 100) : existing.gst;
  const issueDate = data.issueDate instanceof Date ? data.issueDate : existing.issueDate;
  const dueDate = data.dueDate instanceof Date ? data.dueDate : existing.dueDate;

  // Apply the project's rebillable contract-default when the projectId
  // is changing (newly tagged or re-tagged to a different project).
  // Untagging to OPEX clears the flag — no project to recharge against.
  const nextProjectId = data.projectId ?? null;
  let nextRebillable: boolean | undefined;
  if (nextProjectId !== existing.projectId) {
    if (nextProjectId === null) {
      nextRebillable = false;
    } else {
      const proj = await prisma.project.findUnique({
        where: { id: nextProjectId },
        select: { defaultExpensesRebillable: true },
      });
      nextRebillable = proj?.defaultExpensesRebillable ?? false;
    }
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.bill.update({
        where: { id: billId },
        data: {
          supplierName: data.supplierName ?? existing.supplierName,
          supplierInvoiceNumber:
            data.supplierInvoiceNumber ?? existing.supplierInvoiceNumber,
          issueDate,
          dueDate,
          amountTotal,
          gst,
          category: data.category || existing.category,
          projectId: nextProjectId,
          ...(nextRebillable !== undefined ? { rebillable: nextRebillable } : {}),
        },
      });
      await writeAudit(tx, {
        actor: { type: 'person', id: session.person.id },
        action: 'updated',
        entity: {
          type: 'bill',
          id: billId,
          before: {
            supplierName: existing.supplierName,
            supplierInvoiceNumber: existing.supplierInvoiceNumber,
            amountTotal: existing.amountTotal,
            gst: existing.gst,
            category: existing.category,
            projectId: existing.projectId,
            issueDate: existing.issueDate.toISOString(),
            dueDate: existing.dueDate.toISOString(),
          },
          after: {
            supplierName: data.supplierName ?? existing.supplierName,
            supplierInvoiceNumber:
              data.supplierInvoiceNumber ?? existing.supplierInvoiceNumber,
            amountTotal,
            gst,
            category: data.category || existing.category,
            projectId: data.projectId ?? null,
            issueDate: issueDate.toISOString(),
            dueDate: dueDate.toISOString(),
            via: 'intake_review',
          },
        },
        source: 'web',
      });
    });
  } catch (err) {
    console.error('[intake.patch] failed:', err);
    return { status: 'error', message: 'Save failed — try again.' };
  }

  revalidatePath('/bills');
  revalidatePath('/bills/intake');
  return { status: 'success', message: 'Draft saved.' };
}

/**
 * Save edits + transition the bill out of intake. The bill goes through the
 * normal AP approval queue: status flips to `pending_review` (it is already)
 * and we create an Approval row routed to super_admin (per default policy).
 * Once the Approval is decided, the existing /approvals flow flips status
 * to `approved` and the bill becomes pay-run-ready.
 */
export async function approveIntakeBill(
  billId: string,
  _prev: IntakeActionState,
  formData: FormData,
): Promise<IntakeActionState> {
  const patchResult = await patchIntakeBill(billId, { status: 'idle' }, formData);
  if (patchResult.status === 'error') return patchResult;

  const session = await getSession();
  if (!session) return { status: 'error', message: 'Not signed in' };

  const bill = await prisma.bill.findUnique({
    where: { id: billId },
    select: {
      id: true,
      amountTotal: true,
      supplierName: true,
      projectId: true,
      category: true,
    },
  });
  if (!bill) return { status: 'error', message: 'Bill not found' };

  // Idempotent path: if there's already a pending approval (or the bill
  // has been decided on), don't error out — just redirect to the success
  // page. This prevents the "second-click" UX where the user clicks
  // Approve & post twice and sees a red banner on what's effectively
  // already-submitted work.
  const existingApproval = await prisma.approval.findFirst({
    where: { subjectType: 'bill', subjectId: bill.id, status: 'pending' },
  });
  if (existingApproval) {
    redirect(`/bills/intake?posted=${billId}`);
  }

  const requiredRole = await resolveRequiredRole('bill', bill.amountTotal);

  try {
    await prisma.$transaction(async (tx) => {
      const approval = await tx.approval.create({
        data: {
          subjectType: 'bill',
          subjectId: bill.id,
          requestedById: session.person.id,
          requiredRole,
          thresholdContext: {
            amount_total_cents: bill.amountTotal,
          },
          channel: 'web',
        },
        select: { id: true },
      });
      await notifyApproversOfNewApproval(tx, {
        approvalId: approval.id,
        subjectType: 'bill',
        subjectId: bill.id,
        requiredRole,
        requestedById: session.person.id,
        amountCents: bill.amountTotal,
        summary: `${bill.supplierName ?? 'Vendor'} · $${(bill.amountTotal / 100).toFixed(0)}`,
      });
      await writeAudit(tx, {
        actor: { type: 'person', id: session.person.id },
        action: 'submitted_for_approval',
        entity: {
          type: 'bill',
          id: bill.id,
          after: {
            supplierName: bill.supplierName,
            amountTotal: bill.amountTotal,
            requiredRole,
            via: 'intake_approve_post',
          },
        },
        source: 'web',
      });
    });
  } catch (err) {
    console.error('[intake.approve] failed to queue approval:', err);
    return { status: 'error', message: 'Submit failed — try again.' };
  }

  revalidatePath('/bills');
  revalidatePath('/bills/intake');
  revalidatePath('/approvals');
  redirect(`/bills/intake?posted=${billId}`);
}

/**
 * Skip the current bill — leaves it in pending_review but moves the user on.
 * Implemented as a server action so the user lands on the next-bill URL
 * cleanly without client-side state. Lightweight for now: just redirects.
 */
const SkipSchema = z.object({ nextId: z.string().min(1).optional() });

export async function skipIntakeBill(
  _prev: IntakeActionState,
  formData: FormData,
): Promise<IntakeActionState> {
  const parsed = SkipSchema.safeParse({ nextId: formData.get('nextId') });
  if (!parsed.success) return { status: 'error', message: 'Invalid input' };
  if (parsed.data.nextId) {
    redirect(`/bills/intake?id=${parsed.data.nextId}`);
  }
  redirect('/bills/intake');
}

/**
 * Create a placeholder Bill in `pending_review` from a stub upload. Real OCR
 * arrives via TASK-080 (AP intake agent — claude-sonnet structured
 * extraction). For now we accept the file metadata, create a Bill row with
 * empty fields, and surface it in the intake queue for manual completion.
 */
// Both supplier name and amount are optional pre-fills — the user can drop a
// PDF / photo with nothing else and the OCR agent fills the gaps. Schema is
// strict-after-clean: we coerce empty strings to null in code, then validate
// real values. Avoids the brittle `.optional().or(z.literal(''))` chain that
// was flagging "invalid input" when fields were blank.
const PlaceholderSchema = z.object({
  fileName: z.string().trim().min(1).max(200),
  supplierName: z.string().trim().min(1).max(200).nullable(),
  amountTotalDollars: z.number().min(0).max(10_000_000).nullable(),
  fileBase64: z.string().nullable(),
  fileMime: z.string().nullable(),
});

function cleanString(v: FormDataEntryValue | null): string | null {
  if (typeof v !== 'string') return null;
  const trimmed = v.trim();
  return trimmed === '' ? null : trimmed;
}

function cleanNumber(v: FormDataEntryValue | null): number | null {
  if (typeof v !== 'string') return null;
  const trimmed = v.trim();
  if (trimmed === '') return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

export type IntakeUploadResult =
  | {
      ok: true;
      kind: IntakeKind;
      /** Bill.id when kind='bill', Expense.id when kind='expense' */
      subjectId: string;
      /** Back-compat alias of subjectId — older callers expect `billId`. */
      billId: string;
      fileName: string;
      extractionRan: boolean;
      extractionOk: boolean;
      extractionReason?: string | undefined;
      confidencePct?: number | undefined;
      supplierName: string | null;
      amountTotalCents: number;
    }
  | { ok: false; error: string };

/**
 * Non-redirecting batch-friendly upload action. Returns a structured result
 * so the dropzone can run several uploads in parallel and report each one's
 * outcome. The legacy single-file `createPlaceholderIntakeBill` action is
 * still around (form-action shape, redirects on success), but the dropzone
 * now uses this one — gives clearer per-file feedback for the multi-upload
 * flow and keeps the framework's single-redirect-per-action contract clean.
 *
 * `kind` selects where the cost lands:
 *   - 'expense' (default) — personal reimbursement, any staff can submit
 *   - 'bill'              — vendor AP, restricted to roles with bill.create
 */
export async function processIntakeUpload(
  payload: {
    fileName: string;
    fileBase64: string;
    fileMime: string;
    supplierName?: string | null;
    amountTotalDollars?: number | null;
    kind?: IntakeKind;
  },
): Promise<IntakeUploadResult> {
  const session = await getSession();
  if (!session) return { ok: false, error: 'Not signed in' };

  const kind: IntakeKind = payload.kind === 'bill' ? 'bill' : 'expense';
  if (kind === 'bill' && !hasCapability(session, 'bill.create')) {
    return {
      ok: false,
      error: 'Only Admin / Super Admin can drop FH-paid bills. Switch this row to "Expense for reimbursement".',
    };
  }
  if (kind === 'expense' && !hasCapability(session, 'expense.submit')) {
    return { ok: false, error: 'Not authorized to submit expenses.' };
  }

  const parsed = PlaceholderSchema.safeParse({
    fileName: cleanString(payload.fileName),
    supplierName: cleanString(payload.supplierName ?? null),
    amountTotalDollars:
      typeof payload.amountTotalDollars === 'number' &&
      Number.isFinite(payload.amountTotalDollars)
        ? payload.amountTotalDollars
        : null,
    fileBase64: cleanString(payload.fileBase64),
    fileMime: cleanString(payload.fileMime),
  });
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? 'Invalid input — file missing.',
    };
  }
  const result = await createCostFromExtraction(session.person.id, parsed.data, kind);
  if (!result.ok) {
    return { ok: false, error: result.error };
  }
  revalidatePath('/bills/intake');
  if (kind === 'expense') {
    revalidatePath('/expenses');
    revalidatePath('/approvals');
  }
  return {
    ok: true,
    kind,
    subjectId: result.subjectId,
    billId: result.subjectId,
    fileName: parsed.data.fileName,
    extractionRan: result.extractionRan,
    extractionOk: result.extractionOk,
    ...(result.extractionReason !== undefined
      ? { extractionReason: result.extractionReason }
      : {}),
    ...(result.confidencePct !== undefined
      ? { confidencePct: result.confidencePct }
      : {}),
    supplierName: result.supplierName,
    amountTotalCents: result.amountTotalCents,
  };
}

export async function createPlaceholderIntakeBill(
  _prev: IntakeActionState,
  formData: FormData,
): Promise<IntakeActionState> {
  const session = await getSession();
  if (!session || !hasAnyRole(session, ['super_admin', 'admin', 'partner'])) {
    return { status: 'error', message: 'Not authorized' };
  }
  const parsed = PlaceholderSchema.safeParse({
    fileName: cleanString(formData.get('fileName')),
    supplierName: cleanString(formData.get('supplierName')),
    amountTotalDollars: cleanNumber(formData.get('amountTotalDollars')),
    fileBase64: cleanString(formData.get('fileBase64')),
    fileMime: cleanString(formData.get('fileMime')),
  });
  if (!parsed.success) {
    return {
      status: 'error',
      message: parsed.error.issues[0]?.message ?? 'Invalid input — drop a file first.',
    };
  }
  const result = await createCostFromExtraction(session.person.id, parsed.data, 'bill');
  if (!result.ok) {
    return { status: 'error', message: result.error };
  }
  revalidatePath('/bills/intake');
  redirect(`/bills/intake?id=${result.subjectId}`);
}

/**
 * Shared OCR-and-create pipeline used by both the form-action
 * (createPlaceholderIntakeBill, redirects on success) and the batch action
 * (processIntakeUpload, returns a structured result). Keeps the per-file
 * write logic in one place so behaviour stays identical between single and
 * multi-upload flows.
 *
 * Branches on `kind`:
 *   - 'bill'    → creates Bill in pending_review (existing AP flow).
 *   - 'expense' → creates Expense in submitted + Approval row routed by the
 *                 standard expense policy (matches /expenses/new behaviour).
 */
type CreateCostResult =
  | {
      ok: true;
      kind: IntakeKind;
      subjectId: string;
      extractionRan: boolean;
      extractionOk: boolean;
      extractionReason?: string;
      confidencePct?: number;
      supplierName: string | null;
      amountTotalCents: number;
    }
  | { ok: false; error: string };

// Canonical category list lives in src/lib/expense-categories.ts
// (Xero AU starter chart aligned + ATO deductibility splits). Re-export
// the type + the free-form mapper so the intake action stays a thin
// caller without re-implementing the heuristics.
import { mapFreeFormToCategory as mapToExpenseCategory } from '@/lib/expense-categories';

async function createCostFromExtraction(
  actorPersonId: string,
  payload: z.infer<typeof PlaceholderSchema>,
  kind: IntakeKind,
): Promise<CreateCostResult> {
  const today = new Date();
  let extractedSupplier: string | null = payload.supplierName;
  let extractedAmountCents: number | null =
    payload.amountTotalDollars !== null
      ? Math.round(payload.amountTotalDollars * 100)
      : null;
  let extractedGstCents = 0;
  let extractedInvoiceNumber: string | null = null;
  let extractedIssueDate: Date = today;
  let extractedDueDate: Date | null = null;
  // Default to the canonical "other" category — the OCR agent (or
  // mapToExpenseCategory) will overwrite as soon as it has any signal.
  let extractedCategory = 'other';
  let extractionMeta: Record<string, unknown> = { ran: false };
  let extractionRan = false;
  let extractionOk = false;
  let extractionReason: string | undefined;
  let confidencePct: number | undefined;

  const fileBase64Length = payload.fileBase64?.length ?? 0;
  const apiKeyPresent = Boolean(process.env['ANTHROPIC_API_KEY']);
  console.info('[intake.upload] received', {
    fileName: payload.fileName,
    fileMime: payload.fileMime,
    fileBase64Length,
    apiKeyPresent,
  });

  if (!payload.fileBase64 || !payload.fileMime) {
    const reason = !payload.fileBase64
      ? 'No file body received — the browser didn\'t finish reading the file before submit. Try dropping the file again and waiting for the button to read "Extract & queue →".'
      : 'No file MIME type — the OS reported an empty type for this file. Re-export to PDF or PNG.';
    extractionMeta = { ran: false, reason };
    extractionReason = reason;
  } else {
    extractionRan = true;
    const { extractIntakeFields } = await import(
      '@/server/agents/intake-ocr/extract'
    );
    const extraction = await extractIntakeFields({
      base64: payload.fileBase64,
      mimeType: payload.fileMime,
      fileName: payload.fileName,
    });
    if (extraction.ok) {
      extractionOk = true;
      const e = extraction.data;
      extractedSupplier = extractedSupplier ?? e.supplierName;
      if (e.amountTotalDollars !== null && extractedAmountCents === null) {
        extractedAmountCents = Math.round(e.amountTotalDollars * 100);
      }
      if (e.gstDollars !== null) {
        extractedGstCents = Math.round(e.gstDollars * 100);
      }
      extractedInvoiceNumber = e.invoiceNumber;
      if (e.issueDate) {
        const d = new Date(`${e.issueDate}T00:00:00Z`);
        if (!Number.isNaN(d.getTime())) extractedIssueDate = d;
      }
      if (e.dueDate) {
        const d = new Date(`${e.dueDate}T00:00:00Z`);
        if (!Number.isNaN(d.getTime())) extractedDueDate = d;
      }
      if (e.category) extractedCategory = e.category;
      confidencePct = e.confidence.overall;
      extractionMeta = {
        ran: true,
        ok: true,
        confidence: e.confidence,
        currency: e.currency,
        notes: e.notes,
      };
    } else {
      extractionMeta = { ran: true, ok: false, reason: extraction.reason };
      extractionReason = extraction.reason;
    }
  }

  const dueDate =
    extractedDueDate ?? new Date(extractedIssueDate.getTime() + 30 * 24 * 3600 * 1000);
  const amountTotal = extractedAmountCents ?? 0;
  const attachmentUrl =
    payload.fileBase64 && payload.fileMime
      ? `data:${payload.fileMime};base64,${payload.fileBase64}`
      : `pending-upload://${payload.fileName}`;

  let subjectId: string;
  try {
    if (kind === 'bill') {
      const bill = await prisma.$transaction(async (tx) => {
        const b = await tx.bill.create({
          data: {
            supplierName: extractedSupplier ?? null,
            supplierInvoiceNumber: extractedInvoiceNumber,
            receivedVia: 'upload',
            attachmentSharepointUrl: attachmentUrl,
            issueDate: extractedIssueDate,
            dueDate,
            amountTotal,
            gst: extractedGstCents,
            category: extractedCategory,
            status: 'pending_review',
          },
        });
        await writeAudit(tx, {
          actor: { type: 'person', id: actorPersonId },
          action: 'created',
          entity: {
            type: 'bill',
            id: b.id,
            after: {
              via: 'intake_upload',
              fileName: payload.fileName,
              fileMime: payload.fileMime,
              fileBase64Length,
              apiKeyPresent,
              supplierName: extractedSupplier,
              supplierInvoiceNumber: extractedInvoiceNumber,
              amountTotal,
              gst: extractedGstCents,
              category: extractedCategory,
              extraction: extractionMeta,
            },
          },
          source: 'web',
        });
        return b;
      });
      subjectId = bill.id;
    } else {
      // kind === 'expense' — create the personal expense + Approval row in
      // one transaction so the AP queue picks it up immediately. Mirrors
      // /expenses/new but seeded with OCR fields. The actor IS the person
      // claiming reimbursement.
      const expenseCategory = mapToExpenseCategory(extractedCategory);
      const requiredRole = await resolveRequiredRole('expense', amountTotal);
      const expense = await prisma.$transaction(async (tx) => {
        const e = await tx.expense.create({
          data: {
            personId: actorPersonId,
            projectId: null, // user picks via expense detail edit
            date: extractedIssueDate,
            amount: amountTotal,
            gst: extractedGstCents,
            category: expenseCategory,
            vendor: extractedSupplier,
            description: payload.fileName,
            receiptSharepointUrl: attachmentUrl,
            status: 'submitted',
          },
        });
        const approval = await tx.approval.create({
          data: {
            subjectType: 'expense',
            subjectId: e.id,
            requestedById: actorPersonId,
            requiredRole,
            thresholdContext: {
              amount_cents: amountTotal,
              threshold_cents: 200_000,
            },
            channel: 'web',
          },
          select: { id: true },
        });
        await notifyApproversOfNewApproval(tx, {
          approvalId: approval.id,
          subjectType: 'expense',
          subjectId: e.id,
          requiredRole,
          requestedById: actorPersonId,
          amountCents: amountTotal,
          summary: `${extractedSupplier ?? 'Receipt'} · $${(amountTotal / 100).toFixed(0)}`,
        });
        await writeAudit(tx, {
          actor: { type: 'person', id: actorPersonId },
          action: 'submitted',
          entity: {
            type: 'expense',
            id: e.id,
            after: {
              via: 'intake_upload',
              fileName: payload.fileName,
              vendor: extractedSupplier,
              amount: amountTotal,
              gst: extractedGstCents,
              category: expenseCategory,
              extraction: extractionMeta,
            },
          },
          source: 'web',
        });
        return e;
      });
      subjectId = expense.id;
    }
  } catch (err) {
    console.error('[intake.upload] failed:', err);
    return { ok: false, error: 'Create failed — try again.' };
  }

  return {
    ok: true,
    kind,
    subjectId,
    extractionRan,
    extractionOk,
    ...(extractionReason !== undefined ? { extractionReason } : {}),
    ...(confidencePct !== undefined ? { confidencePct } : {}),
    supplierName: extractedSupplier,
    amountTotalCents: amountTotal,
  };
}
