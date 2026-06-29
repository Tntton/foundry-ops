/**
 * Project-brief extractor for the reconcile assistant.
 *
 * Reads a PDF (project brief, CSA work order, SOW, kickoff deck) via
 * claude-sonnet vision and returns the structured fields needed to
 * create a new Project row. Mirrors the receipt OCR pattern at
 * src/server/agents/intake-ocr/extract.ts: schema-validated output,
 * retry on parse failure, fall through to a no-op state if the model
 * can't read the doc.
 *
 * .docx files are NOT supported by claude-sonnet directly; the chat
 * panel rejects them upstream with a "convert to PDF first" note.
 */
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';

export const BRIEF_MAX_RETRIES = 3;

const ISO_DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).nullable();

export const BriefExtractionSchema = z.object({
  /** Best-effort name for the engagement — usually the deck title. */
  projectName: z.string().nullable(),
  /** Client's legal / commercial name as it appears in the doc.
   *  Server matches this against the Client table. */
  clientName: z.string().nullable(),
  /** ISO YYYY-MM-DD dates. */
  startDate: ISO_DATE,
  endDate: ISO_DATE,
  /** Fee in AUD dollars (gross). Null when not stated. Server stores
   *  cents in the actual Project row. */
  contractValueDollars: z.number().nonnegative().nullable(),
  /** 1-2 sentence scope summary if the doc has one — surfaces in the
   *  Project.description field. */
  scopeSummary: z.string().nullable(),
  /** Overall confidence 0-100. <60 → flag for manual review. */
  confidence: z.number().min(0).max(100),
});
export type BriefExtraction = z.infer<typeof BriefExtractionSchema>;

const SYSTEM_PROMPT = `You read Foundry Health project briefs / SOWs / kickoff decks and extract the structured fields needed to register the engagement in the back-end.

You must return a single JSON object matching this exact schema:

{
  "projectName": string | null,
  "clientName": string | null,
  "startDate": "YYYY-MM-DD" | null,
  "endDate": "YYYY-MM-DD" | null,
  "contractValueDollars": number | null,
  "scopeSummary": string | null,
  "confidence": number (0-100)
}

Rules:
- Use null when a field isn't clearly stated. Do not invent values.
- contractValueDollars is the GROSS fee (inc GST if Australian), in AUD. Convert "AUD 50,000" to 50000.
- Australian dates: "1 July 2026" → "2026-07-01".
- scopeSummary: 1-2 sentences max, plain English, no markdown.
- confidence: your overall certainty the fields you returned are correct.
- Return ONLY the JSON object, no preamble, no code fences.`;

const USER_PROMPT = 'Extract the project registration fields from this brief.';

export type BriefInput = {
  /** base64-encoded file content. */
  base64: string;
  /** Currently must be 'application/pdf'. */
  mimeType: string;
};

export async function extractProjectBrief(
  input: BriefInput,
): Promise<{ ok: true; data: BriefExtraction } | { ok: false; reason: string }> {
  const apiKey = process.env['ANTHROPIC_API_KEY'];
  if (!apiKey) {
    return {
      ok: false,
      reason: 'OCR not configured — ANTHROPIC_API_KEY missing.',
    };
  }
  if (input.mimeType !== 'application/pdf') {
    return {
      ok: false,
      reason: `Format ${input.mimeType} isn't supported. Convert to PDF first.`,
    };
  }
  const client = new Anthropic({ apiKey });
  const messages: Array<{ role: 'user' | 'assistant'; content: Array<unknown> }> = [
    {
      role: 'user',
      content: [
        {
          type: 'document',
          source: {
            type: 'base64',
            media_type: 'application/pdf',
            data: input.base64,
          },
        },
        { type: 'text', text: USER_PROMPT },
      ],
    },
  ];
  let lastError: string | null = null;
  for (let attempt = 0; attempt < BRIEF_MAX_RETRIES; attempt += 1) {
    try {
      const response = await client.messages.create({
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
          lastError = `JSON parse failed: ${err instanceof Error ? err.message : 'unknown'}`;
          continue;
        }
        const validation = BriefExtractionSchema.safeParse(parsed);
        if (validation.success) {
          return { ok: true, data: validation.data };
        }
        lastError = `Schema validation failed: ${validation.error.issues[0]?.message ?? 'unknown'}`;
      }
      // Feed the error back to the model on retry so it self-corrects.
      messages.push({ role: 'assistant', content: [{ type: 'text', text: raw }] });
      messages.push({
        role: 'user',
        content: [
          {
            type: 'text',
            text: `That didn't validate — ${lastError ?? 'unknown error'}. Return ONLY a JSON object matching the schema, no preamble.`,
          },
        ],
      });
    } catch (err) {
      lastError = err instanceof Error ? err.message : 'extract error';
    }
  }
  return { ok: false, reason: lastError ?? 'extract failed' };
}
