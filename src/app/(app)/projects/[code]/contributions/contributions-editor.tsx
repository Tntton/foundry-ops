'use client';

import { useState, useTransition } from 'react';
import {
  saveProjectPartnerContributions,
  type ContributionsSaveState,
} from './actions';
import { PersonAvatar } from '@/components/person-avatar';
import { Button } from '@/components/ui/button';

type Role =
  | 'bd_won'
  | 'led'
  | 'directly_supported'
  | 'partially_supported';

const ROLE_LABEL: Record<Role, string> = {
  bd_won: 'BD won',
  led: 'Led',
  directly_supported: 'Directly supported',
  partially_supported: 'Partially supported',
};

const ROLE_HINT: Record<Role, string> = {
  bd_won: 'Sourced / closed the deal',
  led: 'Project lead / owning partner',
  directly_supported: 'Active delivery role',
  partially_supported: 'Advisory / occasional input',
};

export type PartnerOption = {
  id: string;
  initials: string;
  firstName: string;
  lastName: string;
  isFullPartner: boolean;
  headshotUrl: string | null;
};

export type ContributionInput = {
  personId: string;
  role: Role;
  contributionPct: number;
  notes: string | null;
};

/**
 * Per-project contribution editor — surfaces on the project page so
 * partners / managers can hard-code who gets credit for each
 * contribution role and at what %. Defaults to one row for the project's
 * primary partner at 100% Led when the project has no contributions yet
 * (driven by parent component pre-population).
 *
 * Replace-by-(personId, role): saving deletes any (personId, role) pair
 * that disappears from the list and upserts the rest.
 */
export function ProjectContributionsEditor({
  projectId,
  partners,
  initial,
  canEdit,
}: {
  projectId: string;
  /** Eligible people to credit — anyone with role=partner (full or AP). */
  partners: PartnerOption[];
  initial: ContributionInput[];
  canEdit: boolean;
}) {
  const [rows, setRows] = useState(initial);
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<ContributionsSaveState>({ status: 'idle' });

  const partnersById = new Map(partners.map((p) => [p.id, p]));

  function addRow() {
    // Pick the first partner not yet on a (personId, role) row, default
    // role led.
    const next = partners.find(
      (p) => !rows.some((r) => r.personId === p.id && r.role === 'led'),
    );
    if (!next) return;
    setRows((prev) => [
      ...prev,
      { personId: next.id, role: 'led', contributionPct: 100, notes: null },
    ]);
  }

  function removeRow(idx: number) {
    setRows((prev) => prev.filter((_, i) => i !== idx));
  }

  function updateRow(idx: number, patch: Partial<ContributionInput>) {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }

  function save() {
    setState({ status: 'idle' });
    const fd = new FormData();
    for (const r of rows) {
      fd.append('personId', r.personId);
      fd.append('role', r.role);
      fd.append('contributionPct', String(r.contributionPct));
      fd.append('notes', r.notes ?? '');
    }
    startTransition(async () => {
      const result = await saveProjectPartnerContributions(
        projectId,
        state,
        fd,
      );
      setState(result);
    });
  }

  // ── Subtotals per role so partners can see at a glance whether
  // they've allocated more than 100% to any single role ──
  const roleTotals: Record<Role, number> = {
    bd_won: 0,
    led: 0,
    directly_supported: 0,
    partially_supported: 0,
  };
  for (const r of rows) roleTotals[r.role] += r.contributionPct;

  return (
    <div className="space-y-3 rounded-lg border border-line bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-ink">
            Partner contributions
          </h3>
          <p className="text-[11px] text-ink-3">
            Hard-code the credit split for each role on this project.
            Partner scorecard sums project contract value × contribution %
            across the four roles. A given person can hold multiple roles
            (e.g. BD + Led).
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-[10px] text-ink-3">
          {(Object.keys(ROLE_LABEL) as Role[]).map((r) => {
            const t = roleTotals[r];
            return (
              <span
                key={r}
                className={`inline-flex items-center gap-1 rounded-full border bg-card px-2 py-0.5 ${
                  t > 100
                    ? 'border-status-amber text-status-amber'
                    : 'border-line'
                }`}
                title={ROLE_HINT[r]}
              >
                <span className="font-semibold tabular-nums">{t}%</span>
                <span>{ROLE_LABEL[r]}</span>
              </span>
            );
          })}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b border-line bg-surface-subtle text-[10px] uppercase tracking-wide text-ink-3">
              <th className="px-3 py-2 text-left">Partner</th>
              <th className="px-3 py-2 text-left">Role</th>
              <th className="px-3 py-2 text-right">Contribution %</th>
              <th className="px-3 py-2 text-left">Notes</th>
              {canEdit && <th className="px-3 py-2" />}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={canEdit ? 5 : 4}
                  className="px-3 py-6 text-center text-xs text-ink-3"
                >
                  No partner contributions logged for this project yet.
                  {canEdit ? ' Add one to start crediting.' : ''}
                </td>
              </tr>
            ) : (
              rows.map((r, idx) => {
                const person = partnersById.get(r.personId);
                return (
                  <tr key={`${r.personId}:${r.role}:${idx}`} className="border-b border-line">
                    <td className="px-3 py-1.5">
                      {canEdit ? (
                        <select
                          value={r.personId}
                          onChange={(e) =>
                            updateRow(idx, { personId: e.target.value })
                          }
                          className="h-7 w-full rounded border border-line bg-surface-elev px-1 text-xs text-ink focus:border-brand"
                        >
                          {partners.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.firstName} {p.lastName}
                              {p.isFullPartner ? ' · Full' : ' · AP'}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <div className="flex items-center gap-2">
                          {person && (
                            <PersonAvatar
                              className="h-5 w-5"
                              fallbackClassName="text-[9px]"
                              initials={person.initials}
                              headshotUrl={person.headshotUrl}
                            />
                          )}
                          <span className="text-ink">
                            {person
                              ? `${person.firstName} ${person.lastName}`
                              : 'Unknown'}
                          </span>
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-1.5">
                      {canEdit ? (
                        <select
                          value={r.role}
                          onChange={(e) =>
                            updateRow(idx, { role: e.target.value as Role })
                          }
                          className="h-7 w-full rounded border border-line bg-surface-elev px-1 text-xs text-ink focus:border-brand"
                        >
                          {(Object.keys(ROLE_LABEL) as Role[]).map((k) => (
                            <option key={k} value={k}>
                              {ROLE_LABEL[k]}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className="text-xs text-ink-2">
                          {ROLE_LABEL[r.role]}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-1.5">
                      {canEdit ? (
                        <input
                          type="number"
                          min={0}
                          max={100}
                          step={5}
                          value={r.contributionPct}
                          onChange={(e) =>
                            updateRow(idx, {
                              contributionPct: Math.max(
                                0,
                                Math.min(100, Number(e.target.value || 0)),
                              ),
                            })
                          }
                          className="h-7 w-24 rounded border border-line bg-surface-elev px-1 text-right text-xs tabular-nums text-ink focus:border-brand"
                        />
                      ) : (
                        <span className="text-xs tabular-nums text-ink-2">
                          {r.contributionPct}%
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-1.5">
                      {canEdit ? (
                        <input
                          type="text"
                          maxLength={200}
                          value={r.notes ?? ''}
                          onChange={(e) =>
                            updateRow(idx, { notes: e.target.value })
                          }
                          placeholder="—"
                          className="h-7 w-full rounded border border-line bg-surface-elev px-1.5 text-[11px] text-ink-2 focus:border-brand"
                        />
                      ) : (
                        <span className="text-[11px] text-ink-3">
                          {r.notes || '—'}
                        </span>
                      )}
                    </td>
                    {canEdit && (
                      <td className="px-3 py-1.5 text-right">
                        <button
                          type="button"
                          onClick={() => removeRow(idx)}
                          className="text-[10px] text-ink-3 hover:text-status-red"
                        >
                          Remove
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {canEdit && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button type="button" size="sm" variant="ghost" onClick={addRow}>
            + Add contribution
          </Button>
          <div className="flex items-center gap-2">
            {state.status === 'error' && (
              <span className="text-xs text-status-red">{state.message}</span>
            )}
            {state.status === 'success' && (
              <span className="text-xs text-status-green">
                Saved · scorecard refreshed.
              </span>
            )}
            <Button type="button" size="sm" onClick={save} disabled={pending}>
              {pending ? 'Saving…' : 'Save contributions'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
