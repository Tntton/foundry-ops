import { z } from 'zod';
import { listRateCardAsOf } from '@/server/rate-card';
import type { ToolDefinition } from './types';

const Input = z.object({
  roleCode: z.string().trim().min(1).max(10),
});

export const getActiveRateCardForRole: ToolDefinition<z.infer<typeof Input>> = {
  spec: {
    name: 'get_active_rate_card_for_role',
    description:
      "Return the currently-active rate card row for a given role code (e.g. 'E1', 'A2'). Includes cost rate + bill rate low/high in dollars per hour. Useful when prefilling an invoice line and the user references a role/level. Gated on the ratecard.view capability — returns an error for users who can't see rates.",
    input_schema: {
      type: 'object',
      properties: {
        roleCode: {
          type: 'string',
          description: "Role code like 'MP', 'P', 'E1', 'A2'.",
        },
      },
      required: ['roleCode'],
    },
  },
  capability: 'ratecard.view',
  async run(_ctx, raw) {
    const parsed = Input.safeParse(raw);
    if (!parsed.success) return { error: 'roleCode is required' };
    const all = await listRateCardAsOf(new Date());
    const target = parsed.data.roleCode.toUpperCase();
    const row = all.find((r) => r.roleCode === target);
    if (!row) {
      return { error: `No active rate card row for role '${target}'.` };
    }
    return {
      roleCode: row.roleCode,
      effectiveFromIso: row.effectiveFrom.toISOString().slice(0, 10),
      costDollarsPerHour: Number((row.costRate / 100).toFixed(2)),
      billLowDollarsPerHour: Number((row.billRateLow / 100).toFixed(2)),
      billHighDollarsPerHour: Number((row.billRateHigh / 100).toFixed(2)),
    };
  },
};
