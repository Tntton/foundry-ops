import type { DealStage } from '@prisma/client';
import { prisma } from '@/server/db';

export type DealListRow = {
  id: string;
  code: string;
  name: string;
  stage: DealStage;
  expectedValueCents: number;
  probabilityPct: number;
  weightedValueCents: number; // expected × probability
  targetCloseDate: Date | null;
  owner: { id: string; initials: string; firstName: string; lastName: string };
  client: { id: string; code: string; legalName: string } | null;
  prospectiveName: string | null;
  convertedProjectId: string | null;
  convertedProject: { code: string; name: string } | null;
  createdAt: Date;
};

export type DealFilter = {
  stage?: DealStage;
  ownerId?: string;
  search?: string;
};

export async function listDeals(filter: DealFilter = {}): Promise<DealListRow[]> {
  const q = filter.search?.trim();
  const searchFilter = q
    ? {
        OR: [
          { code: { contains: q, mode: 'insensitive' as const } },
          { name: { contains: q, mode: 'insensitive' as const } },
          { prospectiveName: { contains: q, mode: 'insensitive' as const } },
          { client: { is: { code: { contains: q, mode: 'insensitive' as const } } } },
          { client: { is: { legalName: { contains: q, mode: 'insensitive' as const } } } },
        ],
      }
    : null;

  const deals = await prisma.deal.findMany({
    where: {
      ...(filter.stage ? { stage: filter.stage } : {}),
      ...(filter.ownerId ? { ownerId: filter.ownerId } : {}),
      ...(searchFilter ?? {}),
    },
    orderBy: [{ stage: 'asc' }, { expectedValue: 'desc' }],
    include: {
      owner: { select: { id: true, initials: true, firstName: true, lastName: true } },
      client: { select: { id: true, code: true, legalName: true } },
    },
  });

  const convertedIds = deals
    .map((d) => d.convertedProjectId)
    .filter((id): id is string => id !== null);
  const convertedProjects =
    convertedIds.length > 0
      ? await prisma.project.findMany({
          where: { id: { in: convertedIds } },
          select: { id: true, code: true, name: true },
        })
      : [];
  const projectById = new Map(convertedProjects.map((p) => [p.id, p]));

  return deals.map<DealListRow>((d) => ({
    id: d.id,
    code: d.code,
    name: d.name,
    stage: d.stage,
    expectedValueCents: d.expectedValue,
    probabilityPct: d.probability,
    weightedValueCents: Math.round(d.expectedValue * (d.probability / 100)),
    targetCloseDate: d.targetCloseDate,
    owner: d.owner,
    client: d.client,
    prospectiveName: d.prospectiveName,
    convertedProjectId: d.convertedProjectId,
    convertedProject: d.convertedProjectId
      ? projectById.get(d.convertedProjectId) ?? null
      : null,
    createdAt: d.createdAt,
  }));
}

export type PipelineSummary = {
  totalCount: number;
  openCount: number;
  weightedValueCents: number;
  expectedValueCents: number;
  wonCountYtd: number;
  wonValueYtdCents: number;
  lostCountYtd: number;
  byStage: Array<{
    stage: DealStage;
    count: number;
    expectedCents: number;
    weightedCents: number;
  }>;
};

export async function pipelineSummary(): Promise<PipelineSummary> {
  const allDeals = await prisma.deal.findMany({
    select: {
      stage: true,
      expectedValue: true,
      probability: true,
      createdAt: true,
    },
  });

  const yearStart = new Date(new Date().getUTCFullYear(), 0, 1);

  const byStageMap = new Map<
    DealStage,
    { count: number; expectedCents: number; weightedCents: number }
  >();
  const openStages: DealStage[] = ['lead', 'qualifying', 'proposal', 'negotiation'];
  let openCount = 0;
  let weightedOpen = 0;
  let expectedOpen = 0;
  let wonCount = 0;
  let wonValue = 0;
  let lostCount = 0;

  for (const d of allDeals) {
    const entry =
      byStageMap.get(d.stage) ??
      { count: 0, expectedCents: 0, weightedCents: 0 };
    entry.count += 1;
    entry.expectedCents += d.expectedValue;
    entry.weightedCents += Math.round(d.expectedValue * (d.probability / 100));
    byStageMap.set(d.stage, entry);

    if (openStages.includes(d.stage)) {
      openCount += 1;
      weightedOpen += Math.round(d.expectedValue * (d.probability / 100));
      expectedOpen += d.expectedValue;
    }

    if (d.createdAt >= yearStart) {
      if (d.stage === 'won') {
        wonCount += 1;
        wonValue += d.expectedValue;
      } else if (d.stage === 'lost') {
        lostCount += 1;
      }
    }
  }

  const stageOrder: DealStage[] = [
    'lead',
    'qualifying',
    'proposal',
    'negotiation',
    'won',
    'lost',
  ];
  const byStage = stageOrder.map((stage) => ({
    stage,
    ...(byStageMap.get(stage) ?? { count: 0, expectedCents: 0, weightedCents: 0 }),
  }));

  return {
    totalCount: allDeals.length,
    openCount,
    weightedValueCents: weightedOpen,
    expectedValueCents: expectedOpen,
    wonCountYtd: wonCount,
    wonValueYtdCents: wonValue,
    lostCountYtd: lostCount,
    byStage,
  };
}
