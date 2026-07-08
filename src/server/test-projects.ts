import { prisma } from '@/server/db';

/**
 * Test-project convention: any Project whose code starts with `TST`
 * (TST001 etc.) is a sandbox for functionality testing. It behaves
 * like a normal project on every input surface (timesheet, expenses,
 * availability, invoices) so the full workflow can be exercised — but
 * financial + utilisation REPORTS exclude it so test data never
 * pollutes the numbers partners read.
 *
 * Excluded surfaces: firm P&L (all tiles, waterfall, per-project
 * table, cumulative earnings), revenue-by-FY, utilisation roll-up.
 *
 * NOT excluded (by design): project list, per-project tracker,
 * approvals queue, bandwidth heatmap (availability is per-person
 * capacity, not financials). Test expenses tagged OPEX (no project)
 * can't be distinguished from real ones — always tag test expenses
 * to TST001.
 */
export const TEST_PROJECT_PREFIX = 'TST';

export async function listTestProjectIds(): Promise<string[]> {
  const rows = await prisma.project.findMany({
    where: { code: { startsWith: TEST_PROJECT_PREFIX } },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}
