'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { getSession } from '@/server/session';
import { requireCapability } from '@/server/capabilities';
import { writeAudit } from '@/server/audit';
import { notifyAdminPool } from '@/server/user-updates';

/**
 * Bulk update of the rate card from the editable table on
 * `/admin/rate-card`.
 *
 * Versioning rules — these are non-negotiable to keep historical
 * project costs stable:
 *
 *   - Existing RateCard rows are NEVER mutated. Every saved change
 *     INSERTs a new row keyed on (roleCode, effectiveFrom).
 *   - The operator picks ONE effective date for the whole save.
 *     Every changed row picks up that date.
 *   - Rows whose values match the current effective row are no-ops —
 *     we don't pollute history with rows that don't change anything.
 *   - Effective date in the past is rejected (>= today). Prospective
 *     changes only — historic edits would silently re-cost completed
 *     projects, which is exactly what the versioning model is meant
 *     to prevent.
 *
 * Audit: one `updated` event per inserted row, with before / after
 * cents capturing the diff so admin can replay the change history.
 */

const RowSchema = z.object({
  roleCode: z.string().trim().toUpperCase().min(1).max(4),
  // Operator types dollars; we coerce to cents inside the action.
  costRateDollars: z.coerce.number().min(0).max(10_000),
  billRateLowDollars: z.coerce.number().min(0).max(10_000),
  billRateHighDollars: z.coerce.number().min(0).max(10_000),
});

const SaveSchema = z
  .object({
    effectiveFrom: z.coerce.date(),
    rows: z.array(RowSchema).min(1),
  })
  .refine(
    (v) => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      return v.effectiveFrom.getTime() >= today.getTime();
    },
    {
      message:
        'Effective date must be today or later — back-dated changes would re-cost completed projects.',
      path: ['effectiveFrom'],
    },
  );

export type RateCardSaveState =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | {
      status: 'success';
      changedCount: number;
      effectiveFrom: string;
    };

export async function saveRateCardChanges(
  _prev: RateCardSaveState,
  formData: FormData,
): Promise<RateCardSaveState> {
  const session = await getSession();
  try {
    requireCapability(session, 'ratecard.edit');
  } catch {
    return { status: 'error', message: 'Not authorized' };
  }

  // Form sends positional arrays — one entry per role row, plus a
  // single effectiveFrom field. Zip them.
  const roleCodes = formData.getAll('roleCode').map(String);
  const costs = formData.getAll('costRateDollars').map(String);
  const billLows = formData.getAll('billRateLowDollars').map(String);
  const billHighs = formData.getAll('billRateHighDollars').map(String);
  const rows = roleCodes.map((roleCode, i) => ({
    roleCode,
    costRateDollars: costs[i] ?? '0',
    billRateLowDollars: billLows[i] ?? '0',
    billRateHighDollars: billHighs[i] ?? '0',
  }));

  const parsed = SaveSchema.safeParse({
    effectiveFrom: formData.get('effectiveFrom'),
    rows,
  });
  if (!parsed.success) {
    return {
      status: 'error',
      message: parsed.error.issues[0]?.message ?? 'Invalid input',
    };
  }
  const { effectiveFrom, rows: parsedRows } = parsed.data;

  // Pull the currently-effective row for each role so we can diff.
  const codes = parsedRows.map((r) => r.roleCode);
  const allHist = await prisma.rateCard.findMany({
    where: { roleCode: { in: codes } },
    orderBy: [{ roleCode: 'asc' }, { effectiveFrom: 'desc' }],
  });
  const currentByCode = new Map<string, { costRate: number; billRateLow: number; billRateHigh: number; effectiveFrom: Date } | null>();
  for (const code of codes) currentByCode.set(code, null);
  for (const h of allHist) {
    // Most recent (effectiveFrom desc) wins for each code; first one
    // we see for a code is the current.
    if (h.effectiveFrom.getTime() > effectiveFrom.getTime()) continue;
    if (currentByCode.get(h.roleCode)) continue;
    currentByCode.set(h.roleCode, {
      costRate: h.costRate,
      billRateLow: h.billRateLow,
      billRateHigh: h.billRateHigh,
      effectiveFrom: h.effectiveFrom,
    });
  }
  // Also reject inserting a row that already exists for the picked
  // effective date — operator should pick a different date.
  const collisionsAtDate = allHist.filter(
    (h) =>
      h.effectiveFrom.getTime() === effectiveFrom.getTime() &&
      codes.includes(h.roleCode),
  );

  // Compute the changed set.
  const toInsert: Array<{
    roleCode: string;
    costRate: number;
    billRateLow: number;
    billRateHigh: number;
    before: { costRate: number; billRateLow: number; billRateHigh: number } | null;
  }> = [];
  for (const r of parsedRows) {
    const cents = {
      costRate: Math.round(r.costRateDollars * 100),
      billRateLow: Math.round(r.billRateLowDollars * 100),
      billRateHigh: Math.round(r.billRateHighDollars * 100),
    };
    if (cents.billRateHigh < cents.billRateLow) {
      return {
        status: 'error',
        message: `${r.roleCode}: bill rate high must be ≥ low.`,
      };
    }
    if (
      collisionsAtDate.find(
        (c) =>
          c.roleCode === r.roleCode &&
          c.costRate === cents.costRate &&
          c.billRateLow === cents.billRateLow &&
          c.billRateHigh === cents.billRateHigh,
      )
    ) {
      // Idempotent re-save — already exists with these values.
      continue;
    }
    if (
      collisionsAtDate.find((c) => c.roleCode === r.roleCode) &&
      currentByCode.get(r.roleCode)?.effectiveFrom.getTime() ===
        effectiveFrom.getTime()
    ) {
      return {
        status: 'error',
        message: `${r.roleCode}: a row already exists for ${effectiveFrom.toISOString().slice(0, 10)} with different values. Pick a later effective date.`,
      };
    }
    const cur = currentByCode.get(r.roleCode);
    const unchanged =
      cur &&
      cur.costRate === cents.costRate &&
      cur.billRateLow === cents.billRateLow &&
      cur.billRateHigh === cents.billRateHigh;
    if (unchanged) continue;
    toInsert.push({
      roleCode: r.roleCode,
      ...cents,
      before: cur
        ? {
            costRate: cur.costRate,
            billRateLow: cur.billRateLow,
            billRateHigh: cur.billRateHigh,
          }
        : null,
    });
  }

  if (toInsert.length === 0) {
    return {
      status: 'success',
      changedCount: 0,
      effectiveFrom: effectiveFrom.toISOString().slice(0, 10),
    };
  }

  try {
    await prisma.$transaction(async (tx) => {
      for (const ins of toInsert) {
        const created = await tx.rateCard.create({
          data: {
            roleCode: ins.roleCode,
            effectiveFrom,
            costRate: ins.costRate,
            billRateLow: ins.billRateLow,
            billRateHigh: ins.billRateHigh,
          },
        });
        await writeAudit(tx, {
          actor: { type: 'person', id: session!.person.id },
          action: 'updated',
          entity: {
            type: 'rate_card',
            id: created.id,
            before: ins.before,
            after: {
              roleCode: ins.roleCode,
              effectiveFrom: effectiveFrom.toISOString().slice(0, 10),
              costRate: ins.costRate,
              billRateLow: ins.billRateLow,
              billRateHigh: ins.billRateHigh,
            },
          },
          source: 'web',
        });
      }
      // Single rolled-up admin-pool feed entry — one click drops the
      // viewer onto the rate-card page where the diff is visible.
      // Avoids spamming admins with one row per role when they just
      // bulk-updated the whole card.
      const codes = toInsert.map((i) => i.roleCode).join(', ');
      await notifyAdminPool(tx, {
        actorPersonId: session!.person.id,
        kind: 'rate_card_updated',
        title: `Rate card updated · ${toInsert.length} role${toInsert.length === 1 ? '' : 's'} effective ${effectiveFrom.toISOString().slice(0, 10)}`,
        body: `${codes}. New projects from this date forward will pick up the new rates.`,
        href: '/admin/rate-card',
        entityType: 'rate_card',
        entityId: null,
      });
    });
  } catch (err) {
    console.error('[rate-card.save] failed:', err);
    return { status: 'error', message: 'Save failed — try again.' };
  }

  revalidatePath('/admin/rate-card');
  // Person.rate is also a snapshot the new-person form reads from
  // currentRatesByCode — bust the project surfaces too so anything
  // memoised in /projects rerenders with the new card.
  revalidatePath('/projects');
  return {
    status: 'success',
    changedCount: toInsert.length,
    effectiveFrom: effectiveFrom.toISOString().slice(0, 10),
  };
}
