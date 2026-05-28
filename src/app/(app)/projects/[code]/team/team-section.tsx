'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useFormState, useFormStatus } from 'react-dom';
import { saveProjectTeam, type TeamEditState } from './edit/actions';
import { PersonAvatar } from '@/components/person-avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

type PersonOption = {
  id: string;
  initials: string;
  firstName: string;
  lastName: string;
  band: string;
  headshotUrl: string | null;
};

export type TeamUtilRow = {
  personId: string;
  initials: string;
  firstName: string;
  lastName: string;
  roleOnProject: string | null;
  allocationPct: number | null;
  onTeam: boolean;
  billableRateCents: number | null;
  costRateCents: number;
  /** Per-project pay-rate override mirrored from
   *  ProjectTeam.customRateCents. Null when no override is set. */
  customRateCents: number | null;
  hoursApproved: number;
  hoursBilled: number;
  billableValueCents: number;
  costValueCents: number;
  marginCents: number;
  headshotUrl: string | null;
};

export type TeamUtilTotals = {
  hoursApproved: number;
  hoursBilled: number;
  billableValueCents: number;
  costValueCents: number;
  marginCents: number;
  ghostHours: number;
};

function formatMoney(cents: number): string {
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

/**
 * Project team — consolidated view (per TT, 2026-05-07). Combines the
 * read-only utilisation overview with inline team-management (add /
 * remove members, edit role + allocation %) so partners don't have to
 * trampoline to a separate /team/edit page just to bump someone's
 * allocation. The utilisation columns (hours / billable / margin) stay
 * read-only — they're computed from timesheet activity.
 *
 * Editing affordances render only when `canEdit` is true. Ghost
 * contributors (people who logged time without being on the roster)
 * appear with an inline "Add to team" button that promotes them to a
 * proper member.
 */
export function ProjectTeamSection({
  projectId,
  projectCode,
  rows,
  totals,
  allPeople,
  canEdit,
}: {
  projectId: string;
  projectCode: string;
  rows: TeamUtilRow[];
  totals: TeamUtilTotals;
  allPeople: PersonOption[];
  canEdit: boolean;
}) {
  // Members state — the editable subset of rows. Drives the form
  // payload and the picker's "available" filter. Initialised from
  // `rows.filter(onTeam)` so the row order matches the utilisation
  // table's roster order.
  type EditableMember = {
    personId: string;
    initials: string;
    firstName: string;
    lastName: string;
    band: string | null;
    headshotUrl: string | null;
    roleOnProject: string;
    allocationPct: number;
    /** Per-project pay-rate override in dollars (UI value). Empty
     *  string = no override (falls back to Person.rate at compute-time).
     *  Sent as `customRateDollars` to saveProjectTeam. */
    customRateDollars: string;
  };
  const peopleById = useMemo(() => {
    const m = new Map<string, PersonOption>();
    for (const p of allPeople) m.set(p.id, p);
    return m;
  }, [allPeople]);

  const initialMembers: EditableMember[] = useMemo(() => {
    return rows
      .filter((r) => r.onTeam)
      .map((r) => {
        const opt = peopleById.get(r.personId);
        return {
          personId: r.personId,
          initials: r.initials,
          firstName: r.firstName,
          lastName: r.lastName,
          band: opt?.band ?? null,
          headshotUrl: r.headshotUrl,
          roleOnProject: r.roleOnProject ?? '',
          allocationPct: r.allocationPct ?? 0,
          customRateDollars:
            r.customRateCents !== null && r.customRateCents !== undefined
              ? String(Math.round(r.customRateCents / 100))
              : '',
        };
      });
  }, [rows, peopleById]);

  const [members, setMembers] = useState(initialMembers);
  const [picker, setPicker] = useState('');
  const [formState, formAction] = useFormState<TeamEditState, FormData>(
    saveProjectTeam,
    { status: 'idle' },
  );

  // Ghost rows — people logging time without being on the roster.
  // Always shown so PMs can decide to add them or challenge entries.
  const ghostRows = rows.filter((r) => !r.onTeam);

  // Lookup utilisation by personId for quick rendering of editable rows.
  const utilByPerson = useMemo(() => {
    const m = new Map<string, TeamUtilRow>();
    for (const r of rows) m.set(r.personId, r);
    return m;
  }, [rows]);

  // Picker excludes anyone already on the team.
  const usedIds = new Set(members.map((m) => m.personId));
  const availableForPicker = allPeople.filter((p) => !usedIds.has(p.id));

  function addByPersonId(personId: string) {
    const p = peopleById.get(personId);
    if (!p) return;
    setMembers((prev) => [
      ...prev,
      {
        personId: p.id,
        initials: p.initials,
        firstName: p.firstName,
        lastName: p.lastName,
        band: p.band,
        headshotUrl: p.headshotUrl,
        roleOnProject: '',
        allocationPct: 0,
        customRateDollars: '',
      },
    ]);
  }

  function removeMember(personId: string) {
    setMembers((prev) => prev.filter((m) => m.personId !== personId));
  }

  const totalAlloc = members.reduce(
    (s, m) => s + (m.allocationPct || 0),
    0,
  );

  const billablePct =
    totals.billableValueCents > 0
      ? Math.round((totals.marginCents / totals.billableValueCents) * 100)
      : null;

  return (
    <div className="space-y-4">
      {/* ── KPI strip — keeps the same shape as the prior view ───── */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-xs font-medium uppercase tracking-wide text-ink-3">
              Team size
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-lg font-semibold tabular-nums text-ink">
              {members.length}
            </div>
            <div className="text-[11px] text-ink-3">
              {ghostRows.length > 0
                ? `${ghostRows.length} ghost contributor${ghostRows.length === 1 ? '' : 's'}`
                : 'No unassigned time'}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-xs font-medium uppercase tracking-wide text-ink-3">
              Hours logged
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-lg font-semibold tabular-nums text-ink">
              {totals.hoursApproved.toFixed(1)}
            </div>
            <div className="text-[11px] text-ink-3">
              {totals.hoursBilled.toFixed(1)} billed
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-xs font-medium uppercase tracking-wide text-ink-3">
              Billable value
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-lg font-semibold tabular-nums text-ink">
              {formatMoney(totals.billableValueCents)}
            </div>
            <div className="text-[11px] text-ink-3">hrs × bill rate</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-xs font-medium uppercase tracking-wide text-ink-3">
              Margin
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div
              className={`text-lg font-semibold tabular-nums ${
                totals.marginCents < 0 ? 'text-status-red' : 'text-ink'
              }`}
            >
              {formatMoney(totals.marginCents)}
            </div>
            <div className="text-[11px] text-ink-3">
              {billablePct === null ? '—' : `${billablePct}% of billable`}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── Combined roster + utilisation table ────────────────── */}
      <Card className="p-0">
        <CardHeader className="flex flex-row items-end justify-between gap-2">
          <div>
            <CardTitle>Team utilisation</CardTitle>
            <p className="text-[11px] text-ink-3">
              {canEdit
                ? 'Edit role + allocation inline. Hours / billable / margin update from approved + billed timesheet entries.'
                : 'Read-only view. Project partner / manager / admin can edit roles + allocations.'}
            </p>
          </div>
          {canEdit && (
            <span className="text-[11px] text-ink-3">
              Total alloc:{' '}
              <span
                className={`font-semibold tabular-nums ${
                  totalAlloc > 100 ? 'text-status-amber' : 'text-ink'
                }`}
              >
                {totalAlloc}%
              </span>
            </span>
          )}
        </CardHeader>
        {/* Form wraps the entire table + picker so a single submit
             writes the whole roster atomically. */}
        <form action={formAction}>
          <input type="hidden" name="projectId" value={projectId} />

          {formState.status === 'error' && (
            <div className="mx-4 mt-2 rounded-md border border-status-red bg-status-red-soft px-3 py-2 text-xs text-status-red">
              {formState.message}
            </div>
          )}

          {members.length === 0 && ghostRows.length === 0 ? (
            <CardContent>
              <p className="text-sm text-ink-3">
                No team yet.
                {canEdit ? ' Add members below.' : ''}
              </p>
            </CardContent>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line text-[10px] uppercase tracking-wide text-ink-3">
                    <th className="px-4 py-2 text-left">Person</th>
                    <th className="px-4 py-2 text-left">Role</th>
                    <th className="px-4 py-2 text-right">Alloc</th>
                    <th className="px-4 py-2 text-right" title="Per-project pay-rate override; blank = use default Person.rate">
                      Cost rate
                    </th>
                    <th className="px-4 py-2 text-right">Hours</th>
                    <th className="px-4 py-2 text-right">Bill rate</th>
                    <th className="px-4 py-2 text-right">Billable</th>
                    <th className="px-4 py-2 text-right">Margin</th>
                    {canEdit && <th className="px-4 py-2" />}
                  </tr>
                </thead>
                <tbody>
                  {members.map((m) => {
                    const u = utilByPerson.get(m.personId);
                    return (
                      <tr
                        key={m.personId}
                        className="border-b border-line last:border-b-0"
                      >
                        <td className="px-4 py-2">
                          {/* Hidden inputs feed the saveProjectTeam action. */}
                          <input
                            type="hidden"
                            name="personId"
                            value={m.personId}
                          />
                          <Link
                            href={`/directory/people/${m.personId}`}
                            className="flex items-center gap-2 hover:underline"
                          >
                            <PersonAvatar
                              className="h-6 w-6"
                              fallbackClassName="text-[10px]"
                              initials={m.initials}
                              headshotUrl={m.headshotUrl}
                            />
                            <span className="text-ink">
                              {m.firstName} {m.lastName}
                            </span>
                            {m.band && (
                              <span className="text-[10px] text-ink-3">
                                · {m.band}
                              </span>
                            )}
                          </Link>
                        </td>
                        <td className="px-4 py-2">
                          {canEdit ? (
                            <Input
                              name="roleOnProject"
                              value={m.roleOnProject}
                              onChange={(e) =>
                                setMembers((prev) =>
                                  prev.map((x) =>
                                    x.personId === m.personId
                                      ? { ...x, roleOnProject: e.target.value }
                                      : x,
                                  ),
                                )
                              }
                              placeholder="Lead / Analyst / SME / …"
                              className="h-7 text-xs"
                            />
                          ) : (
                            <span className="text-xs text-ink-2">
                              {m.roleOnProject || '—'}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2 text-right">
                          {canEdit ? (
                            <Input
                              name="allocationPct"
                              type="number"
                              min={0}
                              max={100}
                              step={5}
                              value={m.allocationPct}
                              onChange={(e) =>
                                setMembers((prev) =>
                                  prev.map((x) =>
                                    x.personId === m.personId
                                      ? {
                                          ...x,
                                          allocationPct:
                                            Number(e.target.value) || 0,
                                        }
                                      : x,
                                  ),
                                )
                              }
                              className="h-7 w-20 text-right text-xs"
                            />
                          ) : (
                            <span className="text-xs tabular-nums text-ink-3">
                              {m.allocationPct}%
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2 text-right">
                          {/* customRateDollars stays controlled — the
                               row needs the input even when the field
                               is blank so saveProjectTeam still receives
                               a positional `customRateDollars` entry per
                               personId. */}
                          {canEdit ? (
                            <Input
                              name="customRateDollars"
                              type="number"
                              min={0}
                              max={10000}
                              step={1}
                              value={m.customRateDollars}
                              onChange={(e) =>
                                setMembers((prev) =>
                                  prev.map((x) =>
                                    x.personId === m.personId
                                      ? {
                                          ...x,
                                          customRateDollars: e.target.value,
                                        }
                                      : x,
                                  ),
                                )
                              }
                              placeholder={
                                u?.costRateCents
                                  ? `${Math.round(u.costRateCents / 100)}`
                                  : '—'
                              }
                              className="h-7 w-24 text-right text-xs"
                              title={
                                m.customRateDollars
                                  ? `Override active — ${m.customRateDollars}/hr replaces the default cost rate.`
                                  : 'Blank = inherits the person\'s default cost rate.'
                              }
                            />
                          ) : (
                            <span className="text-xs tabular-nums text-ink-3">
                              {u?.customRateCents
                                ? `$${Math.round(u.customRateCents / 100)}/h`
                                : '—'}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums text-ink">
                          {(u?.hoursApproved ?? 0).toFixed(1)}
                          {u && u.hoursBilled > 0 && (
                            <span className="ml-1 text-[10px] text-ink-3">
                              ({u.hoursBilled.toFixed(1)} billed)
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums text-xs text-ink-3">
                          {u?.billableRateCents == null
                            ? '—'
                            : `${formatMoney(u.billableRateCents)}/h`}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums text-ink">
                          {formatMoney(u?.billableValueCents ?? 0)}
                        </td>
                        <td
                          className={`px-4 py-2 text-right tabular-nums ${
                            (u?.marginCents ?? 0) < 0
                              ? 'text-status-red'
                              : 'text-ink-2'
                          }`}
                        >
                          {formatMoney(u?.marginCents ?? 0)}
                        </td>
                        {canEdit && (
                          <td className="px-4 py-2 text-right">
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-7 text-xs"
                              onClick={() => removeMember(m.personId)}
                            >
                              Remove
                            </Button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                  {/* Ghost rows — logged time but not on roster. */}
                  {ghostRows.map((r) => (
                    <tr
                      key={r.personId}
                      className="border-b border-line bg-status-amber-soft/30 last:border-b-0"
                    >
                      <td className="px-4 py-2">
                        <Link
                          href={`/directory/people/${r.personId}`}
                          className="flex items-center gap-2 hover:underline"
                        >
                          <PersonAvatar
                            className="h-6 w-6"
                            fallbackClassName="text-[10px]"
                            initials={r.initials}
                            headshotUrl={r.headshotUrl}
                          />
                          <span className="text-ink">
                            {r.firstName} {r.lastName}
                          </span>
                          <Badge variant="amber" className="text-[10px]">
                            Ghost
                          </Badge>
                        </Link>
                      </td>
                      <td className="px-4 py-2 text-xs text-ink-3">—</td>
                      <td className="px-4 py-2 text-right text-xs text-ink-3">
                        —
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-ink">
                        {r.hoursApproved.toFixed(1)}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-xs text-ink-3">
                        {r.billableRateCents == null
                          ? '—'
                          : `${formatMoney(r.billableRateCents)}/h`}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-ink">
                        {formatMoney(r.billableValueCents)}
                      </td>
                      <td
                        className={`px-4 py-2 text-right tabular-nums ${
                          r.marginCents < 0
                            ? 'text-status-red'
                            : 'text-ink-2'
                        }`}
                      >
                        {formatMoney(r.marginCents)}
                      </td>
                      {canEdit && (
                        <td className="px-4 py-2 text-right">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-7 text-xs"
                            onClick={() => addByPersonId(r.personId)}
                          >
                            Add to team
                          </Button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {canEdit && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line bg-surface-subtle/40 px-4 py-3">
              <div className="flex items-center gap-2">
                <select
                  value={picker}
                  onChange={(e) => setPicker(e.target.value)}
                  className="h-8 rounded-md border border-line bg-surface-elev px-2 text-xs text-ink"
                  aria-label="Add team member"
                >
                  <option value="">— Add team member —</option>
                  {availableForPicker.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.initials} · {p.firstName} {p.lastName} ({p.band})
                    </option>
                  ))}
                </select>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8"
                  disabled={!picker}
                  onClick={() => {
                    if (picker) {
                      addByPersonId(picker);
                      setPicker('');
                    }
                  }}
                >
                  Add
                </Button>
              </div>
              <SubmitButton />
            </div>
          )}
        </form>
      </Card>

      {totals.ghostHours > 0 && canEdit && (
        <p className="text-xs text-ink-3">
          <strong>Ghost contributors</strong> have logged time against
          this project without being on the roster. Use{' '}
          <span className="font-medium">Add to team</span> on each row to
          regularise, or challenge the entries in the timesheet approval
          queue. Allocations should add up to roughly the project&apos;s
          weekly capacity envelope —{' '}
          <Link
            href={`/projects/${projectCode}#allocation`}
            className="text-brand hover:underline"
          >
            see resource planning
          </Link>{' '}
          for firm-wide context.
        </p>
      )}
    </div>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? 'Saving…' : 'Save team'}
    </Button>
  );
}
