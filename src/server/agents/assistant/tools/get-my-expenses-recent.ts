import { z } from 'zod';
import { prisma } from '@/server/db';
import type { ToolDefinition } from './types';

const Input = z
  .object({
    limit: z.coerce.number().int().min(1).max(20).optional().default(5),
  })
  .optional();

export const getMyExpensesRecent: ToolDefinition<z.infer<typeof Input>> = {
  spec: {
    name: 'get_my_expenses_recent',
    description:
      "Return the current user's most recent expense submissions (default 5, max 20). Each row has date, vendor, category, amount in dollars, status, project code if tagged, and the description. Useful both for 'what did I submit recently' answers AND for pattern-matching a new prefill ('another office one like last week's').",
    input_schema: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'How many to return (1–20). Default 5.',
        },
      },
    },
  },
  async run(ctx, raw) {
    const parsed = Input.safeParse(raw);
    const limit = parsed.success ? parsed.data?.limit ?? 5 : 5;
    const rows = await prisma.expense.findMany({
      where: { personId: ctx.session.person.id },
      orderBy: { date: 'desc' },
      take: limit,
      select: {
        id: true,
        date: true,
        vendor: true,
        category: true,
        amount: true,
        gst: true,
        description: true,
        status: true,
        project: { select: { code: true, name: true } },
      },
    });
    return {
      rows: rows.map((e) => ({
        id: e.id,
        dateIso: e.date.toISOString().slice(0, 10),
        vendor: e.vendor,
        category: e.category,
        amountDollars: Number((e.amount / 100).toFixed(2)),
        gstDollars: Number((e.gst / 100).toFixed(2)),
        description: e.description,
        status: e.status,
        projectCode: e.project?.code ?? null,
        projectName: e.project?.name ?? null,
        link: `/expenses/${e.id}`,
      })),
    };
  },
};
