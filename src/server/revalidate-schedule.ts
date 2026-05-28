import { revalidatePath } from 'next/cache';

/**
 * Centralised revalidation for the three "schedule" surfaces that have
 * to stay in lock-step:
 *
 *   1. **Individual** — `/availability` (per-person forecast),
 *      `/timesheet` (per-person actuals), and the person profile.
 *   2. **Project** — `/projects/[code]` (Team tab utilisation,
 *      Hours tab, Budget tab actuals reconciliation).
 *   3. **Firm** — `/resource-planning` (bandwidth heatmap + pool),
 *      `/utilisation` (firm-wide rollup), and the dashboard
 *      ("Team across my projects · this week" + KPI strip).
 *
 * Any mutation that changes someone's availability, a timesheet entry,
 * or a project team membership should call this so every dependent
 * surface re-renders without a hard reload. Server components are
 * dynamic so they recompute from live DB on the next request — this
 * call is what flips the router cache for surfaces the user already
 * has rendered.
 */

export type ScheduleScope = {
  /** Person whose schedule changed. Optional only because some entry
   *  points (e.g. firm-wide bulk imports) don't have a single subject. */
  personId?: string | null;
  /** Project code for /projects/[code] revalidation. Pass the project
   *  code, not the cuid — the route segment is the code. */
  projectCode?: string | null;
};

const ALWAYS_REVALIDATE = [
  '/', // dashboard "Team across my projects · this week"
  '/resource-planning', // bandwidth heatmap + pool
  '/utilisation', // firm utilisation roll-up
  '/availability', // viewer's own forecast (and admin on-behalf views)
  '/timesheet', // viewer's own timesheet
];

export function revalidateScheduleSurfaces(scope: ScheduleScope = {}): void {
  for (const p of ALWAYS_REVALIDATE) revalidatePath(p);
  if (scope.personId) {
    revalidatePath(`/directory/people/${scope.personId}`);
  }
  if (scope.projectCode) {
    revalidatePath(`/projects/${scope.projectCode}`);
  }
}
