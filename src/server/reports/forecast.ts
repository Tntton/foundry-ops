import { z } from 'zod';
import { prisma } from '@/server/db';
import { computeFirmPnL } from '@/server/reports/pnl';

/**
 * Forecast sandbox projection (TASK-072a). A "scenario" is a set of
 * per-project what-if overrides applied over the firm's live book of
 * business — toggle a project in/out and/or override its contract value.
 * The projection is pure (`applyForecast`) so it's identical on the
 * server (initial render + save) and cheaply re-derivable; it never
 * mutates real project data.
 *
 * This foundation covers include/exclude + contract-value overrides.
 * Richer what-ifs (shift start dates → monthly re-phasing, change rates
 * → revenue projection, add hypothetical projects) are TASK-072b.
 */

export const ProjectAdjustmentSchema = z.object({
  projectId: z.string().min(1),
  included: z.boolean(),
  contractValueCents: z.number().int().min(0),
});
export type ProjectAdjustment = z.infer<typeof ProjectAdjustmentSchema>;

export const AdjustmentsSchema = z.array(ProjectAdjustmentSchema);

// A hypothetical (not-yet-real) project added to a scenario (TASK-072b).
// Modelled in the projection but never written as a real Project.
export const HypotheticalProjectSchema = z.object({
  id: z.string().min(1), // client-generated
  name: z.string().trim().min(1).max(120),
  contractValueCents: z.number().int().min(0),
  marginPct: z.number().min(-100).max(100),
});
export type HypotheticalProject = z.infer<typeof HypotheticalProjectSchema>;
export const HypotheticalsSchema = z.array(HypotheticalProjectSchema);

export type BaselineProject = {
  id: string;
  code: string;
  name: string;
  stage: string;
  clientCode: string;
  contractValueCents: number;
  // Current actuals from the firm P&L, folded in so the sandbox can
  // project revenue + margin impact (TASK-072b), not just the book of
  // contract value. Default 0 for a project the P&L hasn't costed yet.
  revenueCents: number;
  marginCents: number;
};

export type ForecastProjectRow = {
  projectId: string;
  code: string;
  name: string;
  stage: string;
  clientCode: string;
  baselineContractCents: number;
  scenarioContractCents: number; // 0 when excluded
  included: boolean;
  overridden: boolean; // scenario value differs from baseline (excl. exclusion)
};

export type ForecastMetric = {
  baselineCents: number;
  scenarioCents: number;
  deltaCents: number;
};

export type ForecastResult = {
  rows: ForecastProjectRow[];
  baselineContractCents: number;
  scenarioContractCents: number;
  deltaCents: number;
  baselineCount: number;
  scenarioCount: number;
  // Revenue + margin projections (TASK-072b). Include/exclude drives
  // these; a contract-value override only moves the contract metric
  // (it doesn't retroactively change already-booked revenue/margin).
  revenue: ForecastMetric;
  margin: ForecastMetric;
  hypotheticalCount: number;
};

/**
 * A hypothetical project contributes to the scenario only: its full
 * contract value counts as projected contract + revenue, and its margin
 * is `contractValue × marginPct`.
 */
export function hypotheticalContribution(h: HypotheticalProject): {
  contractCents: number;
  revenueCents: number;
  marginCents: number;
} {
  return {
    contractCents: h.contractValueCents,
    revenueCents: h.contractValueCents,
    marginCents: Math.round((h.contractValueCents * h.marginPct) / 100),
  };
}

/** Pure — apply per-project adjustments + hypotheticals over the baseline set. */
export function applyForecast(
  projects: BaselineProject[],
  adjustments: ProjectAdjustment[],
  hypotheticals: HypotheticalProject[] = [],
): ForecastResult {
  const adjById = new Map(adjustments.map((a) => [a.projectId, a]));
  const rows: ForecastProjectRow[] = projects.map((p) => {
    const adj = adjById.get(p.id);
    const included = adj ? adj.included : true;
    const overrideValue = adj?.contractValueCents ?? p.contractValueCents;
    return {
      projectId: p.id,
      code: p.code,
      name: p.name,
      stage: p.stage,
      clientCode: p.clientCode,
      baselineContractCents: p.contractValueCents,
      scenarioContractCents: included ? overrideValue : 0,
      included,
      overridden: overrideValue !== p.contractValueCents,
    };
  });

  // Hypothetical contributions (scenario-only).
  const hypo = hypotheticals.reduce(
    (acc, h) => {
      const c = hypotheticalContribution(h);
      acc.contract += c.contractCents;
      acc.revenue += c.revenueCents;
      acc.margin += c.marginCents;
      return acc;
    },
    { contract: 0, revenue: 0, margin: 0 },
  );

  const baselineContractCents = rows.reduce((s, r) => s + r.baselineContractCents, 0);
  const scenarioContractCents =
    rows.reduce((s, r) => s + r.scenarioContractCents, 0) + hypo.contract;

  const included = new Set(rows.filter((r) => r.included).map((r) => r.projectId));
  const metric = (
    pick: (p: BaselineProject) => number,
    hypoAdd: number,
  ): ForecastMetric => {
    const baselineCents = projects.reduce((s, p) => s + pick(p), 0);
    const scenarioCents =
      projects.reduce((s, p) => s + (included.has(p.id) ? pick(p) : 0), 0) + hypoAdd;
    return { baselineCents, scenarioCents, deltaCents: scenarioCents - baselineCents };
  };

  return {
    rows,
    baselineContractCents,
    scenarioContractCents,
    deltaCents: scenarioContractCents - baselineContractCents,
    baselineCount: rows.length,
    scenarioCount: rows.filter((r) => r.included).length + hypotheticals.length,
    revenue: metric((p) => p.revenueCents, hypo.revenue),
    margin: metric((p) => p.marginCents, hypo.margin),
    hypotheticalCount: hypotheticals.length,
  };
}

/** Active (non-archived) projects — the sandbox's baseline set, with
 *  current revenue + margin folded in from the firm P&L. */
export async function loadBaselineProjects(): Promise<BaselineProject[]> {
  const [projects, pnl] = await Promise.all([
    prisma.project.findMany({
      where: { stage: { not: 'archived' } },
      orderBy: { code: 'asc' },
      select: {
        id: true,
        code: true,
        name: true,
        stage: true,
        contractValue: true,
        client: { select: { code: true } },
      },
    }),
    computeFirmPnL(),
  ]);

  const pnlById = new Map(
    pnl.projects.map((p) => [
      p.projectId,
      { revenueCents: p.revenueCents, marginCents: p.marginCents },
    ]),
  );

  return projects.map((p) => ({
    id: p.id,
    code: p.code,
    name: p.name,
    stage: p.stage,
    clientCode: p.client?.code ?? '',
    contractValueCents: p.contractValue,
    revenueCents: pnlById.get(p.id)?.revenueCents ?? 0,
    marginCents: pnlById.get(p.id)?.marginCents ?? 0,
  }));
}

export async function computeForecast(
  adjustments: ProjectAdjustment[],
): Promise<ForecastResult> {
  return applyForecast(await loadBaselineProjects(), adjustments);
}

/** Coerce a persisted `Scenario.adjustments` JSON blob into typed
 *  adjustments, dropping anything malformed (defensive on read). */
export function parseAdjustments(raw: unknown): ProjectAdjustment[] {
  const parsed = AdjustmentsSchema.safeParse(raw);
  return parsed.success ? parsed.data : [];
}

/** Coerce a persisted `Scenario.hypotheticals` blob into typed rows. */
export function parseHypotheticals(raw: unknown): HypotheticalProject[] {
  const parsed = HypotheticalsSchema.safeParse(raw);
  return parsed.success ? parsed.data : [];
}
