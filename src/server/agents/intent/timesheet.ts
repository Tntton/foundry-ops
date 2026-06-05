import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';

/**
 * Channel-agnostic timesheet-entry extractor. Lifted out of the WhatsApp
 * router so both surfaces (WhatsApp flow handler + in-app assistant
 * tool) can call it.
 *
 * Returns either:
 *   - { ok: true, data: TimesheetExtraction }
 *   - { ok: false, error: short user-facing reason }
 *
 * The two channels render the error differently (WhatsApp sends as a
 * reply; the in-app assistant feeds it back into the chat as a tool
 * result). Neither bypasses validation — Zod rejection becomes a clean
 * error, never a partial draft.
 */
export const TimesheetSchema = z.object({
  projectCode: z.string().trim().min(2).max(20),
  hours: z.coerce.number().min(0).max(24),
  // ISO date — "today" / "yesterday" / "monday" are resolved by the
  // model, defaulting to today when unclear.
  dateIso: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
  description: z.string().trim().max(500).nullable().optional(),
});

export type TimesheetExtraction = z.infer<typeof TimesheetSchema>;

export type TimesheetParseResult =
  | { ok: true; data: TimesheetExtraction }
  | { ok: false; error: string };

/**
 * Free-form examples the model should handle:
 *   "Log 4h on PROJ001 today"
 *   "8 hours yesterday for project ALPHA"
 *   "Logged 3.5 hrs Friday on PROJ002 — discovery review"
 */
export async function parseTimesheetText(
  text: string,
  todayIso: string,
): Promise<TimesheetParseResult> {
  const apiKey = process.env['ANTHROPIC_API_KEY'];
  if (!apiKey) {
    return {
      ok: false,
      error:
        'Timesheet parsing requires LLM access — please use the web app for now.',
    };
  }
  const client = new Anthropic({ apiKey });
  const res = await client.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 256,
    system: `Extract a timesheet entry from the user's message. Return ONLY JSON in this shape:
{
  "projectCode": "string (e.g. PROJ001)",
  "hours": number 0..24,
  "dateIso": "YYYY-MM-DD (today=${todayIso}; resolve 'yesterday', weekdays etc.)",
  "description": "string or null"
}
If the message doesn't contain a parseable timesheet entry, return {"error": "short reason"}.`,
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
    const validated = TimesheetSchema.safeParse(parsed);
    if (!validated.success) {
      return {
        ok: false,
        error:
          'Couldn\'t parse the timesheet bits — try "log 4 hours on PROJ001 today".',
      };
    }
    return { ok: true, data: validated.data };
  } catch {
    return { ok: false, error: 'Try "log 4 hours on PROJ001 today".' };
  }
}
