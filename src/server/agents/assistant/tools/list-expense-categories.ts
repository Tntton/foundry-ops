import { EXPENSE_CATEGORIES } from '@/lib/expense-categories';
import type { ToolDefinition } from './types';

export const listExpenseCategories: ToolDefinition = {
  spec: {
    name: 'list_expense_categories',
    description:
      "Return the canonical Foundry expense / bill category enum values + short labels. Call this BEFORE proposing a prefilled expense or bill so you can pick the correct snake_case value instead of guessing. The list is short (~18 categories) — feel free to include it inline in your reasoning.",
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
  async run() {
    return {
      rows: EXPENSE_CATEGORIES.map((c) => ({
        value: c.value,
        label: c.label,
      })),
    };
  },
};
