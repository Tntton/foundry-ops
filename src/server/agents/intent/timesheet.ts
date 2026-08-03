import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';

/**
 * Channel-agnostic timesheet-entry extractor. Lifted out of the WhatsApp
 * router so both surfaces (WhatsApp flow handler + in-app assistant
 * tool) can call it.
 *
 * A single message may describe several entries at once — e.g.
 * "PRP003 4h, FHB 2h, FHP002 2h today". The parser returns EVERY entry
 * it can extract (one object per project/day), so the caller can prefill
 * a multi-row form in one round-trip rather than forcing the user to
 * repeat themselves per project.
 *
 * Returns either:
 *   - { ok: true, data: { entries: TimesheetEntry[] } }
 *   - { ok: false, error: short user-facing reason }
 *
 * The two channels render the error differently (WhatsApp sends as a
 * reply; the in-app assistant feeds it back into the chat as a tool
 * result). Neither bypasses validation — Zod rejection becomes a clean
 * error, never a partial draft.
 */
export const TimesheetEntrySchema = z.object({
  projectCode: z.string().trim().min(2).max(20),
  hours: z.coerce.number().min(0).max(24),
  // ISO date — "today" / "yesterday" / "monday" are resolved by the
  // model, defaulting to today when unclear. For a whole-week total
  // (scope='week') this identifies WHICH week (any date inside it); the
  // caller parks the hours on an anchor day.
  dateIso: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
  // 'week' = the hours are a whole-week total the user didn't pin to a
  // specific day ("5h this week on PRP"). Defaults to 'day'.
  scope: z.enum(['day', 'week']).default('day'),
  description: z.string().trim().max(500).nullable().optional(),
});

/** @deprecated single-entry alias — use {@link TimesheetEntrySchema}. */
export const TimesheetSchema = TimesheetEntrySchema;

// Cap matches the timesheet prefill form's own max (schemas.ts) so a
// batch that parses here can never overflow the form on the other side.
export const TimesheetExtractionSchema = z.object({
  entries: z.array(TimesheetEntrySchema).min(1).max(10),
});

export type TimesheetEntry = z.infer<typeof TimesheetEntrySchema>;
export type TimesheetExtraction = z.infer<typeof TimesheetExtractionSchema>;

export type TimesheetParseResult =
  | { ok: true; data: TimesheetExtraction }
  | { ok: false; error: string };

/**
 * Free-form examples the model should handle:
 *   "Log 4h on PROJ001 today"
 *   "8 hours yesterday for project ALPHA"
 *   "Logged 3.5 hrs Friday on PROJ002 — discovery review"
 *   "PRP003 4h, FHB 2h, FHP002 2h today" → three entries
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
    // Room for a full batch (up to 10 entries) — a single entry used to
    // fit in 256, but multi-project messages need the headroom.
    max_tokens: 1024,
    system: `Extract EVERY timesheet entry from the user's message. A single message may name several projects and/or days at once — return one object per (project, day). Return ONLY JSON in this shape:
{
  "entries": [
    {
      "projectCode": "string (e.g. PROJ001)",
      "hours": number 0..24,
      "dateIso": "YYYY-MM-DD (today=${todayIso}; resolve 'yesterday', weekdays etc.)",
      "scope": "day | week",
      "description": "string or null"
    }
  ]
}
Rules:
- scope defaults to "day" — use it whenever the user names or implies a specific day.
- scope="week" ONLY when the hours are a whole-week total not tied to a day (e.g. "5h this week on PRP", "did 8 hours on ALPHA last week"). Then set dateIso to any date INSIDE that week (today=${todayIso} for "this week"; a date 7 days earlier for "last week").
- Include an object for each entry the user mentions (max 10). Example: "PRP003 4h, FHB 2h, FHP002 2h today" → three day entries.
If the message doesn't contain any parseable timesheet entry, return {"error": "short reason"}.`,
    messages: [{ role: 'user', content: text }],
  });
  const block = res.content.find((c) => c.type === 'text');
  const raw = block && 'text' in block ? block.text : '';
  const cleaned = raw
    .replace(/^```(?:json)?\s*/iu, '')
    .replace(/```\s*$/iu, '')
    .trim();
  try {
    const parsed: unknown = JSON.parse(cleaned);
    if (parsed && typeof parsed === 'object' && 'error' in parsed) {
      return { ok: false, error: String((parsed as { error: unknown }).error) };
    }
    // Accept either the batch shape ({ entries: [...] }) or a bare single
    // entry object, so an older-style model reply still validates.
    const normalized =
      parsed && typeof parsed === 'object' && 'entries' in parsed
        ? parsed
        : { entries: [parsed] };
    const validated = TimesheetExtractionSchema.safeParse(normalized);
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
