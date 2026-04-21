import { computeFirmPnL, type PerProjectPnL } from '@/server/reports/pnl';

export type BudgetWatchRow = PerProjectPnL & {
  costOfContractPct: number | null; // cost / contract × 100; null when contract = 0
  marginPct: number | null; // margin / (rev + wip) × 100; null when rev + wip = 0
  flag: 'over_budget' | 'near_budget' | 'margin_squeeze' | 'healthy';
  flagReason: string;
};

export type BudgetWatch = {
  totalActiveProjects: number;
  flagged: BudgetWatchRow[];
  summary: {
    overBudget: number;
    nearBudget: number;
    marginSqueeze: number;
  };
};

const OVER_BUDGET_PCT = 100;
const NEAR_BUDGET_PCT = 80;
const LOW_MARGIN_PCT = 20; // flag projects where realised margin < 20% of revenue

/**
 * Cross-project health roll-up for active (non-archived) projects.
 *
 *   - over_budget: cost ≥ contract value
 *   - near_budget: cost ≥ 80% of contract but < 100%
 *   - margin_squeeze: invoiced + WIP > 0 AND margin % < 20% (and not already
 *     over/near budget — the categories are mutually exclusive so each row
 *     appears under exactly one flag)
 *   - healthy: everything else — not surfaced on the flagged list
 */
export async function computeBudgetWatch(): Promise<BudgetWatch> {
  const pnl = await computeFirmPnL();
  const active = pnl.projects.filter((p) => p.stage !== 'archived');

  const flagged: BudgetWatchRow[] = [];
  let overBudget = 0;
  let nearBudget = 0;
  let marginSqueeze = 0;

  for (const p of active) {
    const costOfContractPct =
      p.contractValueCents > 0
        ? Math.round((p.costCents / p.contractValueCents) * 1000) / 10
        : null;
    const activeRev = p.revenueCents + p.wipCents;
    const marginPct =
      activeRev > 0 ? Math.round((p.marginCents / activeRev) * 1000) / 10 : null;

    let flag: BudgetWatchRow['flag'] = 'healthy';
    let flagReason = '';
    if (costOfContractPct !== null && costOfContractPct >= OVER_BUDGET_PCT) {
      flag = 'over_budget';
      flagReason = `Cost ${costOfContractPct.toFixed(0)}% of contract`;
      overBudget++;
    } else if (
      costOfContractPct !== null &&
      costOfContractPct >= NEAR_BUDGET_PCT
    ) {
      flag = 'near_budget';
      flagReason = `Cost ${costOfContractPct.toFixed(0)}% of contract`;
      nearBudget++;
    } else if (marginPct !== null && marginPct < LOW_MARGIN_PCT) {
      flag = 'margin_squeeze';
      flagReason = `${marginPct.toFixed(0)}% margin on $${(activeRev / 100).toFixed(0)} active rev`;
      marginSqueeze++;
    }

    if (flag !== 'healthy') {
      flagged.push({
        ...p,
        costOfContractPct,
        marginPct,
        flag,
        flagReason,
      });
    }
  }

  // Sort: over-budget first, then near-budget, then margin-squeeze. Within
  // each, worst (highest cost/contract %) first.
  const FLAG_ORDER: Record<BudgetWatchRow['flag'], number> = {
    over_budget: 0,
    near_budget: 1,
    margin_squeeze: 2,
    healthy: 9,
  };
  flagged.sort((a, b) => {
    const fa = FLAG_ORDER[a.flag];
    const fb = FLAG_ORDER[b.flag];
    if (fa !== fb) return fa - fb;
    return (b.costOfContractPct ?? 0) - (a.costOfContractPct ?? 0);
  });

  return {
    totalActiveProjects: active.length,
    flagged,
    summary: { overBudget, nearBudget, marginSqueeze },
  };
}
