import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSession } from '@/server/session';
import { hasAnyRole } from '@/server/roles';
import { prisma } from '@/server/db';
import {
  loadBaselineProjects,
  applyForecast,
  parseAdjustments,
} from '@/server/reports/forecast';
import { ForecastEditor } from './editor';
import { deleteScenarioAction } from './actions';

export const dynamic = 'force-dynamic';

function money(cents: number): string {
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

export default async function ForecastPage({
  searchParams,
}: {
  searchParams: { scenario?: string };
}) {
  const session = await getSession();
  if (!hasAnyRole(session, ['super_admin', 'admin', 'partner'])) notFound();

  const [projects, scenarios] = await Promise.all([
    loadBaselineProjects(),
    prisma.scenario.findMany({
      where: { ownerId: session!.person.id },
      orderBy: { updatedAt: 'desc' },
      select: { id: true, name: true, note: true, adjustments: true, updatedAt: true },
    }),
  ]);

  const selected = searchParams.scenario
    ? scenarios.find((s) => s.id === searchParams.scenario)
    : undefined;
  const initialAdjustments = selected ? parseAdjustments(selected.adjustments) : [];
  const baseline = applyForecast(projects, []);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-ink">Forecast sandbox</h1>
        <p className="max-w-2xl text-sm text-ink-3">
          A what-if over the firm&apos;s book of business. Toggle projects in or
          out and adjust contract values to see the projected total move. This
          never changes real project data — save it as a scenario to revisit.
        </p>
      </header>

      {projects.length === 0 ? (
        <div className="rounded-lg border border-dashed border-line bg-card px-6 py-16 text-center">
          <p className="text-sm font-medium text-ink-2">No active projects to model</p>
          <p className="mt-1 text-sm text-ink-3">
            Once there are non-archived projects they appear here to forecast against.
          </p>
        </div>
      ) : (
        <ForecastEditor
          projects={projects}
          initialAdjustments={initialAdjustments}
          selectedScenario={
            selected ? { id: selected.id, name: selected.name, note: selected.note } : null
          }
          baselineContractCents={baseline.baselineContractCents}
        />
      )}

      {/* Saved scenarios */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-ink-2">Saved scenarios</h2>
        {scenarios.length === 0 ? (
          <p className="text-sm text-ink-3">None yet — build one above and save it.</p>
        ) : (
          <ul className="divide-y divide-line rounded-lg border border-line">
            {scenarios.map((s) => {
              const res = applyForecast(projects, parseAdjustments(s.adjustments));
              return (
                <li key={s.id} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
                  <div className="min-w-0">
                    <Link
                      href={`/forecast?scenario=${s.id}`}
                      className="font-medium text-ink hover:underline"
                    >
                      {s.name}
                    </Link>
                    {s.note && <span className="ml-2 text-ink-3">— {s.note}</span>}
                  </div>
                  <div className="flex items-center gap-4 whitespace-nowrap">
                    <span className="tabular-nums text-ink-2">
                      {money(res.scenarioContractCents)}
                    </span>
                    <span
                      className={`tabular-nums ${
                        res.deltaCents >= 0 ? 'text-status-green' : 'text-status-red'
                      }`}
                    >
                      {res.deltaCents >= 0 ? '+' : ''}
                      {money(res.deltaCents)}
                    </span>
                    <form action={deleteScenarioAction}>
                      <input type="hidden" name="scenarioId" value={s.id} />
                      <button type="submit" className="text-xs text-ink-3 hover:text-status-red">
                        Delete
                      </button>
                    </form>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
