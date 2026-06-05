import { Prisma } from '@prisma/client';
import { prisma } from '@/server/db';
import { writeAudit } from '@/server/audit';
import { hasCapability } from '@/server/capabilities';
import {
  InvoicePrefillSchema,
  type InvoicePrefillPayload,
} from '@/server/agents/assistant/prefill/schemas';
import { signPrefillToken } from '@/server/agents/assistant/prefill/token';
import type { ToolDefinition } from './types';

export const prefillInvoice: ToolDefinition<InvoicePrefillPayload> = {
  spec: {
    name: 'prefill_invoice',
    description:
      "Prefill /invoices/new with draft lines for a project. Use when the user describes invoiceable work to bill out (e.g. 'invoice CAC001 for May milestones — 30k discovery, 15k workshop'). Each line is { label, amountDollars }. The form computes GST + total. Gated on invoice.create. Returns a URL for the widget's button.",
    input_schema: {
      type: 'object',
      properties: {
        projectCode: { type: 'string' },
        lines: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              label: { type: 'string' },
              amountDollars: { type: 'number' },
            },
            required: ['label', 'amountDollars'],
          },
        },
      },
      required: ['projectCode', 'lines'],
    },
  },
  capability: 'invoice.create',
  async run(ctx, raw) {
    const parsed = InvoicePrefillSchema.safeParse(raw);
    if (!parsed.success) {
      return {
        error: `invalid_payload: ${parsed.error.issues[0]?.message ?? 'check inputs'}`,
      };
    }
    if (!hasCapability(ctx.session, 'invoice.create')) {
      return { error: 'permission_denied' };
    }
    const data = parsed.data;
    const code = data.projectCode.toUpperCase();
    const project = await prisma.project.findUnique({
      where: { code },
      select: { id: true, code: true, stage: true },
    });
    if (!project) {
      return {
        error: `unknown_project_code: ${code}. Call find_project first.`,
      };
    }
    if (project.stage === 'archived') {
      return { error: `archived_project: ${code}.` };
    }

    const personId = ctx.session.person.id;
    const token = signPrefillToken({
      kind: 'invoice',
      personId,
      payload: data,
    });
    // Pass projectId AND prefill so the page can hydrate the project
    // dropdown immediately (form already supports defaultProjectId).
    const url = `/invoices/new?projectId=${encodeURIComponent(
      project.id,
    )}&prefill=${encodeURIComponent(token)}`;

    try {
      await prisma.$transaction(async (tx) => {
        await writeAudit(tx, {
          actor: { type: 'person', id: personId },
          action: 'minted',
          entity: {
            type: 'assistant_prefill',
            id: `${personId}:invoice:${project.id}`,
            after: {
              kind: 'invoice',
              projectCode: project.code,
              payload: data as unknown as Prisma.InputJsonValue,
            },
          },
          source: 'agent',
        });
      });
    } catch (err) {
      console.error('[prefill_invoice] audit mint failed:', err);
    }

    const totalDollars = data.lines.reduce(
      (s, l) => s + l.amountDollars,
      0,
    );
    const summary = `Open the invoice form for ${project.code} with ${
      data.lines.length
    } line${data.lines.length === 1 ? '' : 's'} totalling $${totalDollars.toFixed(2)} ex GST`;

    return {
      kind: 'prefill',
      surface: 'invoice',
      url,
      summary,
    };
  },
};
