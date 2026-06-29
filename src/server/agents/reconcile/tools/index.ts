import { Prisma } from '@prisma/client';
import { writeAudit } from '@/server/audit';
import { prisma } from '@/server/db';
import { hasAnyRole } from '@/server/roles';
import type { ToolContext, ToolDefinition, AnthropicTool } from './types';
import { findGaps } from './find-gaps';
import { proposeUpdateProject } from './propose-update-project';
import {
  proposeBulkArchiveStale,
  proposeBulkReconcileActualEnd,
  proposeBulkReassignLead,
  proposeBulkStageTransition,
} from './propose-bulk-projects';

/**
 * Reconcile-assistant tool registry. Every tool is super-admin gated
 * at the route layer (the /admin/reconcile page + /api/reconcile/chat
 * both check hasAnyRole super_admin), so individual tools don't
 * re-check. Mutating tools never apply directly — they return a signed
 * proposal token that the confirm endpoint redeems.
 */
const ALL_TOOLS: readonly ToolDefinition[] = [
  findGaps,
  proposeUpdateProject,
  proposeBulkArchiveStale,
  proposeBulkReconcileActualEnd,
  proposeBulkReassignLead,
  proposeBulkStageTransition,
];

export function reconcileToolSpecs(): AnthropicTool[] {
  return ALL_TOOLS.map((t) => t.spec);
}

const BY_NAME = new Map<string, ToolDefinition>(
  ALL_TOOLS.map((t) => [t.spec.name, t]),
);

export async function runReconcileTool(
  ctx: ToolContext,
  name: string,
  input: unknown,
): Promise<unknown> {
  if (!hasAnyRole(ctx.session, ['super_admin'])) {
    return { error: 'permission_denied: reconcile tools are super-admin only.' };
  }
  const tool = BY_NAME.get(name);
  if (!tool) return { error: `unknown_tool: ${name}` };

  try {
    await prisma.$transaction(async (tx) => {
      await writeAudit(tx, {
        actor: { type: 'person', id: ctx.session.person.id },
        action: 'invoked',
        entity: {
          type: 'reconcile_tool',
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
    console.error('[reconcile.runReconcileTool] audit write failed:', err);
  }

  try {
    return await tool.run(ctx, input ?? {});
  } catch (err) {
    console.error(`[reconcile.runReconcileTool] ${name} failed:`, err);
    const message = err instanceof Error ? err.message : 'tool error';
    return { error: `tool_failed: ${message}` };
  }
}
