import { diff } from 'deep-diff';
import { Prisma } from '@prisma/client';
import type { AuditSource, ActorType } from '@prisma/client';

export type AuditActor =
  | { type: 'person'; id: string }
  | { type: 'agent'; id: string } // AgentRun id
  | { type: 'system' };

export type AuditEntity = {
  type: string; // 'invoice' | 'expense' | 'person' | 'project' | 'client' | …
  id: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
};

export type AuditInput = {
  actor: AuditActor;
  action: string; // 'created' | 'updated' | 'deleted' | 'approved' | 'rejected' | 'sent' | 'synced'
  entity: AuditEntity;
  source: AuditSource;
  ip?: string | null;
  userAgent?: string | null;
};

/**
 * Compute a structured delta for storage in AuditEvent.entityDelta.
 * - New entity: `{ created: after }`
 * - Deleted entity: `{ deleted: before }`
 * - Updated entity: `{ changes: Diff[] }` (from deep-diff; empty means no-op, returns null)
 * - No before or after: null
 */
export function computeDelta(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if ((before === undefined || before === null) && (after === undefined || after === null)) {
    return null;
  }
  if (before === undefined || before === null) {
    return { created: after };
  }
  if (after === undefined || after === null) {
    return { deleted: before };
  }
  const changes = diff(before, after);
  if (!changes || changes.length === 0) return null;
  // deep-diff returns rich objects with lhs/rhs/kind — serialize to plain JSON
  return { changes: JSON.parse(JSON.stringify(changes)) as unknown };
}

/**
 * Write an AuditEvent row on the given Prisma transaction. MUST be called from
 * inside an interactive transaction (`prisma.$transaction(async (tx) => { ... })`)
 * so the audit row rolls back with the mutation if anything later throws.
 */
export async function writeAudit(
  tx: Prisma.TransactionClient,
  input: AuditInput,
): Promise<void> {
  const actorId = input.actor.type === 'system' ? null : input.actor.id;
  const actorType: ActorType = input.actor.type;
  const delta = computeDelta(input.entity.before, input.entity.after);

  await tx.auditEvent.create({
    data: {
      actorId,
      actorType,
      action: input.action,
      entityType: input.entity.type,
      entityId: input.entity.id,
      entityDelta: delta === null ? Prisma.JsonNull : (delta as Prisma.InputJsonValue),
      source: input.source,
      ip: input.ip ?? null,
      userAgent: input.userAgent ?? null,
    },
  });
}
