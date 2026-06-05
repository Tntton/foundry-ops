import { Prisma } from '@prisma/client';
import { prisma } from '@/server/db';
import { writeAudit } from '@/server/audit';
import { startOfWeek, formatIsoDate } from '@/lib/week';
import {
  TimesheetPrefillSchema,
  type TimesheetPrefillPayload,
} from '@/server/agents/assistant/prefill/schemas';
import { signPrefillToken } from '@/server/agents/assistant/prefill/token';
import type { ToolDefinition } from './types';

/**
 * Build the deep-link URL for a prefill token. The widget renders it
 * as a button; on click the user lands on /timesheet?week=…&prefill=…
 * with the entries pre-populated. Form's own server action does the
 * write — this tool never touches the DB.
 */
export const prefillTimesheet: ToolDefinition<TimesheetPrefillPayload> = {
  spec: {
    name: 'prefill_timesheet',
    description:
      "Prefill the timesheet with one or more entries the user described. Returns a URL the widget renders as 'Open prefilled timesheet'; the user inspects + edits + submits via the form's normal flow. ALWAYS resolve project codes with find_project first if the user said something partial — pass canonical codes here. Up to 10 entries per token; multi-row prefill works for 'log my standard week' style requests. Dates must be ISO (YYYY-MM-DD). Hours 0.25–24 per row.",
    input_schema: {
      type: 'object',
      properties: {
        entries: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              projectCode: {
                type: 'string',
                description: 'Canonical project code, e.g. CAC001.',
              },
              dateIso: {
                type: 'string',
                description: 'Date in YYYY-MM-DD.',
              },
              hours: {
                type: 'number',
                description: 'Hours 0.25–24.',
              },
              notes: {
                type: 'string',
                description: 'Optional row note.',
              },
            },
            required: ['projectCode', 'dateIso', 'hours'],
          },
          description: 'Rows to prefill (1–10).',
        },
      },
      required: ['entries'],
    },
  },
  async run(ctx, raw) {
    const parsed = TimesheetPrefillSchema.safeParse(raw);
    if (!parsed.success) {
      return {
        error: `invalid_payload: ${parsed.error.issues[0]?.message ?? 'check inputs'}`,
      };
    }
    const personId = ctx.session.person.id;

    // Cross-check project codes exist + aren't archived. This catches
    // hallucinated codes BEFORE the user clicks through to the form.
    const codes = Array.from(
      new Set(parsed.data.entries.map((e) => e.projectCode.toUpperCase())),
    );
    const projects = await prisma.project.findMany({
      where: { code: { in: codes } },
      select: { code: true, stage: true },
    });
    const knownCodes = new Set(projects.map((p) => p.code));
    const archivedCodes = new Set(
      projects.filter((p) => p.stage === 'archived').map((p) => p.code),
    );
    const missing = codes.filter((c) => !knownCodes.has(c));
    if (missing.length > 0) {
      return {
        error: `unknown_project_code: ${missing.join(', ')}. Call find_project first to disambiguate.`,
      };
    }
    if (archivedCodes.size > 0) {
      return {
        error: `archived_project: ${Array.from(archivedCodes).join(
          ', ',
        )} — can't log time against archived projects.`,
      };
    }

    // Pick the week= query param from the earliest entry date.
    const sorted = [...parsed.data.entries].sort((a, b) =>
      a.dateIso.localeCompare(b.dateIso),
    );
    const anchorDateIso = sorted[0]!.dateIso;
    const monday = startOfWeek(new Date(`${anchorDateIso}T00:00:00.000Z`));
    const weekIso = formatIsoDate(monday);

    const token = signPrefillToken({
      kind: 'timesheet',
      personId,
      payload: parsed.data,
    });
    const url = `/timesheet?week=${weekIso}&prefill=${encodeURIComponent(token)}`;

    // Audit the mint — paired with a redemption audit on the form
    // side (page.tsx). Lets us see in one query "what did the
    // assistant offer to prefill, and was it consumed?"
    try {
      await prisma.$transaction(async (tx) => {
        await writeAudit(tx, {
          actor: { type: 'person', id: personId },
          action: 'minted',
          entity: {
            type: 'assistant_prefill',
            id: `${personId}:${anchorDateIso}`,
            after: {
              kind: 'timesheet',
              weekIso,
              entryCount: parsed.data.entries.length,
              payload: parsed.data as unknown as Prisma.InputJsonValue,
            },
          },
          source: 'agent',
        });
      });
    } catch (err) {
      console.error('[prefill_timesheet] audit mint failed:', err);
    }

    const summaryEntries = parsed.data.entries.map(
      (e) =>
        `${e.hours}h on ${e.projectCode.toUpperCase()} ${e.dateIso}${
          e.notes ? ` (“${e.notes}”)` : ''
        }`,
    );
    return {
      kind: 'prefill',
      surface: 'timesheet',
      url,
      summary: `Open the timesheet with: ${summaryEntries.join('; ')}.`,
      entryCount: parsed.data.entries.length,
      weekIso,
    };
  },
};
