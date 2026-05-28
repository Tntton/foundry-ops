import { prisma } from '@/server/db';

/**
 * Admin-only BD pipeline summary for the dashboard.
 *
 * Mirrors the firm-overhead expense report pattern: a small panel that
 * gives admins a one-glance read on the pipeline without leaving the
 * dashboard. Per-stage tiles + a top-N list of in-flight deals (sorted
 * by weighted value = expectedValue × probability%) so the biggest
 * mid-pipeline deals don't get lost.
 *
 * Closed lanes (won / lost / archived) are excluded from the in-flight
 * list — the won deals already became projects (rendered on the
 * Projects board) and lost deals are noise here.
 */
export type AdminBdPipelineRow = {
  id: string;
  code: string;
  name: string;
  stage: 'lead' | 'qualifying' | 'proposal' | 'negotiation';
  sector: string | null;
  clientLabel: string;
  expectedValueCents: number;
  probability: number; // 0-100
  weightedCents: number;
  ownerInitials: string;
  ownerName: string;
  targetCloseIso: string | null;
  ageDays: number;
};

export type AdminBdPipeline = {
  rows: AdminBdPipelineRow[];
  totals: {
    /** Per-stage counts + raw expected value, in-flight only. */
    perStage: Record<
      'lead' | 'qualifying' | 'proposal' | 'negotiation',
      { count: number; expectedCents: number; weightedCents: number }
    >;
    inFlightCount: number;
    inFlightExpectedCents: number;
    inFlightWeightedCents: number;
    /** Won + lost rolling 90-day signal so admin can spot win-rate
     *  trends at a glance without opening the BD board. */
    won90d: number;
    lost90d: number;
  };
};

const IN_FLIGHT: AdminBdPipelineRow['stage'][] = [
  'lead',
  'qualifying',
  'proposal',
  'negotiation',
];

export async function computeAdminBdPipeline(): Promise<AdminBdPipeline> {
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const [inFlightDeals, recentClosed] = await Promise.all([
    prisma.deal.findMany({
      where: { archivedAt: null, stage: { in: IN_FLIGHT } },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        code: true,
        name: true,
        stage: true,
        sector: true,
        prospectiveName: true,
        expectedValue: true,
        probability: true,
        targetCloseDate: true,
        createdAt: true,
        client: { select: { code: true, legalName: true, tradingName: true } },
        owner: { select: { initials: true, firstName: true, lastName: true } },
      },
    }),
    prisma.deal.findMany({
      where: {
        archivedAt: null,
        stage: { in: ['won', 'lost'] },
        updatedAt: { gte: ninetyDaysAgo },
      },
      select: { stage: true },
    }),
  ]);

  const perStage: AdminBdPipeline['totals']['perStage'] = {
    lead: { count: 0, expectedCents: 0, weightedCents: 0 },
    qualifying: { count: 0, expectedCents: 0, weightedCents: 0 },
    proposal: { count: 0, expectedCents: 0, weightedCents: 0 },
    negotiation: { count: 0, expectedCents: 0, weightedCents: 0 },
  };
  const rows: AdminBdPipelineRow[] = inFlightDeals.map((d) => {
    const weighted = Math.round((d.expectedValue * d.probability) / 100);
    const stage = d.stage as AdminBdPipelineRow['stage'];
    perStage[stage].count += 1;
    perStage[stage].expectedCents += d.expectedValue;
    perStage[stage].weightedCents += weighted;
    const clientLabel =
      d.client?.tradingName ??
      d.client?.legalName ??
      d.prospectiveName ??
      '(unspecified)';
    return {
      id: d.id,
      code: d.code,
      name: d.name ?? '(unnamed)',
      stage,
      sector: d.sector,
      clientLabel,
      expectedValueCents: d.expectedValue,
      probability: d.probability,
      weightedCents: weighted,
      ownerInitials: d.owner.initials,
      ownerName: `${d.owner.firstName} ${d.owner.lastName}`,
      targetCloseIso: d.targetCloseDate
        ? d.targetCloseDate.toISOString()
        : null,
      ageDays: Math.max(
        0,
        Math.floor((Date.now() - d.createdAt.getTime()) / 86_400_000),
      ),
    };
  });
  // Sort by weighted value desc — biggest mid-pipeline deals first.
  rows.sort((a, b) => b.weightedCents - a.weightedCents);

  const inFlightExpectedCents = rows.reduce(
    (s, r) => s + r.expectedValueCents,
    0,
  );
  const inFlightWeightedCents = rows.reduce(
    (s, r) => s + r.weightedCents,
    0,
  );
  const won90d = recentClosed.filter((c) => c.stage === 'won').length;
  const lost90d = recentClosed.filter((c) => c.stage === 'lost').length;

  return {
    rows,
    totals: {
      perStage,
      inFlightCount: rows.length,
      inFlightExpectedCents,
      inFlightWeightedCents,
      won90d,
      lost90d,
    },
  };
}
