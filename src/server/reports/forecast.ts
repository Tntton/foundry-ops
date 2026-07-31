import { z } from 'zod';
import { prisma } from '@/server/db';

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

export type BaselineProject = {
  id: string;
  code: string;
  name: string;
  stage: string;
  clientCode: string;
  contractValueCents: number;
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

export type ForecastResult = {
  rows: ForecastProjectRow[];
  baselineContractCents: number;
  scenarioContractCents: number;
  deltaCents: number;
  baselineCount: number;
  scenarioCount: number;
};

/** Pure — apply per-project adjustments over the baseline set. */
export function applyForecast(
  projects: BaselineProject[],
  adjustments: ProjectAdjustment[],
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
  const baselineContractCents = rows.reduce((s, r) => s + r.baselineContractCents, 0);
  const scenarioContractCents = rows.reduce((s, r) => s + r.scenarioContractCents, 0);
  return {
    rows,
    baselineContractCents,
    scenarioContractCents,
    deltaCents: scenarioContractCents - baselineContractCents,
    baselineCount: rows.length,
    scenarioCount: rows.filter((r) => r.included).length,
  };
}

/** Active (non-archived) projects — the sandbox's baseline set. */
export async function loadBaselineProjects(): Promise<BaselineProject[]> {
  const projects = await prisma.project.findMany({
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
  });
  return projects.map((p) => ({
    id: p.id,
    code: p.code,
    name: p.name,
    stage: p.stage,
    clientCode: p.client?.code ?? '',
    contractValueCents: p.contractValue,
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
