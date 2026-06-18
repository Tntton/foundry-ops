import type { AssistantThreadKind, Prisma } from '@prisma/client';
import { prisma } from '@/server/db';
import { writeAudit } from '@/server/audit';

/**
 * Hard cap on turns per thread before we auto-archive. A "turn" =
 * one user message + one assistant response, so 50 turns ≈ 100 rows.
 */
export const ASSISTANT_MAX_TURNS = 50;

/**
 * Context-window cap fed to Claude. We persist the entire thread but
 * only the last N messages are sent to the model each turn.
 */
export const ASSISTANT_HISTORY_TURNS = 20;

/**
 * Fetch (or create) the single active thread for a person + assistant
 * kind. Threads are cheap; the first message of a fresh user creates one
 * lazily. Kind defaults to `general` (the in-app helper); pass
 * `reconcile` for the admin reconciliation assistant.
 */
export async function getOrCreateActiveThread(
  personId: string,
  kind: AssistantThreadKind = 'general',
): Promise<{ id: string; createdAt: Date; turnCount: number }> {
  const existing = await prisma.assistantThread.findFirst({
    where: { personId, kind, status: 'active' },
    select: {
      id: true,
      createdAt: true,
      _count: { select: { messages: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
  if (existing) {
    // Two messages per turn (user + assistant). We count messages instead
    // of "turns" so a half-finished turn still increments toward the cap.
    return {
      id: existing.id,
      createdAt: existing.createdAt,
      turnCount: Math.floor(existing._count.messages / 2),
    };
  }
  const created = await prisma.$transaction(async (tx) => {
    const t = await tx.assistantThread.create({
      data: { personId, kind },
      select: { id: true, createdAt: true },
    });
    await writeAudit(tx, {
      actor: { type: 'person', id: personId },
      action: 'created',
      entity: { type: 'assistant_thread', id: t.id, after: { status: 'active', kind } },
      source: 'web',
    });
    return t;
  });
  return { id: created.id, createdAt: created.createdAt, turnCount: 0 };
}

/**
 * Archive the active thread (if any) and create a new one. Used by the
 * widget's reset button. Idempotent — calling on a person with no active
 * thread just creates a fresh one. Kind defaults to `general`.
 */
export async function resetActiveThread(
  personId: string,
  kind: AssistantThreadKind = 'general',
): Promise<{ id: string }> {
  return prisma.$transaction(async (tx) => {
    const active = await tx.assistantThread.findFirst({
      where: { personId, kind, status: 'active' },
      select: { id: true },
    });
    if (active) {
      await tx.assistantThread.update({
        where: { id: active.id },
        data: { status: 'archived' },
      });
      await writeAudit(tx, {
        actor: { type: 'person', id: personId },
        action: 'archived',
        entity: { type: 'assistant_thread', id: active.id, before: { status: 'active' }, after: { status: 'archived' } },
        source: 'web',
      });
    }
    const fresh = await tx.assistantThread.create({
      data: { personId, kind },
      select: { id: true },
    });
    await writeAudit(tx, {
      actor: { type: 'person', id: personId },
      action: 'created',
      entity: { type: 'assistant_thread', id: fresh.id, after: { status: 'active', kind } },
      source: 'web',
    });
    return { id: fresh.id };
  });
}

/**
 * Auto-archive when the turn count hits the cap. Called after the
 * assistant reply lands. Best-effort — failures don't propagate (the
 * user got their answer; archive is a maintenance step).
 */
export async function maybeArchiveIfFull(
  threadId: string,
  personId: string,
): Promise<void> {
  try {
    const count = await prisma.assistantMessage.count({ where: { threadId } });
    if (count < ASSISTANT_MAX_TURNS * 2) return;
    await prisma.$transaction(async (tx) => {
      await tx.assistantThread.update({
        where: { id: threadId },
        data: { status: 'archived' },
      });
      await writeAudit(tx, {
        actor: { type: 'person', id: personId },
        action: 'archived',
        entity: {
          type: 'assistant_thread',
          id: threadId,
          before: { status: 'active' },
          after: { status: 'archived', reason: 'turn_cap' },
        },
        source: 'web',
      });
    });
  } catch (err) {
    console.error('[assistant.maybeArchiveIfFull] failed:', err);
  }
}

export type StoredMessage = {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  createdAt: Date;
};

/**
 * Last N messages for a thread, oldest-first. Used both to seed the
 * widget on load and to feed Claude the conversation context (the
 * route then crops to ASSISTANT_HISTORY_TURNS * 2).
 */
export async function listThreadMessages(
  threadId: string,
): Promise<StoredMessage[]> {
  const rows = await prisma.assistantMessage.findMany({
    where: { threadId },
    orderBy: { createdAt: 'asc' },
    select: { id: true, role: true, content: true, createdAt: true },
  });
  return rows;
}

/**
 * Crop to the last `ASSISTANT_HISTORY_TURNS * 2` rows so the model
 * doesn't see a runaway context window. Exported for the Vitest test
 * — the route uses it directly.
 */
export function cropHistory<T>(history: readonly T[]): T[] {
  const max = ASSISTANT_HISTORY_TURNS * 2;
  if (history.length <= max) return [...history];
  return history.slice(history.length - max);
}

/** Append a row inside an existing transaction. Used by the SSE route
 *  so the user-message write is part of the same audit batch. */
export async function appendMessage(
  tx: Prisma.TransactionClient,
  input: {
    threadId: string;
    personId: string;
    role: 'user' | 'assistant' | 'tool';
    content: string;
  },
): Promise<{ id: string }> {
  const msg = await tx.assistantMessage.create({
    data: {
      threadId: input.threadId,
      role: input.role,
      content: input.content,
    },
    select: { id: true },
  });
  await tx.assistantThread.update({
    where: { id: input.threadId },
    data: { lastMessageAt: new Date() },
  });
  await writeAudit(tx, {
    actor: { type: 'person', id: input.personId },
    action: 'created',
    entity: {
      type: 'assistant_message',
      id: msg.id,
      after: { threadId: input.threadId, role: input.role },
    },
    source: 'web',
  });
  return msg;
}
