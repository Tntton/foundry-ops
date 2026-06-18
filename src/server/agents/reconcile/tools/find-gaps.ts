import { z } from 'zod';
import { computeReconcileQueue } from '@/server/reconcile/gap-finder';
import type { ToolDefinition } from './types';

/**
 * Read the deterministic reconciliation queue — the same list the
 * /admin/reconcile left pane shows. Lets the agent answer "what's most
 * pressing?" without making the user click around.
 */
const InputSchema = z.object({
  impact: z
    .enum(['1', '2', '3', 'all'])
    .default('all')
    .describe('Filter to a single impact tier ("3" blocking / "2" stale / "1" nice-to-have) or "all".'),
  category: z
    .enum([
      'project',
      'deal',
      'person',
      'client',
      'commercial',
      'timesheet',
      'expense',
      'document',
      'all',
    ])
    .default('all')
    .describe('Filter to one entity category, or "all".'),
  limit: z.coerce.number().int().min(1).max(50).default(15),
});

export const findGaps: ToolDefinition = {
  spec: {
    name: 'find_gaps',
    description:
      'Return the current open reconciliation questions (data gaps) across projects, deals, people, and clients. Sorted highest-impact first. Use this to answer "what should I fix next" or to pick the next item to walk the user through.',
    input_schema: {
      type: 'object',
      properties: {
        impact: {
          type: 'string',
          enum: ['1', '2', '3', 'all'],
          description:
            'Filter to a single impact tier — "3" blocking, "2" stale, "1" nice-to-have, or "all".',
        },
        category: {
          type: 'string',
          enum: [
            'project',
            'deal',
            'person',
            'client',
            'commercial',
            'timesheet',
            'expense',
            'document',
            'all',
          ],
          description: 'Optional category filter.',
        },
        limit: {
          type: 'number',
          minimum: 1,
          maximum: 50,
          description: 'Max gaps to return (default 15).',
        },
      },
    },
  },
  async run(_ctx, input) {
    const parsed = InputSchema.safeParse(input);
    if (!parsed.success) {
      return { error: `invalid_input: ${parsed.error.issues[0]?.message ?? 'bad shape'}` };
    }
    const { impact, category, limit } = parsed.data;
    const all = await computeReconcileQueue();
    const filtered = all
      .filter((g) => (impact === 'all' ? true : String(g.impact) === impact))
      .filter((g) => (category === 'all' ? true : g.category === category))
      .slice(0, limit);
    return {
      total: all.length,
      returned: filtered.length,
      gaps: filtered.map((g) => ({
        key: g.key,
        impact: g.impact,
        category: g.category,
        title: g.title,
        detail: g.detail ?? null,
        href: g.href ?? null,
        entity: g.entity,
        field: g.field,
      })),
    };
  },
};
