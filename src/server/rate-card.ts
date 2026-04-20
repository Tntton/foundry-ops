import { prisma } from '@/server/db';

export type RateCardRow = {
  id: string;
  roleCode: string;
  effectiveFrom: Date;
  costRate: number; // cents / hour
  billRateLow: number;
  billRateHigh: number;
};

/**
 * List rate card rows active as-of a given date — one row per role code
 * (the most recent effectiveFrom ≤ asOf). If no asOf supplied, defaults to
 * "now".
 */
export async function listRateCardAsOf(asOf: Date = new Date()): Promise<RateCardRow[]> {
  const all = await prisma.rateCard.findMany({
    where: { effectiveFrom: { lte: asOf } },
    orderBy: [{ roleCode: 'asc' }, { effectiveFrom: 'desc' }],
  });

  const seen = new Set<string>();
  const latest: RateCardRow[] = [];
  for (const row of all) {
    if (seen.has(row.roleCode)) continue;
    seen.add(row.roleCode);
    latest.push({
      id: row.id,
      roleCode: row.roleCode,
      effectiveFrom: row.effectiveFrom,
      costRate: row.costRate,
      billRateLow: row.billRateLow,
      billRateHigh: row.billRateHigh,
    });
  }

  // Present in a business-sensible order: Leadership → Expert → Fellow → Consultant → Analyst → Intern
  const ORDER = ['L2', 'L1', 'E2', 'E1', 'F2', 'F1', 'T3', 'T2', 'T1', 'A3', 'A2', 'A1', 'IO'];
  return latest.sort((a, b) => {
    const ai = ORDER.indexOf(a.roleCode);
    const bi = ORDER.indexOf(b.roleCode);
    if (ai === -1 && bi === -1) return a.roleCode.localeCompare(b.roleCode);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });
}

/**
 * Returns the current cost rate (in cents per hour) for each role code that
 * has an active rate card row as of `asOf`. Used by the New Person / Edit
 * forms to auto-fill the Rate field when a level is picked.
 */
export async function currentRatesByCode(
  asOf: Date = new Date(),
): Promise<Record<string, number>> {
  const rows = await listRateCardAsOf(asOf);
  const out: Record<string, number> = {};
  for (const r of rows) out[r.roleCode] = r.costRate;
  return out;
}

/**
 * List all historical rows for a given role code (newest first).
 */
export async function listRateCardHistory(roleCode: string): Promise<RateCardRow[]> {
  const rows = await prisma.rateCard.findMany({
    where: { roleCode },
    orderBy: { effectiveFrom: 'desc' },
  });
  return rows.map((r) => ({
    id: r.id,
    roleCode: r.roleCode,
    effectiveFrom: r.effectiveFrom,
    costRate: r.costRate,
    billRateLow: r.billRateLow,
    billRateHigh: r.billRateHigh,
  }));
}
