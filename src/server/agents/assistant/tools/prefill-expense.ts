import { Prisma } from '@prisma/client';
import { prisma } from '@/server/db';
import { writeAudit } from '@/server/audit';
import {
  EXPENSE_CATEGORY_VALUES,
  type ExpenseCategory,
} from '@/lib/expense-categories';
import {
  ExpensePrefillSchema,
  type ExpensePrefillPayload,
} from '@/server/agents/assistant/prefill/schemas';
import { signPrefillToken } from '@/server/agents/assistant/prefill/token';
import type { ToolDefinition } from './types';

export const prefillExpense: ToolDefinition<ExpensePrefillPayload> = {
  spec: {
    name: 'prefill_expense',
    description:
      "Prefill /expenses/new with a reimbursable expense the user described. Amount is in AUD dollars (inc GST); GST defaults to total/11 if omitted. Project code is optional — leave blank for OPEX. Category must be one of the canonical snake_case values (call list_expense_categories if unsure). Returns a URL the widget renders as 'Open prefilled expense' — the user reviews + submits via the form's normal flow.",
    input_schema: {
      type: 'object',
      properties: {
        dateIso: { type: 'string', description: 'YYYY-MM-DD' },
        amountDollars: { type: 'number', description: 'Gross total, AUD (inc GST).' },
        gstDollars: { type: 'number', description: 'AU GST. Defaults to amount/11.' },
        category: {
          type: 'string',
          description:
            'Canonical category enum. Call list_expense_categories first if unsure.',
        },
        vendor: { type: 'string', description: 'Optional — Qantas, Uber, Officeworks…' },
        description: { type: 'string', description: 'One-line description.' },
        projectCode: {
          type: 'string',
          description: 'Optional project code. Leave blank / omit for OPEX.',
        },
      },
      required: ['dateIso', 'amountDollars', 'category', 'description'],
    },
  },
  async run(ctx, raw) {
    const parsed = ExpensePrefillSchema.safeParse(raw);
    if (!parsed.success) {
      return {
        error: `invalid_payload: ${parsed.error.issues[0]?.message ?? 'check inputs'}`,
      };
    }
    const personId = ctx.session.person.id;
    const data = parsed.data;

    // Validate category against the canonical list — saves the user
    // a round-trip vs the form rejecting a hallucinated value.
    if (
      !(EXPENSE_CATEGORY_VALUES as readonly string[]).includes(data.category)
    ) {
      return {
        error: `unknown_category: '${data.category}' is not in the canonical list. Call list_expense_categories.`,
      };
    }
    // Cross-check project code if supplied.
    if (data.projectCode) {
      const code = data.projectCode.toUpperCase();
      const project = await prisma.project.findUnique({
        where: { code },
        select: { code: true, stage: true },
      });
      if (!project) {
        return {
          error: `unknown_project_code: ${code}. Call find_project first or omit projectCode for OPEX.`,
        };
      }
      if (project.stage === 'archived') {
        return {
          error: `archived_project: ${code}. Leave projectCode blank to log as OPEX instead.`,
        };
      }
    }

    const token = signPrefillToken({
      kind: 'expense',
      personId,
      payload: data,
    });
    const url = `/expenses/new?prefill=${encodeURIComponent(token)}`;
    try {
      await prisma.$transaction(async (tx) => {
        await writeAudit(tx, {
          actor: { type: 'person', id: personId },
          action: 'minted',
          entity: {
            type: 'assistant_prefill',
            id: `${personId}:expense:${data.dateIso}`,
            after: {
              kind: 'expense',
              payload: data as unknown as Prisma.InputJsonValue,
            },
          },
          source: 'agent',
        });
      });
    } catch (err) {
      console.error('[prefill_expense] audit mint failed:', err);
    }

    const summary = `Open the expense form for $${data.amountDollars.toFixed(2)} ${
      data.vendor ? `at ${data.vendor}` : ''
    }${data.projectCode ? ` (${data.projectCode.toUpperCase()})` : ' (OPEX)'} — ${
      data.description
    }`.trim();

    return {
      kind: 'prefill',
      surface: 'expense',
      url,
      summary,
      category: data.category as ExpenseCategory,
    };
  },
};
