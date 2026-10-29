'use client';

import { useMemo, useState } from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import type {
  BaselineProject,
  ProjectAdjustment,
  HypotheticalProject,
} from '@/server/reports/forecast';
import { saveScenarioAction, type SaveScenarioState } from './actions';

const idle: SaveScenarioState = { status: 'idle' };

function money(cents: number): string {
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

type RowState = { included: boolean; valueCents: number };

/**
 * Interactive forecast editor (TASK-072a). Toggle projects in/out and
 * override contract values; the projected total + delta recompute live.
 * On save, the full per-project override set is serialised to a hidden
 * field and persisted by the server action.
 */
export function ForecastEditor({
  projects,
  initialAdjustments,
  initialHypotheticals,
  selectedScenario,
  baselineContractCents,
}: {
  projects: BaselineProject[];
  initialAdjustments: ProjectAdjustment[];
  initialHypotheticals: HypotheticalProject[];
  selectedScenario: { id: string; name: string; note: string | null } | null;
  baselineContractCents: number;
}) {
  const adjById = useMemo(
    () => new Map(initialAdjustments.map((a) => [a.projectId, a])),
    [initialAdjustments],
  );

  const [rows, setRows] = useState<Record<string, RowState>>(() => {
    const init: Record<string, RowState> = {};
    for (const p of projects) {
      const a = adjById.get(p.id);
      init[p.id] = {
        included: a ? a.included : true,
        valueCents: a ? a.contractValueCents : p.contractValueCents,
      };
    }
    return init;
  });

  const [hypos, setHypos] = useState<HypotheticalProject[]>(initialHypotheticals);

  // Contract total responds to both include/exclude and value overrides;
  // revenue + margin respond only to include/exclude (a contract-value
  // what-if doesn't move already-booked revenue). Hypothetical projects
  // add to the scenario only: full contract as contract + revenue, and
  // contract × margin% as margin.
  const totals = useMemo(() => {
    let contract = 0;
    let revenue = 0;
    let margin = 0;
    let baseRevenue = 0;
    let baseMargin = 0;
    for (const p of projects) {
      const r = rows[p.id];
      baseRevenue += p.revenueCents;
      baseMargin += p.marginCents;
      if (r?.included) {
        contract += r.valueCents;
        revenue += p.revenueCents;
        margin += p.marginCents;
      }
    }
    for (const h of hypos) {
      contract += h.contractValueCents;
      revenue += h.contractValueCents;
      margin += Math.round((h.contractValueCents * h.marginPct) / 100);
    }
    return { contract, revenue, margin, baseRevenue, baseMargin };
  }, [projects, rows, hypos]);

  const scenarioTotal = totals.contract;

  const adjustmentsJson = JSON.stringify(
    projects.map((p) => ({
      projectId: p.id,
      included: rows[p.id]?.included ?? true,
      contractValueCents: rows[p.id]?.valueCents ?? p.contractValueCents,
    })),
  );
  const hypotheticalsJson = JSON.stringify(hypos);

  function addHypo() {
    setHypos((h) => [
      ...h,
      { id: crypto.randomUUID(), name: '', contractValueCents: 0, marginPct: 30 },
    ]);
  }
  function updateHypo(id: string, patch: Partial<HypotheticalProject>) {
    setHypos((h) => h.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  }
  function removeHypo(id: string) {
    setHypos((h) => h.filter((x) => x.id !== id));
  }

  const [state, action] = useFormState<SaveScenarioState, FormData>(saveScenarioAction, idle);

  return (
    <div className="space-y-4">
      {/* Projection summary — contract / revenue / margin, baseline vs scenario */}
      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="w-full min-w-[520px] text-sm">
          <thead className="bg-surface-subtle text-xs text-ink-3">
            <tr>
              <th className="px-3 py-2 text-left">Metric</th>
              <th className="px-3 py-2 text-right">Baseline</th>
              <th className="px-3 py-2 text-right">Scenario</th>
              <th className="px-3 py-2 text-right">Delta</th>
            </tr>
          </thead>
          <tbody>
            <MetricRow label="Contract value" baseline={baselineContractCents} scenario={scenarioTotal} />
            <MetricRow label="Revenue (booked)" baseline={totals.baseRevenue} scenario={totals.revenue} />
            <MetricRow label="Margin" baseline={totals.baseMargin} scenario={totals.margin} />
          </tbody>
        </table>
      </div>

      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="bg-surface-subtle text-xs text-ink-3">
            <tr>
              <th className="px-3 py-2 text-left">In</th>
              <th className="px-3 py-2 text-left">Project</th>
              <th className="px-3 py-2 text-left">Client</th>
              <th className="px-3 py-2 text-left">Stage</th>
              <th className="px-3 py-2 text-right">Baseline</th>
              <th className="px-3 py-2 text-right">Scenario value</th>
            </tr>
          </thead>
          <tbody>
            {projects.map((p) => {
              const r = rows[p.id]!;
              return (
                <tr key={p.id} className={`border-t border-line ${r.included ? '' : 'opacity-50'}`}>
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={r.included}
                      onChange={(e) =>
                        setRows((s) => ({ ...s, [p.id]: { ...s[p.id]!, included: e.target.checked } }))
                      }
                    />
                  </td>
                  <td className="px-3 py-2">
                    <span className="font-mono text-xs text-ink-3">{p.code}</span>{' '}
                    <span className="text-ink">{p.name}</span>
                  </td>
                  <td className="px-3 py-2 text-ink-2">{p.clientCode}</td>
                  <td className="px-3 py-2 text-ink-2">{p.stage}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-ink-3">
                    {money(p.contractValueCents)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <input
                      type="number"
                      min={0}
                      step={1000}
                      disabled={!r.included}
                      value={Math.round(r.valueCents / 100)}
                      onChange={(e) =>
                        setRows((s) => ({
                          ...s,
                          [p.id]: {
                            ...s[p.id]!,
                            valueCents: Math.max(0, Math.round(Number(e.target.value) || 0)) * 100,
                          },
                        }))
                      }
                      className="w-32 rounded-md border border-line bg-card px-2 py-1 text-right tabular-nums disabled:opacity-50"
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Hypothetical projects — not-yet-real work, scenario-only */}
      <div className="rounded-lg border border-dashed border-line bg-card p-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-medium text-ink">Hypothetical projects</h3>
            <p className="text-xs text-ink-3">
              Model work you might win. Contributes to the scenario only — never
              creates a real project.
            </p>
          </div>
          <button
            type="button"
            onClick={addHypo}
            className="rounded-md border border-line px-3 py-1.5 text-xs text-ink-2 hover:bg-surface-hover hover:text-ink"
          >
            + Add hypothetical
          </button>
        </div>
        {hypos.length > 0 && (
          <table className="mt-3 w-full min-w-[560px] text-sm">
            <thead className="text-xs text-ink-3">
              <tr>
                <th className="px-2 py-1 text-left">Name</th>
                <th className="px-2 py-1 text-right">Contract value</th>
                <th className="px-2 py-1 text-right">Margin %</th>
                <th className="px-2 py-1"></th>
              </tr>
            </thead>
            <tbody>
              {hypos.map((h) => (
                <tr key={h.id} className="border-t border-line">
                  <td className="px-2 py-1">
                    <input
                      type="text"
                      value={h.name}
                      placeholder="e.g. Acme diligence"
                      onChange={(e) => updateHypo(h.id, { name: e.target.value })}
                      className="w-full rounded-md border border-line bg-card px-2 py-1"
                    />
                  </td>
                  <td className="px-2 py-1 text-right">
                    <input
                      type="number"
                      min={0}
                      step={1000}
                      value={Math.round(h.contractValueCents / 100)}
                      onChange={(e) =>
                        updateHypo(h.id, {
                          contractValueCents:
                            Math.max(0, Math.round(Number(e.target.value) || 0)) * 100,
                        })
                      }
                      className="w-32 rounded-md border border-line bg-card px-2 py-1 text-right tabular-nums"
                    />
                  </td>
                  <td className="px-2 py-1 text-right">
                    <input
                      type="number"
                      min={-100}
                      max={100}
                      value={h.marginPct}
                      onChange={(e) =>
                        updateHypo(h.id, {
                          marginPct: Math.max(-100, Math.min(100, Number(e.target.value) || 0)),
                        })
                      }
                      className="w-20 rounded-md border border-line bg-card px-2 py-1 text-right tabular-nums"
                    />
                  </td>
                  <td className="px-2 py-1 text-right">
                    <button
                      type="button"
                      onClick={() => removeHypo(h.id)}
                      className="text-xs text-ink-3 hover:text-status-red"
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Save */}
      <form action={action} className="flex flex-wrap items-end gap-3 rounded-lg border border-line bg-card p-3">
        {selectedScenario && <input type="hidden" name="scenarioId" value={selectedScenario.id} />}
        <input type="hidden" name="adjustments" value={adjustmentsJson} />
        <input type="hidden" name="hypotheticals" value={hypotheticalsJson} />
        <label className="flex flex-col gap-1">
          <span className="text-xs text-ink-3">Scenario name</span>
          <input
            type="text"
            name="name"
            required
            defaultValue={selectedScenario?.name ?? ''}
            placeholder="e.g. Win Galileo + drop internal"
            className="w-64 rounded-md border border-line bg-card px-2 py-1.5 text-sm"
          />
        </label>
        <label className="flex flex-1 flex-col gap-1">
          <span className="text-xs text-ink-3">Note (optional)</span>
          <input
            type="text"
            name="note"
            defaultValue={selectedScenario?.note ?? ''}
            className="w-full rounded-md border border-line bg-card px-2 py-1.5 text-sm"
          />
        </label>
        <SaveButton isUpdate={Boolean(selectedScenario)} />
        {state.status === 'error' && (
          <span className="text-xs text-status-red">{state.message}</span>
        )}
        {state.status === 'success' && (
          <span className="text-xs text-status-green">Saved.</span>
        )}
      </form>
    </div>
  );
}

function SaveButton({ isUpdate }: { isUpdate: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md bg-brand px-3 py-1.5 text-sm text-white hover:bg-brand/90 disabled:opacity-60"
    >
      {pending ? 'Saving…' : isUpdate ? 'Update scenario' : 'Save scenario'}
    </button>
  );
}

function MetricRow({
  label,
  baseline,
  scenario,
}: {
  label: string;
  baseline: number;
  scenario: number;
}) {
  const delta = scenario - baseline;
  const toneCls =
    delta === 0 ? 'text-ink-3' : delta > 0 ? 'text-status-green' : 'text-status-red';
  return (
    <tr className="border-t border-line">
      <td className="px-3 py-2 text-ink-2">{label}</td>
      <td className="px-3 py-2 text-right tabular-nums text-ink-3">{money(baseline)}</td>
      <td className="px-3 py-2 text-right font-medium tabular-nums text-ink">{money(scenario)}</td>
      <td className={`px-3 py-2 text-right tabular-nums ${toneCls}`}>
        {delta >= 0 ? '+' : ''}
        {money(delta)}
      </td>
    </tr>
  );
}
