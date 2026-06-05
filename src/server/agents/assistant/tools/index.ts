import { Prisma } from '@prisma/client';
import { hasCapability } from '@/server/capabilities';
import { writeAudit } from '@/server/audit';
import { prisma } from '@/server/db';
import type { ToolContext, ToolDefinition, AnthropicTool } from './types';
import { listMyApprovals } from './list-my-approvals';
import { listMyProjects } from './list-my-projects';
import { getMyHoursThisWeek } from './get-my-hours-this-week';
import { findProject } from './find-project';
import { findPerson } from './find-person';
import { getMyExpensesRecent } from './get-my-expenses-recent';
import { listExpenseCategories } from './list-expense-categories';
import { getActiveRateCardForRole } from './get-active-rate-card-for-role';
import { prefillTimesheet } from './prefill-timesheet';
import { prefillExpense } from './prefill-expense';
import { prefillBill } from './prefill-bill';
import { prefillInvoice } from './prefill-invoice';
import { proposeQuickRecruit } from './propose-quick-recruit';
import { proposeFeedbackTicket } from './propose-feedback-ticket';

/**
 * Ordered registry of every assistant tool. Order in this array drives
 * the order Anthropic sees the tools in — putting the listing tools
 * first nudges the model to call them before reaching for fuzzy
 * `find_*` lookups when the user's input is generic.
 */
const ALL_TOOLS: readonly ToolDefinition[] = [
  listMyApprovals,
  listMyProjects,
  getMyHoursThisWeek,
  findProject,
  findPerson,
  getMyExpensesRecent,
  listExpenseCategories,
  getActiveRateCardForRole,
  // Phase 3 — prefill family. Each tool returns a deep-link URL the
  // widget renders as a card; the form's existing action handles the
  // write. The assistant never bypasses form validation.
  prefillTimesheet,
  prefillExpense,
  prefillBill,
  prefillInvoice,
  // Phase 3d — propose family. Confirmation cards for actions
  // without a meaningful "form to inspect" (low-field one-shots).
  proposeQuickRecruit,
  proposeFeedbackTicket,
];

/** Anthropic tool specs ready to pass to `client.messages.stream({ tools })`. */
export function assistantToolSpecs(): AnthropicTool[] {
  return ALL_TOOLS.map((t) => t.spec);
}

const BY_NAME = new Map<string, ToolDefinition>(
  ALL_TOOLS.map((t) => [t.spec.name, t]),
);

/**
 * Run a tool by name with the given input. Handles capability gating,
 * audit-event writes, and graceful fallback when the model invents a
 * tool name (returns an `{ error }` object instead of throwing).
 *
 * Audit uses `source='agent'` to match the WhatsApp router's existing
 * attribution — one filter ("source = agent") then surfaces every
 * agent-mediated interaction across both channels.
 */
export async function runAssistantTool(
  ctx: ToolContext,
  name: string,
  input: unknown,
): Promise<unknown> {
  const tool = BY_NAME.get(name);
  if (!tool) {
    return { error: `unknown_tool: ${name}` };
  }
  if (tool.capability && !hasCapability(ctx.session, tool.capability)) {
    return {
      error: `permission_denied: this tool needs the '${tool.capability}' capability, which your role doesn't have.`,
    };
  }
  // Pre-write the invocation audit so it lands even if the tool throws.
  // (The tool's own internal writes — if any — would go inside a
  // transaction; reads don't need that wrapper.)
  try {
    await prisma.$transaction(async (tx) => {
      await writeAudit(tx, {
        actor: { type: 'person', id: ctx.session.person.id },
        action: 'invoked',
        entity: {
          type: 'assistant_tool',
          id: name,
          after: {
            tool: name,
            input: (input ?? null) as Prisma.InputJsonValue,
          },
        },
        source: 'agent',
      });
    });
  } catch (err) {
    console.error('[assistant.runAssistantTool] audit write failed:', err);
  }

  try {
    return await tool.run(ctx, input ?? {});
  } catch (err) {
    console.error(`[assistant.runAssistantTool] ${name} failed:`, err);
    const message = err instanceof Error ? err.message : 'tool error';
    return { error: `tool_failed: ${message}` };
  }
}

export { ALL_TOOLS };
