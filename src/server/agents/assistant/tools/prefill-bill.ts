import { Prisma } from '@prisma/client';
import { prisma } from '@/server/db';
import { writeAudit } from '@/server/audit';
import { hasCapability } from '@/server/capabilities';
import { EXPENSE_CATEGORY_VALUES } from '@/lib/expense-categories';
import {
  BillPrefillSchema,
  type BillPrefillPayload,
} from '@/server/agents/assistant/prefill/schemas';
import { signPrefillToken } from '@/server/agents/assistant/prefill/token';
import type { ToolDefinition } from './types';

export const prefillBill: ToolDefinition<BillPrefillPayload> = {
  spec: {
    name: 'prefill_bill',
    description:
      "Prefill /bills/new with a supplier invoice (AP). Use when the user describes a bill they received from a vendor. Supplier name + invoice number + dates required. Category must be a canonical snake_case enum value. Gated on bill.create capability. Returns the URL for the widget's button.",
    input_schema: {
      type: 'object',
      properties: {
        supplierName: { type: 'string' },
        supplierAbn: {
          type: 'string',
          description: 'Optional 11-digit AU ABN; whitespace stripped.',
        },
        supplierInvoiceNumber: { type: 'string' },
        issueDateIso: { type: 'string', description: 'YYYY-MM-DD' },
        dueDateIso: { type: 'string', description: 'YYYY-MM-DD' },
        amountDollars: { type: 'number', description: 'Gross total inc GST, AUD.' },
        gstDollars: { type: 'number' },
        category: { type: 'string', description: 'Canonical category enum.' },
        projectCode: {
          type: 'string',
          description: 'Optional project code (leave blank for OPEX).',
        },
      },
      required: [
        'supplierName',
        'supplierInvoiceNumber',
        'issueDateIso',
        'dueDateIso',
        'amountDollars',
        'category',
      ],
    },
  },
  capability: 'bill.create',
  async run(ctx, raw) {
    const parsed = BillPrefillSchema.safeParse(raw);
    if (!parsed.success) {
      return {
        error: `invalid_payload: ${parsed.error.issues[0]?.message ?? 'check inputs'}`,
      };
    }
    const data = parsed.data;
    if (!hasCapability(ctx.session, 'bill.create')) {
      return { error: 'permission_denied' };
    }
    if (
      !(EXPENSE_CATEGORY_VALUES as readonly string[]).includes(data.category)
    ) {
      return {
        error: `unknown_category: '${data.category}' is not canonical. Call list_expense_categories.`,
      };
    }
    if (data.projectCode) {
      const code = data.projectCode.toUpperCase();
      const project = await prisma.project.findUnique({
        where: { code },
        select: { code: true, stage: true },
      });
      if (!project) {
        return {
          error: `unknown_project_code: ${code}. Call find_project first or omit for OPEX.`,
        };
      }
      if (project.stage === 'archived') {
        return { error: `archived_project: ${code}.` };
      }
    }

    const personId = ctx.session.person.id;
    const token = signPrefillToken({
      kind: 'bill',
      personId,
      payload: data,
    });
    const url = `/bills/new?prefill=${encodeURIComponent(token)}`;

    try {
      await prisma.$transaction(async (tx) => {
        await writeAudit(tx, {
          actor: { type: 'person', id: personId },
          action: 'minted',
          entity: {
            type: 'assistant_prefill',
            id: `${personId}:bill:${data.supplierInvoiceNumber}`,
            after: {
              kind: 'bill',
              payload: data as unknown as Prisma.InputJsonValue,
            },
          },
          source: 'agent',
        });
      });
    } catch (err) {
      console.error('[prefill_bill] audit mint failed:', err);
    }

    const summary = `Open the bill form for ${data.supplierName} · ${
      data.supplierInvoiceNumber
    } · $${data.amountDollars.toFixed(2)}${
      data.projectCode ? ` (${data.projectCode.toUpperCase()})` : ' (OPEX)'
    }`.trim();

    return {
      kind: 'prefill',
      surface: 'bill',
      url,
      summary,
    };
  },
};
