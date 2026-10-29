import { Prisma } from '@prisma/client';
import { prisma } from '@/server/db';
import { writeAudit } from '@/server/audit';
import {
  AvailabilityPrefillSchema,
  type AvailabilityPrefillPayload,
} from '@/server/agents/assistant/prefill/schemas';
import { signPrefillToken } from '@/server/agents/assistant/prefill/token';
import type { ToolDefinition } from './types';

/**
 * Prefill the availability forecast from a natural-language request
 * ("block out 4h every morning the week of 20 July"). Mirrors
 * prefill_timesheet: returns a deep-link the widget renders as a card;
 * the /availability page hydrates the grid and the user reviews +
 * saves via the form's own action. No DB write happens here.
 *
 * Availability has no project code — the hours are declared as spare
 * bandwidth and the person tags projects (or leaves them Free) on the
 * form. Hours are whole numbers (the column is an integer).
 */
export const prefillAvailability: ToolDefinition<AvailabilityPrefillPayload> = {
  spec: {
    name: 'prefill_availability',
    description:
      "Prefill the availability forecast with expected hours per day the user described (e.g. '4 hours every weekday the week of 20 July', 'I'm off next Friday'). Returns a URL the widget renders as 'Open prefilled availability'; the user reviews + saves via the form. Expand recurring phrasing into one entry PER DATE (compute the actual dates). Dates must be ISO (YYYY-MM-DD) and fall within the next ~8 weeks. Hours are whole numbers 0–24 (0 = explicitly not available that day). Up to 56 entries.",
    input_schema: {
      type: 'object',
      properties: {
        entries: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              dateIso: {
                type: 'string',
                description: 'Date in YYYY-MM-DD.',
              },
              hours: {
                type: 'number',
                description: 'Whole hours 0–24 expected available that day.',
              },
            },
            required: ['dateIso', 'hours'],
          },
          description: 'One row per date (1–56).',
        },
      },
      required: ['entries'],
    },
  },
  async run(ctx, raw) {
    const parsed = AvailabilityPrefillSchema.safeParse(raw);
    if (!parsed.success) {
      return {
        error: `invalid_payload: ${parsed.error.issues[0]?.message ?? 'check inputs'}`,
      };
    }
    const personId = ctx.session.person.id;

    const sorted = [...parsed.data.entries].sort((a, b) =>
      a.dateIso.localeCompare(b.dateIso),
    );
    const anchorDateIso = sorted[0]!.dateIso;

    const token = signPrefillToken({
      kind: 'availability',
      personId,
      payload: parsed.data,
    });
    const url = `/availability?prefill=${encodeURIComponent(token)}`;

    // Audit the mint — paired with a redemption audit on the page side.
    try {
      await prisma.$transaction(async (tx) => {
        await writeAudit(tx, {
          actor: { type: 'person', id: personId },
          action: 'minted',
          entity: {
            type: 'assistant_prefill',
            id: `${personId}:availability:${anchorDateIso}`,
            after: {
              kind: 'availability',
              entryCount: parsed.data.entries.length,
              payload: parsed.data as unknown as Prisma.InputJsonValue,
            },
          },
          source: 'agent',
        });
      });
    } catch (err) {
      console.error('[prefill_availability] audit mint failed:', err);
    }

    const totalHours = parsed.data.entries.reduce((s, e) => s + e.hours, 0);
    return {
      kind: 'prefill',
      surface: 'availability',
      url,
      summary: `Open availability with ${parsed.data.entries.length} day${
        parsed.data.entries.length === 1 ? '' : 's'
      } prefilled (${totalHours}h total).`,
      entryCount: parsed.data.entries.length,
    };
  },
};
