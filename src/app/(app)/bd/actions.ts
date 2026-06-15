'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import type { DealStage } from '@prisma/client';
import { prisma } from '@/server/db';
import { getSession } from '@/server/session';
import { hasCapability } from '@/server/capabilities';
import { writeAudit } from '@/server/audit';

const STAGE_VALUES = [
  'lead',
  'qualifying',
  'proposal',
  'negotiation',
  'won',
  'lost',
] as const;

const REORDER_LIMIT = 200;

// Reorder is disabled on closed lanes — won/lost are history columns,
// not priority queues.
const DEAL_REORDER_FORBIDDEN: DealStage[] = ['won', 'lost'];

export type MoveDealState =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | { status: 'success' };

const Schema = z.object({
  dealId: z.string().min(1),
  toStage: z.enum(STAGE_VALUES),
});

/**
 * Move a deal between pipeline stages — used by the BD kanban's drag &
 * drop. Mirrors the Projects kanban's `moveProject` shape (id+toStage in
 * formData, no path bind) so the client component can fan out one action
 * per drop without per-card bound functions.
 *
 * Auth: anyone with `deal.edit` (super_admin / admin / partner). Lost ↔
 * won transitions still go through the per-deal detail page where the
 * full conversion / archive flow handles downstream work; here we just
 * flip the column.
 */
export async function moveDeal(
  _prev: MoveDealState,
  formData: FormData,
): Promise<MoveDealState> {
  const session = await getSession();
  if (!session) return { status: 'error', message: 'Not signed in' };
  if (!hasCapability(session, 'deal.edit')) {
    return { status: 'error', message: 'Not authorized' };
  }

  const parsed = Schema.safeParse({
    dealId: formData.get('dealId'),
    toStage: formData.get('toStage'),
  });
  if (!parsed.success) {
    return { status: 'error', message: 'Invalid move' };
  }
  const { dealId, toStage } = parsed.data;

  const deal = await prisma.deal.findUnique({
    where: { id: dealId },
    select: { id: true, stage: true, archivedAt: true },
  });
  if (!deal) return { status: 'error', message: 'Deal not found' };
  if (deal.archivedAt) {
    return { status: 'error', message: 'Archived deals can\'t be moved.' };
  }
  if (deal.stage === toStage) return { status: 'success' };

  // Won is a plain stage move now — no auto-convert-to-project hook.
  // Convert remains an explicit action on the deal detail page so the
  // partner can capture project-specific commercials before spawning
  // the Project record. Dragging into "Won" just flips the column.

  try {
    await prisma.$transaction(async (tx) => {
      await tx.deal.update({
        where: { id: dealId },
        data: { stage: toStage as DealStage },
      });
      await writeAudit(tx, {
        actor: { type: 'person', id: session.person.id },
        action: 'stage_changed',
        entity: {
          type: 'deal',
          id: dealId,
          before: { stage: deal.stage },
          after: { stage: toStage, via: 'kanban_drag' },
        },
        source: 'web',
      });
    });
  } catch (err) {
    console.error('[bd.move] failed:', err);
    return { status: 'error', message: 'Move failed — try again.' };
  }

  revalidatePath('/bd');
  return { status: 'success' };
}

// ─── Inline kanban quick-create ────────────────────────────────────────
//
// Mandatory fields ONLY — stage (from the column the partner clicked
// "+ Add deal" in), owner, and either an existing client or a
// prospective-name placeholder. Everything else (expected value,
// probability, engagement type, name, sector, etc.) defers to the deal
// detail page so an opportunity that surfaces in a phone call can be
// captured in three taps without leaving the board.

export type QuickCreateState =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | { status: 'success'; dealId: string };

const QuickCreateSchema = z
  .object({
    stage: z.enum(STAGE_VALUES),
    ownerId: z.string().min(1, 'Pick an owner'),
    clientId: z
      .string()
      .optional()
      .nullable()
      .or(z.literal('').transform(() => null)),
    prospectiveName: z
      .string()
      .trim()
      .max(200)
      .optional()
      .nullable()
      .or(z.literal('').transform(() => null)),
    prospectiveProjectDetail: z
      .string()
      .trim()
      .max(4000)
      .optional()
      .nullable()
      .or(z.literal('').transform(() => null)),
  })
  .refine(
    (v) => Boolean(v.clientId) || Boolean(v.prospectiveName),
    {
      message: 'Pick a client or type a prospective name.',
      path: ['clientId'],
    },
  );

async function generateDealCode(): Promise<string> {
  // Same shape used by /bd/new — DEAL-YYMM-XXX, monotonic per month.
  const today = new Date();
  const y = String(today.getUTCFullYear()).slice(2);
  const m = String(today.getUTCMonth() + 1).padStart(2, '0');
  const prefix = `DEAL-${y}${m}-`;
  const last = await prisma.deal.findFirst({
    where: { code: { startsWith: prefix } },
    orderBy: { code: 'desc' },
    select: { code: true },
  });
  const nextSeq = last
    ? Number(last.code.slice(prefix.length)) + 1
    : 1;
  return `${prefix}${String(nextSeq).padStart(3, '0')}`;
}

export async function quickCreateDeal(
  _prev: QuickCreateState,
  formData: FormData,
): Promise<QuickCreateState> {
  const session = await getSession();
  if (!session) return { status: 'error', message: 'Not signed in' };
  if (!hasCapability(session, 'deal.create')) {
    return { status: 'error', message: 'Not authorized' };
  }

  const parsed = QuickCreateSchema.safeParse({
    stage: formData.get('stage'),
    ownerId: formData.get('ownerId'),
    clientId: formData.get('clientId'),
    prospectiveName: formData.get('prospectiveName'),
    prospectiveProjectDetail: formData.get('prospectiveProjectDetail'),
  });
  if (!parsed.success) {
    return {
      status: 'error',
      message: parsed.error.issues[0]?.message ?? 'Invalid input',
    };
  }
  const data = parsed.data;

  // No won-stage gate — kanban moves and quick-creates land at Won
  // cleanly. Project conversion is an explicit step on the deal detail
  // page now, not an automatic side-effect of stage transition.

  // If the client picker was used, verify it's not archived. The detail
  // page allows working with archived clients but the kanban shouldn't
  // create new pipeline against one.
  if (data.clientId) {
    const client = await prisma.client.findUnique({
      where: { id: data.clientId },
      select: { id: true, archivedAt: true },
    });
    if (!client) {
      return { status: 'error', message: 'Client not found' };
    }
    if (client.archivedAt) {
      return {
        status: 'error',
        message: 'Client is archived — pick another or use a prospective name.',
      };
    }
  }

  let newId: string;
  try {
    newId = await prisma.$transaction(async (tx) => {
      const code = await generateDealCode();
      const deal = await tx.deal.create({
        data: {
          code,
          name: null,
          stage: data.stage as DealStage,
          expectedValue: 0,
          probability: 0,
          ownerId: data.ownerId,
          clientId: data.clientId ?? null,
          prospectiveName: data.clientId ? null : data.prospectiveName,
          prospectiveProjectDetail: data.prospectiveProjectDetail ?? null,
        },
      });
      await writeAudit(tx, {
        actor: { type: 'person', id: session.person.id },
        action: 'created',
        entity: {
          type: 'deal',
          id: deal.id,
          after: {
            code: deal.code,
            stage: deal.stage,
            ownerId: deal.ownerId,
            clientId: deal.clientId,
            prospectiveName: deal.prospectiveName,
            via: 'kanban_quick_create',
          },
        },
        source: 'web',
      });
      return deal.id;
    });
  } catch (err) {
    console.error('[bd.quickCreate] failed:', err);
    return { status: 'error', message: 'Create failed — try again.' };
  }

  revalidatePath('/bd');
  return { status: 'success', dealId: newId };
}

// ─── Within-column priority ranking ────────────────────────────────
//
// `reorderDealsInStage` accepts the full ordered list of deal IDs in a
// single column and renumbers `sortOrder` 1..N for all of them. Same
// shape as `reorderProjectsInStage`; volume per column is small enough
// (≤30 deals at firm scale) that renumber-on-every-reorder beats the
// complexity of fractional ranks.

export type ReorderDealsState =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | { status: 'success' };

const ReorderDealsSchema = z.object({
  stage: z.enum(STAGE_VALUES),
  orderedIds: z.array(z.string().min(1)).min(1).max(REORDER_LIMIT),
});

export async function reorderDealsInStage(
  _prev: ReorderDealsState,
  formData: FormData,
): Promise<ReorderDealsState> {
  const session = await getSession();
  if (!session) return { status: 'error', message: 'Not signed in' };
  if (!hasCapability(session, 'deal.edit')) {
    return { status: 'error', message: 'Not authorized' };
  }

  const orderedIdsRaw = formData.get('orderedIds');
  const parsed = ReorderDealsSchema.safeParse({
    stage: formData.get('stage'),
    orderedIds:
      typeof orderedIdsRaw === 'string' && orderedIdsRaw.length > 0
        ? orderedIdsRaw.split(',')
        : [],
  });
  if (!parsed.success) {
    return { status: 'error', message: 'Invalid reorder' };
  }
  const { stage, orderedIds } = parsed.data;

  if (DEAL_REORDER_FORBIDDEN.includes(stage as DealStage)) {
    return {
      status: 'error',
      message: `${stage} is a closed lane — priority ranking is disabled.`,
    };
  }

  // Validate every id is real, in the claimed stage, AND not archived
  // (archived deals are read-only — `moveDeal` rejects them too).
  const existing = await prisma.deal.findMany({
    where: {
      id: { in: orderedIds },
      stage: stage as DealStage,
      archivedAt: null,
    },
    select: { id: true, code: true, sortOrder: true },
  });
  if (existing.length !== orderedIds.length) {
    return {
      status: 'error',
      message: 'Card list out of sync — refresh and try again.',
    };
  }
  const existingById = new Map(existing.map((d) => [d.id, d]));
  const before = orderedIds.map((id) => {
    const row = existingById.get(id);
    return { id, code: row?.code ?? null, sortOrder: row?.sortOrder ?? null };
  });

  try {
    await prisma.$transaction(async (tx) => {
      for (let i = 0; i < orderedIds.length; i += 1) {
        await tx.deal.update({
          where: { id: orderedIds[i]! },
          data: { sortOrder: i + 1 },
        });
      }
      const after = orderedIds.map((id, i) => ({
        id,
        code: existingById.get(id)?.code ?? null,
        sortOrder: i + 1,
      }));
      await writeAudit(tx, {
        actor: { type: 'person', id: session.person.id },
        action: 'reordered',
        entity: {
          type: 'deal_kanban',
          id: `stage:${stage}`,
          before: { stage, order: before },
          after: { stage, order: after },
        },
        source: 'web',
      });
    });
  } catch (err) {
    console.error('[bd.reorder] failed:', err);
    return { status: 'error', message: 'Reorder failed — try again.' };
  }

  revalidatePath('/bd');
  return { status: 'success' };
}
