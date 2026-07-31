'use client';

import { useMemo, useState } from 'react';
import { useFormState, useFormStatus } from 'react-dom';
import type { BaselineProject, ProjectAdjustment } from '@/server/reports/forecast';
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
  selectedScenario,
  baselineContractCents,
}: {
  projects: BaselineProject[];
  initialAdjustments: ProjectAdjustment[];
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

  const scenarioTotal = useMemo(
    () =>
      projects.reduce((sum, p) => {
        const r = rows[p.id];
        return sum + (r && r.included ? r.valueCents : 0);
      }, 0),
    [projects, rows],
  );
  const delta = scenarioTotal - baselineContractCents;

  const adjustmentsJson = JSON.stringify(
    projects.map((p) => ({
      projectId: p.id,
      included: rows[p.id]?.included ?? true,
      contractValueCents: rows[p.id]?.valueCents ?? p.contractValueCents,
    })),
  );

  const [state, action] = useFormState<SaveScenarioState, FormData>(saveScenarioAction, idle);

  return (
    <div className="space-y-4">
      {/* Projection summary */}
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Baseline" value={money(baselineContractCents)} />
        <Stat label="Scenario" value={money(scenarioTotal)} />
        <Stat
          label="Delta"
          value={`${delta >= 0 ? '+' : ''}${money(delta)}`}
          tone={delta === 0 ? 'neutral' : delta > 0 ? 'green' : 'red'}
        />
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

      {/* Save */}
      <form action={action} className="flex flex-wrap items-end gap-3 rounded-lg border border-line bg-card p-3">
        {selectedScenario && <input type="hidden" name="scenarioId" value={selectedScenario.id} />}
        <input type="hidden" name="adjustments" value={adjustmentsJson} />
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

function Stat({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  tone?: 'neutral' | 'green' | 'red';
}) {
  const toneCls =
    tone === 'green' ? 'text-status-green' : tone === 'red' ? 'text-status-red' : 'text-ink';
  return (
    <div className="rounded-lg border border-line bg-card p-4">
      <div className="text-xs text-ink-3">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${toneCls}`}>{value}</div>
    </div>
  );
}
