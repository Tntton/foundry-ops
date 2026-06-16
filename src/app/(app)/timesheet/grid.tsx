'use client';

import { useFormState, useFormStatus } from 'react-dom';
import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { saveTimesheet, recallSubmittedTimesheet, type TimesheetSaveState } from './actions';
import { PromoteSubmittedButton } from './promote-button';
import type { TimesheetRow } from '@/server/timesheet';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { formatDayLabel } from '@/lib/week';

type ProjectOption = {
  id: string;
  code: string;
  name: string;
  stage: 'kickoff' | 'delivery' | 'closing' | 'archived' | 'standing' | 'benched';
  isTeamMember: boolean;
};

export function TimesheetGrid({
  rangeStart,
  initialRows,
  cells,
  allProjects,
  view,
  targetPersonId,
  actingOnBehalf,
  isSuperAdmin,
  hourlyRateCents,
}: {
  rangeStart: string;
  initialRows: TimesheetRow[];
  cells: Date[];
  allProjects: ProjectOption[];
  view: 'week' | 'month';
  targetPersonId: string;
  actingOnBehalf: boolean;
  isSuperAdmin: boolean;
  /** Cost rate the user can monetise hours at — used purely for the $ accrued column. 0 hides the column. */
  hourlyRateCents: number;
}) {
  const [rows, setRows] = useState(initialRows);
  const [state, action] = useFormState<TimesheetSaveState, FormData>(saveTimesheet, {
    status: 'idle',
  });

  const dayCount = cells.length;
  const usedProjectIds = useMemo(() => new Set(rows.map((r) => r.projectId)), [rows]);
  const addableProjects = allProjects.filter((p) => !usedProjectIds.has(p.id));
  const submittedRowCount = useMemo(
    () =>
      rows.reduce(
        (n, r) =>
          n +
          (r.status === 'submitted' || r.status === 'mixed'
            ? r.cells.reduce((s, c) => s + (c.hours > 0 ? 1 : 0), 0)
            : 0),
        0,
      ),
    [rows],
  );
  // Show the "promote backlog" affordance only when:
  //   - the viewer can act on behalf (super_admin / admin / manager / partner) AND
  //   - they're looking at someone else's sheet AND
  //   - there's at least one submitted entry visible
  const canShowPromote =
    actingOnBehalf && submittedRowCount > 0;

  const dailyTotals = cells.map((_, i) =>
    rows.reduce((sum, r) => sum + (r.cells[i]?.hours ?? 0), 0),
  );
  const rangeTotal = dailyTotals.reduce((s, h) => s + h, 0);

  // Week column dividers — mark the first day of each Mon-Sun block inside the range.
  const weekBoundaries = new Set<number>();
  cells.forEach((d, i) => {
    if (i > 0 && d.getUTCDay() === 1) weekBoundaries.add(i);
  });

  function setHours(projectId: string, dayIdx: number, hours: number) {
    setRows((prev) =>
      prev.map((r) =>
        r.projectId === projectId
          ? {
              ...r,
              cells: r.cells.map((c, i) =>
                i === dayIdx ? { ...c, hours: Number.isFinite(hours) ? hours : 0 } : c,
              ),
            }
          : r,
      ),
    );
  }

  function setDescription(projectId: string, description: string) {
    setRows((prev) => prev.map((r) => (r.projectId === projectId ? { ...r, description } : r)));
  }

  function addRow(p: ProjectOption) {
    setRows((prev) => [
      ...prev,
      {
        projectId: p.id,
        projectCode: p.code,
        projectName: p.name,
        projectStage: p.stage,
        description: '',
        status: 'draft',
        cells: cells.map((date) => ({ date, hours: 0 })),
      },
    ]);
  }

  function removeRow(projectId: string) {
    setRows((prev) => prev.filter((r) => r.projectId !== projectId));
  }

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="rangeStart" value={rangeStart} />
      <input type="hidden" name="dayCount" value={dayCount} />
      <input type="hidden" name="targetPersonId" value={targetPersonId} />

      {state.status === 'error' && (
        <div className="rounded-md border border-status-red bg-status-red-soft px-3 py-2 text-sm text-status-red">
          {state.message}
        </div>
      )}
      {state.status === 'success' && (
        <div className="rounded-md border border-status-green bg-status-green-soft px-3 py-2 text-sm text-status-green">
          {state.message}
        </div>
      )}

      {isSuperAdmin && actingOnBehalf && (
        <div className="flex flex-wrap items-start justify-between gap-3 rounded-md border border-status-amber/40 bg-status-amber-soft/40 px-3 py-2 text-xs text-status-amber">
          <span>
            Super-admin override mode: you can edit approved entries (statuses
            are preserved). Billed entries can&apos;t be touched here — void in
            Xero first. New / draft hours posted here are{' '}
            <strong>auto-approved</strong> and skip the queue.
          </span>
          {canShowPromote && (
            <PromoteSubmittedButton
              targetPersonId={targetPersonId}
              rangeStart={rangeStart}
              dayCount={dayCount}
              submittedCount={submittedRowCount}
            />
          )}
        </div>
      )}
      {!actingOnBehalf && isSuperAdmin && (
        <div className="rounded-md border border-status-green/40 bg-status-green-soft/40 px-3 py-2 text-xs text-status-green">
          Super-admin: your saves <strong>auto-approve</strong> on submit and
          land directly in project P&amp;L.
        </div>
      )}
      {actingOnBehalf && !isSuperAdmin && (
        <div className="flex flex-wrap items-start justify-between gap-3 rounded-md border border-status-amber/40 bg-status-amber-soft/40 px-3 py-2 text-xs text-status-amber">
          <span>
            Editing on behalf: rows on projects <strong>you lead</strong>{' '}
            auto-approve on submit; rows on projects you don&apos;t lead will be
            rejected.
          </span>
          {canShowPromote && (
            <PromoteSubmittedButton
              targetPersonId={targetPersonId}
              rangeStart={rangeStart}
              dayCount={dayCount}
              submittedCount={submittedRowCount}
            />
          )}
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-line bg-card">
        <table className="w-full text-sm">
          <thead className="bg-surface-subtle text-ink-3">
            <tr className="border-b border-line">
              <th className="sticky left-0 z-10 min-w-[220px] bg-surface-subtle px-3 py-2 text-left">
                Project
              </th>
              {cells.map((d, i) => (
                <th
                  key={i}
                  className={cn(
                    'min-w-[52px] px-1 py-2 text-center',
                    weekBoundaries.has(i) && 'border-l border-line',
                    (d.getUTCDay() === 0 || d.getUTCDay() === 6) &&
                      'bg-[repeating-linear-gradient(135deg,_var(--surface-subtle)_0px,_var(--surface-subtle)_4px,_transparent_4px,_transparent_8px)]',
                  )}
                >
                  <div className="text-[10px] font-medium uppercase tracking-wide">
                    {formatDayLabel(d)}
                  </div>
                </th>
              ))}
              <th className="px-3 py-2 text-right">Total</th>
              {hourlyRateCents > 0 && (
                <th className="px-3 py-2 text-right">$ accrued</th>
              )}
              <th aria-label="actions" />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={dayCount + (hourlyRateCents > 0 ? 4 : 3)}
                  className="p-8 text-center text-sm text-ink-3"
                >
                  No rows yet — add a project below to start.
                </td>
              </tr>
            ) : (
              rows.map((r) => {
                const total = r.cells.reduce((s, c) => s + c.hours, 0);
                const isLocked =
                  r.status === 'approved' || r.status === 'billed';
                // Billed entries are always read-only here (need an invoice
                // void first). Approved entries can be edited by super_admin
                // overriders.
                const editable =
                  r.status === 'billed'
                    ? false
                    : !isLocked || isSuperAdmin;
                return (
                  <tr key={r.projectId} className="border-b border-line last:border-b-0">
                    <td className="sticky left-0 z-10 bg-card px-3 py-2">
                      <div className="flex flex-col">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-[11px] text-ink-3">
                            {r.projectCode}
                          </span>
                          <span className="text-sm font-medium text-ink">
                            {r.projectName}
                          </span>
                          <StatusBadge status={r.status} />
                          {isLocked && editable && (
                            <Badge
                              variant="outline"
                              className="text-[10px] uppercase tracking-wide"
                            >
                              SU edit
                            </Badge>
                          )}
                        </div>
                        <span className="mt-0.5 text-[11px] capitalize text-ink-3">
                          {r.projectStage}
                        </span>
                        <input type="hidden" name="projectId" value={r.projectId} />
                        <Input
                          name={`description::${r.projectId}`}
                          value={r.description}
                          onChange={(e) => setDescription(r.projectId, e.target.value)}
                          placeholder="Description (optional)"
                          disabled={!editable}
                          className="mt-1 h-8 text-xs"
                        />
                      </div>
                    </td>
                    {r.cells.map((c, i) => (
                      <td
                        key={i}
                        className={cn(
                          'px-0.5 py-2',
                          weekBoundaries.has(i) && 'border-l border-line',
                          (c.date.getUTCDay() === 0 || c.date.getUTCDay() === 6) &&
                            'bg-[repeating-linear-gradient(135deg,_var(--surface-subtle)_0px,_var(--surface-subtle)_4px,_transparent_4px,_transparent_8px)]',
                        )}
                      >
                        <input
                          name={`hours::${r.projectId}::${i}`}
                          type="number"
                          min="0"
                          max="24"
                          step="0.5"
                          value={c.hours === 0 ? '' : String(c.hours)}
                          onChange={(e) =>
                            setHours(r.projectId, i, parseFloat(e.target.value || '0'))
                          }
                          disabled={!editable}
                          placeholder="0"
                          className={cn(
                            'h-8 w-full rounded-md border border-line bg-surface-elev px-1 text-center text-sm tabular-nums text-ink focus:outline-none focus:ring-1 focus:ring-ring',
                            !editable && 'bg-surface-subtle',
                          )}
                        />
                      </td>
                    ))}
                    <td className="px-3 py-2 text-right font-semibold tabular-nums text-ink">
                      {total.toFixed(1)}h
                    </td>
                    {hourlyRateCents > 0 && (
                      <td className="px-3 py-2 text-right tabular-nums text-ink-2">
                        {total > 0
                          ? formatAccrued(total * hourlyRateCents)
                          : <span className="text-ink-4">—</span>}
                      </td>
                    )}
                    <td className="px-2 py-2 text-right">
                      <div className="flex flex-col items-end gap-1">
                        {r.status === 'submitted' && editable && (
                          <RecallRowButton
                            targetPersonId={targetPersonId}
                            projectId={r.projectId}
                            rangeStart={rangeStart}
                            dayCount={dayCount}
                          />
                        )}
                        {editable && (
                          <button
                            type="button"
                            onClick={() => removeRow(r.projectId)}
                            className="text-xs text-ink-3 hover:text-ink"
                          >
                            Remove
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
          <tfoot className="bg-brand text-white">
            <tr>
              <td className="sticky left-0 z-10 bg-brand px-3 py-2 text-left font-mono text-xs uppercase tracking-wide text-white">
                Daily total
              </td>
              {dailyTotals.map((t, i) => (
                <td
                  key={i}
                  className={cn(
                    'px-0.5 py-2 text-center font-semibold tabular-nums text-white',
                    weekBoundaries.has(i) && 'border-l border-white/20',
                    // Over-24h still flags red even on the white footer
                    // since it's a hard error and worth pulling the eye.
                    t > 24 && 'text-status-red',
                  )}
                >
                  {t > 0 ? t.toFixed(0) : '0'}
                </td>
              ))}
              <td className="px-3 py-2 text-right font-semibold tabular-nums text-white">
                {rangeTotal.toFixed(0)}h
              </td>
              {hourlyRateCents > 0 && (
                <td className="px-3 py-2 text-right font-semibold tabular-nums text-white">
                  {formatAccrued(rangeTotal * hourlyRateCents)}
                </td>
              )}
              <td />
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
        <div className="flex flex-wrap gap-1.5">
          {(() => {
            const overCap = dailyTotals
              .map((t, i) => ({ t, i }))
              .filter(({ t }) => t > 10);
            if (overCap.length === 0) return null;
            return overCap.map(({ t, i }) => {
              const dayLabel = formatDayLabel(cells[i]!).split(' ')[0] ?? '';
              return (
                <span
                  key={i}
                  className="inline-flex items-center gap-1 rounded-full border border-status-amber bg-status-amber-soft px-2 py-0.5 text-status-amber"
                >
                  <span className="inline-block h-1 w-1 rounded-full bg-status-amber" />
                  {dayLabel} {t.toFixed(0)}h exceeds 10h soft cap
                </span>
              );
            });
          })()}
          <span className="inline-flex items-center gap-1 rounded-full border border-status-green bg-status-green-soft px-2 py-0.5 text-status-green">
            <span className="inline-block h-1 w-1 rounded-full bg-status-green" />
            All rows have project codes
          </span>
          <span className="inline-flex items-center gap-1 rounded-full border border-line bg-card px-2 py-0.5 text-ink-3">
            autosaves on blur
          </span>
        </div>
        <span className="font-mono text-[11px] text-ink-3">
          Bulk paste from Excel? Just Ctrl+V in any cell →
        </span>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        {addableProjects.length > 0 ? (
          <AddRowPicker projects={addableProjects} onAdd={addRow} />
        ) : (
          <span className="text-xs text-ink-3">All your projects are on the sheet.</span>
        )}
        <div className="flex items-center gap-2">
          <span className="text-xs text-ink-3">
            {view === 'month'
              ? 'Submit marks all editable rows as submitted for the whole block.'
              : 'Submit marks this week for approval.'}
          </span>
          <SaveButton intent="save" label="Save draft" variant="outline" />
          <SaveButton intent="submit" label="Submit for approval" variant="default" />
        </div>
      </div>
    </form>
  );
}

function AddRowPicker({
  projects,
  onAdd,
}: {
  projects: ProjectOption[];
  onAdd: (p: ProjectOption) => void;
}) {
  const [selected, setSelected] = useState<string>('');
  const selectedProject = projects.find((p) => p.id === selected);
  // Sort so on-team projects come first; "join via timesheet" projects after.
  const sorted = useMemo(
    () =>
      [...projects].sort((a, b) => {
        if (a.isTeamMember !== b.isTeamMember) return a.isTeamMember ? -1 : 1;
        return a.code.localeCompare(b.code);
      }),
    [projects],
  );
  // "On the project team" group is active-only; archived projects route
  // to the dedicated "Closed projects (needs approval)" group below
  // regardless of team membership, so the approval-required label is
  // never hidden behind the "your team" shorthand.
  const onTeamCount = projects.filter(
    (p) => p.isTeamMember && p.stage !== 'archived',
  ).length;

  return (
    <div className="flex flex-col items-start gap-1">
      <div className="flex items-center gap-2">
        <select
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          className="h-9 min-w-[280px] rounded-md border border-line bg-surface-elev px-2 text-sm text-ink"
        >
          <option value="">— Add project row —</option>
          {onTeamCount > 0 && (
            <optgroup label="On the project team">
              {sorted
                .filter((p) => p.isTeamMember && p.stage !== 'archived')
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.code} · {p.name}
                  </option>
                ))}
            </optgroup>
          )}
          {sorted.some((p) => !p.isTeamMember && p.stage !== 'archived') && (
            <optgroup label="Other active projects (will auto-join the team)">
              {sorted
                .filter((p) => !p.isTeamMember && p.stage !== 'archived')
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.code} · {p.name}
                  </option>
                ))}
            </optgroup>
          )}
          {sorted.some((p) => p.stage === 'archived') && (
            <optgroup label="Closed projects (entries need approval)">
              {sorted
                .filter((p) => p.stage === 'archived')
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.code} · {p.name}
                  </option>
                ))}
            </optgroup>
          )}
        </select>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!selectedProject}
          onClick={() => {
            if (selectedProject) {
              onAdd(selectedProject);
              setSelected('');
            }
          }}
        >
          Add
        </Button>
      </div>
      {selectedProject && !selectedProject.isTeamMember && (
        <p className="text-[11px] text-status-amber">
          Not yet on this project team. Saving any hours will auto-add the person at
          0% allocation so resourcing reflects the time. The owning partner can
          adjust the allocation from the project Team page.
        </p>
      )}
    </div>
  );
}

function SaveButton({
  intent,
  label,
  variant,
}: {
  intent: 'save' | 'submit';
  label: string;
  variant: 'default' | 'outline';
}) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      name="intent"
      value={intent}
      variant={variant}
      disabled={pending}
    >
      {pending ? '…' : label}
    </Button>
  );
}

function StatusBadge({ status }: { status: TimesheetRow['status'] }) {
  const map: Record<TimesheetRow['status'], { label: string; variant: 'outline' | 'amber' | 'green' | 'blue' | 'red' }> = {
    draft: { label: 'draft', variant: 'outline' },
    submitted: { label: 'submitted', variant: 'amber' },
    approved: { label: 'approved', variant: 'green' },
    billed: { label: 'billed', variant: 'blue' },
    mixed: { label: 'mixed', variant: 'red' },
  };
  const s = map[status];
  return <Badge variant={s.variant}>{s.label}</Badge>;
}

/**
 * Reopen a submitted row for editing. Calls the recall server action via
 * useTransition so we don't trip the parent grid's <form>. After success, we
 * `router.refresh()` to pull the new (now `draft`) status from the server,
 * which feeds the grid's initialRows on the next render.
 */
function RecallRowButton({
  targetPersonId,
  projectId,
  rangeStart,
  dayCount,
}: {
  targetPersonId: string;
  projectId: string;
  rangeStart: string;
  dayCount: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onClick() {
    setError(null);
    if (
      !confirm(
        'Recall these submitted hours back to draft? They’ll leave the approval queue and you can edit freely.',
      )
    ) {
      return;
    }
    const fd = new FormData();
    fd.set('targetPersonId', targetPersonId);
    fd.set('projectId', projectId);
    fd.set('rangeStart', rangeStart);
    fd.set('dayCount', String(dayCount));
    startTransition(async () => {
      const result = await recallSubmittedTimesheet({ status: 'idle' }, fd);
      if (result.status === 'error') {
        setError(result.message);
      } else {
        router.refresh();
      }
    });
  }

  return (
    <div className="flex flex-col items-end gap-0.5">
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        className="text-xs text-status-amber underline-offset-2 hover:underline disabled:opacity-50"
      >
        {pending ? 'Recalling…' : 'Recall to draft'}
      </button>
      {error && <span className="text-[10px] text-status-red">{error}</span>}
    </div>
  );
}

/** Formats cents as $X,XXX (truncated to whole dollars — accrued is a quick read, not GL precision). */
function formatAccrued(cents: number): string {
  const dollars = Math.round(cents / 100);
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    maximumFractionDigits: 0,
  }).format(dollars);
}
