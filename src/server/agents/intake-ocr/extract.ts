import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';

/**
 * Structured extraction from a supplier invoice or receipt. Each field is
 * accompanied by a 0-100 confidence score so the intake review pane can
 * surface uncertain fields for human review (matches the OCR confidence
 * chips on /bills/intake).
 */
export const ExtractionSchema = z.object({
  supplierName: z.string().nullable(),
  supplierAbn: z
    .string()
    .nullable()
    .transform((v) => (v ? v.replace(/\s+/g, '') : v)),
  invoiceNumber: z.string().nullable(),
  // ISO-8601 date strings; parser converts to Date in the action.
  issueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).nullable(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).nullable(),
  currency: z.string().length(3).nullable(),
  // Money fields are AUD dollars (decimal) — converted to cents in the
  // action so we don't drift from the rest of the codebase.
  amountTotalDollars: z.number().nullable(),
  gstDollars: z.number().nullable(),
  category: z.string().nullable(),
  // Useful but not always present — the agent can return null.
  paymentMethod: z.string().nullable(),
  notes: z.string().nullable(),
  // Per-field confidence: each entry is optional (the agent may legitimately
  // omit a confidence score for a field it returned as null). Missing keys
  // default to 0 in the review pane, and we only mandate `overall` so the
  // intake reviewer always has *some* signal. Earlier this was a strict
  // object — receipts where the model couldn't read e.g. supplierAbn were
  // failing validation 3× in a row and bouncing the user to manual entry
  // even though every other field was fine. (Bug fix, 2026-05-10.)
  confidence: z
    .object({
      overall: z.number().min(0).max(100),
      supplierName: z.number().min(0).max(100).optional(),
      supplierAbn: z.number().min(0).max(100).optional(),
      invoiceNumber: z.number().min(0).max(100).optional(),
      issueDate: z.number().min(0).max(100).optional(),
      dueDate: z.number().min(0).max(100).optional(),
      amountTotalDollars: z.number().min(0).max(100).optional(),
      gstDollars: z.number().min(0).max(100).optional(),
    })
    .passthrough(),
});

export type IntakeExtraction = z.infer<typeof ExtractionSchema>;

const SYSTEM_PROMPT = `You are an accounts-payable assistant for Foundry Health, an AU/NZ healthcare strategy consultancy. You extract structured fields from supplier invoices, contractor invoices, and receipts.

Rules:
- Always return a JSON object that matches the schema. No prose. No markdown fences.
- Dates: ISO-8601 (YYYY-MM-DD). If the receipt shows "24 April 2026", return "2026-04-24".
- Money: decimal AUD dollars (e.g. 65.50, not 6550). If the receipt is in another currency, set "currency" to its ISO-4217 code and still return the original amount.
- "amountTotalDollars" is the GROSS amount including any tax. Net + GST = total.
- "gstDollars" is the AU 10% GST line if present; otherwise null. "10% Tax Included, $5.95" → 5.95.
- "category": pick exactly ONE of these snake_case values, aligned to the AU Xero starter chart of accounts + ATO deductibility splits:
   travel · meals_entertainment · motor_vehicle · office_supplies · computer_equipment · software_subscriptions · telephone_internet · professional_fees · subcontractor_fees · marketing_bd · training_conferences · insurance · memberships · bank_fees · utilities · rent · repairs_maintenance · other
  Routing hints — flights/hotels/Ubers on a trip → travel; client meals or working lunches → meals_entertainment; laptops/monitors/peripherals → computer_equipment; software/SaaS/cloud → software_subscriptions; mobile/internet → telephone_internet; legal/accounting → professional_fees; contractor invoices for client work → subcontractor_fees; ads/sponsorships/BD → marketing_bd; conferences/training/CPD → training_conferences; AICD/AMA-style memberships → memberships; fuel/parking/tolls without travel context → motor_vehicle. When unsure, use other and let admin re-code.
- ABN: 11 digits. Strip spaces. Return null if missing.
- "invoiceNumber": the supplier's reference (e.g. "HS-2041", "Receipt #zjj7", "INV-2026-042"). Return the receipt / ticket number if there's no formal invoice number.
- Confidence (0-100): how sure are you about each field. 99 = printed clearly. 70-90 = likely correct but worth a glance. <50 = uncertain or inferred. "overall" is mandatory — a simple average of the field confidences for the fields you returned. Per-field confidences are optional; only emit a key for fields you actually returned a value for. Don't emit a confidence score for a field you returned as null.

Return null for any field you cannot read. Do not invent.`;

const USER_PROMPT_TEMPLATE = `Extract the structured fields from this document. Return JSON only.`;

const MAX_RETRIES = 3;

export type ExtractionInput = {
  /** Base64-encoded file contents (no data: prefix). */
  base64: string;
  /** MIME type, e.g. application/pdf, image/jpeg, image/heic. */
  mimeType: string;
  /** Filename for the audit trail and the model's context. */
  fileName: string;
};

/**
 * Run OCR + structured extraction via claude-sonnet vision. Returns the
 * extracted fields on success, or `null` when the API isn't configured so
 * callers can fall back to a manual placeholder. Schema validation is
 * mandatory — failures retry up to MAX_RETRIES with the parse error fed back
 * into the conversation, per the CLAUDE.md guardrail.
 *
 * `claude-sonnet` per A4 in CLAUDE.md (locked decision: claude is the LLM,
 * sonnet for structured extraction).
 */
export async function extractIntakeFields(
  input: ExtractionInput,
): Promise<{ ok: true; data: IntakeExtraction } | { ok: false; reason: string }> {
  const apiKey = process.env['ANTHROPIC_API_KEY'];
  if (!apiKey) {
    return {
      ok: false,
      reason:
        'OCR not configured — set ANTHROPIC_API_KEY in .env.local to enable claude-sonnet extraction. Saved as a placeholder for manual review.',
    };
  }

  const client = new Anthropic({ apiKey });

  // Sonnet supports PDF + image inputs directly — no need to rasterise PDFs
  // ahead of time. Image MIME types must be one of jpeg, png, gif, webp;
  // HEIC isn't natively supported, so we accept the input but warn.
  const supportedImage =
    input.mimeType === 'image/jpeg' ||
    input.mimeType === 'image/png' ||
    input.mimeType === 'image/gif' ||
    input.mimeType === 'image/webp';
  const isPdf = input.mimeType === 'application/pdf';
  if (!supportedImage && !isPdf) {
    return {
      ok: false,
      reason: `Format ${input.mimeType} can't be read by claude-sonnet directly — convert to PDF or PNG before re-uploading. Saved as a placeholder.`,
    };
  }

  const documentBlock = isPdf
    ? ({
        type: 'document' as const,
        source: {
          type: 'base64' as const,
          media_type: 'application/pdf' as const,
          data: input.base64,
        },
      } as const)
    : ({
        type: 'image' as const,
        source: {
          type: 'base64' as const,
          media_type: input.mimeType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
          data: input.base64,
        },
      } as const);

  const messages: Array<{
    role: 'user' | 'assistant';
    content: Array<unknown>;
  }> = [
    {
      role: 'user',
      content: [
        documentBlock,
        { type: 'text', text: USER_PROMPT_TEMPLATE },
      ],
    },
  ];

  let lastError: string | null = null;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
    try {
      const response = await client.messages.create({
        // Locked architectural decision A4 — claude-sonnet for structured
        // extraction. Pinned to a specific snapshot for reproducibility.
        model: 'claude-sonnet-4-5',
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        messages: messages as any,
      });
      const textBlock = response.content.find((b) => b.type === 'text');
      if (!textBlock || textBlock.type !== 'text') {
        lastError = 'No text block in model response.';
        continue;
      }
      const raw = textBlock.text.trim();
      // Strip code fences if the model couldn't help itself.
      const jsonStart = raw.indexOf('{');
      const jsonEnd = raw.lastIndexOf('}');
      if (jsonStart === -1 || jsonEnd === -1) {
        lastError = `Model didn't return JSON. Got: ${raw.slice(0, 100)}`;
      } else {
        const json = raw.slice(jsonStart, jsonEnd + 1);
        let parsed: unknown;
        try {
          parsed = JSON.parse(json);
        } catch (err) {
          lastError = `JSON parse failed: ${(err as Error).message}`;
          messages.push({
            role: 'assistant',
            content: [{ type: 'text', text: raw }],
          });
          messages.push({
            role: 'user',
            content: [
              {
                type: 'text',
                text: `That wasn't valid JSON. Re-emit the schema as a single JSON object, no fences: ${lastError}`,
              },
            ],
          });
          continue;
        }
        const validated = ExtractionSchema.safeParse(parsed);
        if (validated.success) {
          return { ok: true, data: validated.data };
        }
        lastError = `Schema validation failed: ${validated.error.issues
          .slice(0, 3)
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; ')}`;
        messages.push({
          role: 'assistant',
          content: [{ type: 'text', text: raw }],
        });
        messages.push({
          role: 'user',
          content: [
            {
              type: 'text',
              text: `Schema mismatch — fix and re-emit only the JSON object: ${lastError}`,
            },
          ],
        });
      }
    } catch (err) {
      lastError = `Anthropic API error: ${(err as Error).message}`;
      // No model context to feed back; just retry.
    }
  }

  return {
    ok: false,
    reason: `Extraction failed after ${MAX_RETRIES} attempts. ${lastError ?? ''}`.trim(),
  };
}
