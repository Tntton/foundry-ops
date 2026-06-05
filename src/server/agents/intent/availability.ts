import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';

/**
 * Channel-agnostic availability extractor. Same shape contract as
 * parseTimesheetText — see timesheet.ts for design rationale.
 */
export const AvailabilitySchema = z.object({
  weekStartIso: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
  hoursByDow: z.object({
    mon: z.coerce.number().min(0).max(24).optional().default(0),
    tue: z.coerce.number().min(0).max(24).optional().default(0),
    wed: z.coerce.number().min(0).max(24).optional().default(0),
    thu: z.coerce.number().min(0).max(24).optional().default(0),
    fri: z.coerce.number().min(0).max(24).optional().default(0),
    sat: z.coerce.number().min(0).max(24).optional().default(0),
    sun: z.coerce.number().min(0).max(24).optional().default(0),
  }),
  notes: z.string().trim().max(200).nullable().optional(),
});

export type AvailabilityExtraction = z.infer<typeof AvailabilitySchema>;

export type AvailabilityParseResult =
  | { ok: true; data: AvailabilityExtraction }
  | { ok: false; error: string };

export async function parseAvailabilityText(
  text: string,
  thisMondayIso: string,
  nextMondayIso: string,
): Promise<AvailabilityParseResult> {
  const apiKey = process.env['ANTHROPIC_API_KEY'];
  if (!apiKey) {
    return {
      ok: false,
      error:
        'Availability parsing needs LLM access — please use the web app for now.',
    };
  }
  const client = new Anthropic({ apiKey });
  const res = await client.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 512,
    system: `Extract the user's weekly availability from their message. Return ONLY JSON:
{
  "weekStartIso": "YYYY-MM-DD (Monday). 'this week'=${thisMondayIso}, 'next week'=${nextMondayIso}",
  "hoursByDow": { "mon": 0, "tue": 0, "wed": 0, "thu": 0, "fri": 0, "sat": 0, "sun": 0 },
  "notes": "string or null"
}
Default to next week when ambiguous. Use 0 for unmentioned days.
If unparseable, return {"error":"short reason"}.`,
    messages: [{ role: 'user', content: text }],
  });
  const block = res.content.find((c) => c.type === 'text');
  const raw = block && 'text' in block ? block.text : '';
  const cleaned = raw
    .replace(/^```(?:json)?\s*/iu, '')
    .replace(/```\s*$/iu, '')
    .trim();
  try {
    const parsed = JSON.parse(cleaned);
    if (parsed && typeof parsed === 'object' && 'error' in parsed) {
      return { ok: false, error: String(parsed.error) };
    }
    const validated = AvailabilitySchema.safeParse(parsed);
    if (!validated.success) {
      return {
        ok: false,
        error: 'Try "I\'m available 8h Mon-Fri next week".',
      };
    }
    return { ok: true, data: validated.data };
  } catch {
    return { ok: false, error: 'Try "I\'m available 8h Mon-Fri next week".' };
  }
}
