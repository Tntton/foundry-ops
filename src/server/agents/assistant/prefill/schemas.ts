import { z } from 'zod';

/**
 * Zod schemas for prefill payloads — one per surface. These define the
 * over-the-wire shape, NOT the form's own validation; the form runs its
 * own Zod check on submit. Prefill is "best-effort field hydration" —
 * the user inspects + corrects before submitting.
 */

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u, 'Must be YYYY-MM-DD');

export const TimesheetPrefillSchema = z.object({
  entries: z
    .array(
      z.object({
        projectCode: z.string().trim().min(2).max(20),
        dateIso: isoDate,
        hours: z.coerce.number().min(0.25).max(24),
        notes: z.string().trim().max(500).optional().nullable(),
      }),
    )
    .min(1)
    .max(10),
});

export type TimesheetPrefillPayload = z.infer<typeof TimesheetPrefillSchema>;

export const ExpensePrefillSchema = z.object({
  dateIso: isoDate,
  amountDollars: z.coerce.number().positive().max(999_999.99),
  gstDollars: z.coerce.number().min(0).max(999_999.99).optional().nullable(),
  category: z.string().trim().min(2).max(50),
  vendor: z.string().trim().max(200).optional().nullable(),
  description: z.string().trim().min(1).max(500),
  projectCode: z.string().trim().max(20).optional().nullable(),
});

export type ExpensePrefillPayload = z.infer<typeof ExpensePrefillSchema>;

export const BillPrefillSchema = z.object({
  supplierName: z.string().trim().min(1).max(200),
  supplierAbn: z.string().trim().max(20).optional().nullable(),
  supplierInvoiceNumber: z.string().trim().min(1).max(60),
  issueDateIso: isoDate,
  dueDateIso: isoDate,
  amountDollars: z.coerce.number().positive().max(999_999.99),
  gstDollars: z.coerce.number().min(0).max(999_999.99).optional().nullable(),
  category: z.string().trim().min(2).max(50),
  projectCode: z.string().trim().max(20).optional().nullable(),
});

export type BillPrefillPayload = z.infer<typeof BillPrefillSchema>;

export const InvoicePrefillSchema = z.object({
  projectCode: z.string().trim().min(2).max(20),
  lines: z
    .array(
      z.object({
        label: z.string().trim().min(1).max(200),
        amountDollars: z.coerce.number().positive().max(999_999.99),
      }),
    )
    .min(1)
    .max(20),
});

export type InvoicePrefillPayload = z.infer<typeof InvoicePrefillSchema>;

// ─── Proposal family (TASK-302d) ───────────────────────────────────
// Tokens for low-field one-shot actions (quick recruit + feedback
// ticket). The widget renders a confirmation card; the user clicks
// Confirm and the server runs the underlying action.

// Matches RecruitTargetBand enum in prisma/schema.prisma — snake_case
// lowercase. NOT the Band enum (which is PascalCase and is used on
// the Person table); recruitment uses its own coarser pool labels.
const TARGET_BAND_ENUM = z.enum([
  'senior_leader',
  'expert',
  'fellow',
  'manager',
  'consultant',
  'analyst',
]);

export const RecruitProposalSchema = z.object({
  firstName: z.string().trim().min(1).max(60),
  lastName: z.string().trim().min(1).max(60),
  targetBand: TARGET_BAND_ENUM,
  /** Optional owner Person id; falls back to the confirming user. */
  ownerId: z.string().trim().max(40).optional().nullable(),
});

export type RecruitProposalPayload = z.infer<typeof RecruitProposalSchema>;

export const FeedbackProposalSchema = z.object({
  urgency: z.enum(['critical', 'urgent', 'routine']),
  kind: z.enum(['bug', 'feature', 'maintenance', 'other']),
  title: z.string().trim().min(3).max(200),
  body: z.string().trim().min(5).max(4000),
  contextPath: z.string().trim().max(500).optional().nullable(),
});

export type FeedbackProposalPayload = z.infer<typeof FeedbackProposalSchema>;
