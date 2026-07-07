'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import {
  submitAvailabilityForecast,
  type AvailabilityFormState,
} from './availability-action';
import { Button } from '@/components/ui/button';

export type AvailabilityDayInput = {
  dateIso: string; // YYYY-MM-DD
  hours: number | null;
  notes: string | null;
  /** Project the hours are earmarked to. Null = unallocated (open for
   *  the resource-planning team to slot into a project later). */
  projectId: string | null;
};

export type AllocatableProject = {
  id: string;
  code: string;
  name: string;
};

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/**
 * Availability grid — rotated layout (per TT, 2026-05-07).
 *
 *   Rows  : weeks (up to 8)
 *   Cols  : Mon → Sun + total + a single per-week note
 *
 * Per-day hours are still stored per-day in `AvailabilityForecast`; the
 * per-week note is consolidated and persisted on the Monday row's
 * `notes` column. Reads pull the Monday note as the week note, ignoring
 * any leftover per-day notes from the prior schema (they get cleared on
 * the next save because we always write a full diff).
 *
 * Single Save action commits everything at once — partial saves are a
 * future improvement once the volume warrants it.
 */
export function AvailabilityEditor({
  personId,
  weeks,
  targetFirstName,
  weeklyCapacityHours,
  initialCells,
  allocatableProjects,
}: {
  personId: string;
  /** One entry per week (default 8). Used for the row labels. */
  weeks: Array<{ weekStartIso: string; label: string }>;
  targetFirstName: string;
  /** FTE × 38 / 5 = baseline daily capacity (used as the placeholder). */
  weeklyCapacityHours: number;
  /** weeks.length × 7 cells, ordered week-major, day-minor. */
  initialCells: AvailabilityDayInput[];
  /** Active (non-archived) projects the person can allocate hours to.
   *  Filtered server-side to what makes sense (their team-mates on
   *  their own projects, or the full firm list for admins). */
  allocatableProjects: AllocatableProject[];
}) {
  // Per-day hours, stored as strings so blank stays blank rather than
  // coercing to "0".
  const [hours, setHours] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const c of initialCells) {
      out[c.dateIso] = c.hours !== null ? String(c.hours) : '';
    }
    return out;
  });
  // Per-week notes, keyed by week-start ISO. Seeded from the Monday cell
  // of each week — that's where the consolidated note lives in the DB.
  const [weekNotes, setWeekNotes] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (let w = 0; w < weeks.length; w += 1) {
      const monday = initialCells[w * 7];
      if (!monday) continue;
      out[weeks[w]!.weekStartIso] = monday.notes ?? '';
    }
    return out;
  });
  // Per-cell project allocation. Value is the project code (string) or
  // empty string for "unallocated". Seeded from initialCells; when the
  // user types hours into a blank cell we default it to unallocated so
  // the resource-planning team can see spare bandwidth. Fan-out and
  // apply-default helpers propagate the same code across weekdays.
  const projectIdToCode = useMemo(() => {
    const m: Record<string, string> = {};
    for (const p of allocatableProjects) m[p.id] = p.code;
    return m;
  }, [allocatableProjects]);
  const [cellProjectCode, setCellProjectCode] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const c of initialCells) {
      out[c.dateIso] =
        c.projectId && projectIdToCode[c.projectId]
          ? projectIdToCode[c.projectId]!
          : '';
    }
    return out;
  });
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<AvailabilityFormState>({ status: 'idle' });
  // Bulk-fill project selection (the one-shot "fill all weeks" control).
  const [bulkProjectCode, setBulkProjectCode] = useState<string>('');

  const dailyCapacityPlaceholder =
    weeklyCapacityHours > 0 ? Math.round(weeklyCapacityHours / 5) : 0;

  // ── Dirty tracking ────────────────────────────────────────────────
  // Snapshot the initial serialized state once; any divergence = dirty.
  // While dirty, beforeunload warns on navigation (covers the person
  // picker's GET-form submit and the back-link too, since both are
  // full navigations).
  const initialSnapshot = useMemo(() => {
    const h: Record<string, string> = {};
    for (const c of initialCells) h[c.dateIso] = c.hours !== null ? String(c.hours) : '';
    const n: Record<string, string> = {};
    for (let w = 0; w < weeks.length; w += 1) {
      const monday = initialCells[w * 7];
      if (monday) n[weeks[w]!.weekStartIso] = monday.notes ?? '';
    }
    const p: Record<string, string> = {};
    for (const c of initialCells) {
      p[c.dateIso] =
        c.projectId && projectIdToCode[c.projectId] ? projectIdToCode[c.projectId]! : '';
    }
    return JSON.stringify({ h, n, p });
  }, [initialCells, weeks, projectIdToCode]);
  const isDirty =
    JSON.stringify({ h: hours, n: weekNotes, p: cellProjectCode }) !== initialSnapshot &&
    state.status !== 'success';
  useEffect(() => {
    if (!isDirty) return;
    function onBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault();
      // Chrome requires returnValue to be set for the prompt to show.
      e.returnValue = '';
    }
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [isDirty]);

  // Any edit invalidates a stale "Saved" banner so feedback always
  // reflects the current grid, not the last save.
  function touch() {
    setState((s) => (s.status === 'idle' ? s : { status: 'idle' }));
  }
  function setHourCell(dateIso: string, raw: string) {
    touch();
    setHours((prev) => ({ ...prev, [dateIso]: raw }));
  }
  function setWeekNote(weekStartIso: string, raw: string) {
    touch();
    setWeekNotes((prev) => ({ ...prev, [weekStartIso]: raw }));
  }
  function setCellProject(dateIso: string, code: string) {
    touch();
    setCellProjectCode((prev) => ({ ...prev, [dateIso]: code }));
  }

  /**
   * Distribute integer `total` hours across Mon-Fri with floor +
   * remainder pushed onto later weekdays, so the days sum back to the
   * total exactly. Shared by fan-out and bulk fill.
   */
  function weekdaySplit(total: number): number[] {
    const clamped = Math.max(0, Math.min(24 * 5, Math.round(total)));
    const base = Math.floor(clamped / 5);
    const remainder = clamped % 5;
    const days = [base, base, base, base, base];
    for (let i = 0; i < remainder; i += 1) days[4 - i]! += 1;
    return days;
  }

  /**
   * Set the same project on every hours-bearing cell in a given week
   * row. Quick way to say "all my Mon-Fri hours this week are on
   * GEN003" without touching each day individually. Empty code sets
   * the week back to unallocated.
   */
  function applyProjectToWeek(weekIndex: number, code: string) {
    touch();
    const rowCells = initialCells.slice(weekIndex * 7, weekIndex * 7 + 7);
    // Derive the target cells from current state BEFORE the setState
    // call — never read one state map inside another's updater.
    const targets = rowCells.filter((c) => {
      const h = (hours[c.dateIso] ?? '').trim();
      return h !== '' && Number(h) > 0;
    });
    setCellProjectCode((prev) => {
      const next = { ...prev };
      for (const c of targets) next[c.dateIso] = code;
      return next;
    });
  }

  /**
   * Weekly-total fan-out. Weekend hours are PRESERVED — the typed
   * total is treated as the whole week, so we distribute
   * (total - weekend) across Mon-Fri. Clearing the total blanks the
   * weekdays but leaves deliberately-entered weekend hours alone.
   */
  function fanOutWeek(weekIndex: number, raw: string) {
    touch();
    const rowCells = initialCells.slice(weekIndex * 7, weekIndex * 7 + 7);
    const weekdayCells = rowCells.slice(0, 5);
    const weekendCells = rowCells.slice(5);
    const weekendSum = weekendCells.reduce((s, c) => {
      const v = Number((hours[c.dateIso] ?? '').trim());
      return s + (Number.isFinite(v) ? v : 0);
    }, 0);
    setHours((prev) => {
      const next = { ...prev };
      const trimmed = raw.trim();
      if (trimmed === '') {
        for (const c of weekdayCells) next[c.dateIso] = '';
        return next;
      }
      const parsed = Number(trimmed);
      if (!Number.isFinite(parsed)) return prev;
      const weekdayTotal = Math.max(0, Math.round(parsed) - weekendSum);
      const days = weekdaySplit(weekdayTotal);
      for (let d = 0; d < 5; d += 1) {
        const c = weekdayCells[d];
        if (!c) continue;
        next[c.dateIso] = String(days[d]);
      }
      return next;
    });
  }

  /**
   * One-shot bulk fill: for every week, fill blank weekday cells so the
   * week reaches capacity (floor+remainder split — sums exactly to
   * capacity, unlike the old flat-8h fill that overshot 38h to 40h),
   * then stamp the chosen project (or Free) on every hours-bearing
   * cell across all weeks. The canonical "38h on GEN003 for 8 weeks"
   * declaration becomes: pick project → click Fill → Save.
   */
  function bulkFillAllWeeks() {
    touch();
    if (weeklyCapacityHours === 0) return;
    const nextHours: Record<string, string> = { ...hours };
    for (let w = 0; w < weeks.length; w += 1) {
      const rowCells = initialCells.slice(w * 7, w * 7 + 7);
      const weekdayCells = rowCells.slice(0, 5);
      const hasAnyHours = rowCells.some((c) => {
        const v = (nextHours[c.dateIso] ?? '').trim();
        return v !== '' && Number(v) > 0;
      });
      // Don't rewrite weeks the person has already shaped by hand.
      if (hasAnyHours) continue;
      const days = weekdaySplit(weeklyCapacityHours);
      for (let d = 0; d < 5; d += 1) {
        const c = weekdayCells[d];
        if (!c) continue;
        nextHours[c.dateIso] = String(days[d]);
      }
    }
    const nextProjects: Record<string, string> = { ...cellProjectCode };
    for (const c of initialCells) {
      const v = (nextHours[c.dateIso] ?? '').trim();
      if (v !== '' && Number(v) > 0) nextProjects[c.dateIso] = bulkProjectCode;
    }
    setHours(nextHours);
    setCellProjectCode(nextProjects);
  }

  function clearAll() {
    touch();
    const blankH: Record<string, string> = {};
    for (const c of initialCells) blankH[c.dateIso] = '';
    setHours(blankH);
    const blankN: Record<string, string> = {};
    for (const w of weeks) blankN[w.weekStartIso] = '';
    setWeekNotes(blankN);
    const blankP: Record<string, string> = {};
    for (const c of initialCells) blankP[c.dateIso] = '';
    setCellProjectCode(blankP);
  }

  function reset() {
    setHours(() => {
      const out: Record<string, string> = {};
      for (const c of initialCells) {
        out[c.dateIso] = c.hours !== null ? String(c.hours) : '';
      }
      return out;
    });
    setWeekNotes(() => {
      const out: Record<string, string> = {};
      for (let w = 0; w < weeks.length; w += 1) {
        const monday = initialCells[w * 7];
        if (!monday) continue;
        out[weeks[w]!.weekStartIso] = monday.notes ?? '';
      }
      return out;
    });
    setCellProjectCode(() => {
      const out: Record<string, string> = {};
      for (const c of initialCells) {
        out[c.dateIso] =
          c.projectId && projectIdToCode[c.projectId]
            ? projectIdToCode[c.projectId]!
            : '';
      }
      return out;
    });
    setState({ status: 'idle' });
  }

  function save() {
    setState({ status: 'idle' });
    const cells = initialCells.map((c, idx) => {
      const rawH = (hours[c.dateIso] ?? '').trim();
      // Whole hours only — the DB column is Int, so send integers and
      // never let the server silently round a value the user typed.
      const h =
        rawH === ''
          ? null
          : Math.round(Math.max(0, Math.min(24, Number(rawH) || 0)));
      // Week note rides on Monday only; Tue–Sun get notes=null so any
      // legacy per-day notes get wiped on save.
      const isMonday = idx % 7 === 0;
      const weekIndex = Math.floor(idx / 7);
      const wIso = weeks[weekIndex]?.weekStartIso;
      const note =
        isMonday && wIso ? (weekNotes[wIso] ?? '').trim() : '';
      // Project code sent as short-form; server resolves to Project.id.
      // Cells with no hours drop the project link so we never store a
      // dangling "GEN003, 0 hours" allocation.
      const code = (cellProjectCode[c.dateIso] ?? '').trim();
      const projectCode = h && h > 0 && code.length > 0 ? code : null;
      return {
        dateIso: c.dateIso,
        hours: h,
        notes: note === '' ? null : note,
        projectCode,
      };
    });
    const fd = new FormData();
    fd.set('personId', personId);
    fd.set('cells', JSON.stringify(cells));
    startTransition(async () => {
      const result = await submitAvailabilityForecast(
        { status: 'idle' },
        fd,
      );
      setState(result);
    });
  }

  // Per-week totals at the right of each row — handy for sanity-checking
  // numbers against expected weekly hours.
  function weekTotal(weekIndex: number): number {
    let total = 0;
    for (let d = 0; d < 7; d += 1) {
      const c = initialCells[weekIndex * 7 + d];
      if (!c) continue;
      const v = hours[c.dateIso] ?? '';
      if (v === '') continue;
      const n = Number(v);
      if (Number.isFinite(n)) total += n;
    }
    return total;
  }

  // Highlight today's cell to anchor the grid visually. Local date,
  // not UTC — toISOString() would highlight yesterday until ~10-11am
  // in AU/NZ timezones.
  const todayIso = (() => {
    const d = new Date();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${m}-${day}`;
  })();

  return (
    <div className="space-y-3 rounded-lg border border-line bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-ink">
            {targetFirstName === 'You'
              ? `My availability · next ${weeks.length} weeks`
              : `${targetFirstName}'s availability · next ${weeks.length} weeks`}
          </h3>
          <p className="text-[11px] text-ink-3">
            Hours you expect to work each day, or type a weekly total
            in the right-hand column and we&apos;ll fan it out across
            Mon-Fri. Under each day, tag the hours to a specific project
            code or leave them as <span className="font-medium text-ink-2">Free</span> so
            resource planning can see spare bandwidth to allocate. One
            short week note for context (OOO, onsite, conference, etc).
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {weeklyCapacityHours > 0 && (
            <div className="flex items-center gap-1 rounded-md border border-line bg-surface-elev px-1.5 py-1">
              <select
                value={bulkProjectCode}
                onChange={(e) => setBulkProjectCode(e.target.value)}
                className="h-6 rounded border-0 bg-transparent text-[11px] text-ink-2 focus:outline-none"
                aria-label="Project for bulk fill"
              >
                <option value="">Free (unallocated)</option>
                {allocatableProjects.map((p) => (
                  <option key={p.id} value={p.code}>
                    {p.code}
                  </option>
                ))}
              </select>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={bulkFillAllWeeks}
                title={`Fill every empty week to ${weeklyCapacityHours}h across Mon-Fri and tag all hours${bulkProjectCode ? ` to ${bulkProjectCode}` : ' as Free'}`}
              >
                Fill all {weeks.length} weeks ({weeklyCapacityHours}h)
              </Button>
            </div>
          )}
          <Button type="button" size="sm" variant="ghost" onClick={clearAll}>
            Clear
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={reset}>
            Reset
          </Button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[860px] border-collapse text-sm">
          <thead>
            <tr>
              <th className="w-24 border-b border-line bg-surface-subtle px-2 py-2 text-left text-[10px] font-medium uppercase tracking-wide text-ink-3">
                Week
              </th>
              {DAY_LABELS.map((d) => (
                <th
                  key={d}
                  className="w-[64px] border-b border-line bg-surface-subtle px-1 py-2 text-center text-[10px] font-medium uppercase tracking-wide text-ink-3"
                >
                  {d}
                </th>
              ))}
              <th className="w-16 border-b border-line bg-surface-subtle px-2 py-2 text-right text-[10px] font-medium uppercase tracking-wide text-ink-3">
                Total
              </th>
              <th className="border-b border-line bg-surface-subtle px-2 py-2 text-left text-[10px] font-medium uppercase tracking-wide text-ink-3">
                Note for week
              </th>
            </tr>
          </thead>
          <tbody>
            {weeks.map((w, weekIndex) => {
              const rowCells = initialCells.slice(
                weekIndex * 7,
                weekIndex * 7 + 7,
              );
              const total = weekTotal(weekIndex);
              const overCapacity =
                weeklyCapacityHours > 0 && total > weeklyCapacityHours;
              const underCapacity =
                weeklyCapacityHours > 0 && total < weeklyCapacityHours * 0.5;
              return (
                <tr
                  key={w.weekStartIso}
                  className="border-b border-line last:border-b-0"
                >
                  <td className="bg-surface-subtle/40 px-2 py-1.5 text-xs font-medium text-ink-2">
                    Wk {w.label}
                  </td>
                  {DAY_LABELS.map((_, dayIndex) => {
                    const c = rowCells[dayIndex];
                    if (!c) return <td key={dayIndex} />;
                    const isToday = c.dateIso === todayIso;
                    const cellHours = (hours[c.dateIso] ?? '').trim();
                    const hasHours = cellHours !== '' && Number(cellHours) > 0;
                    const projectCode = cellProjectCode[c.dateIso] ?? '';
                    return (
                      <td
                        key={c.dateIso}
                        className={`px-1 py-1.5 align-top text-center ${
                          isToday ? 'bg-brand-soft/40' : ''
                        }`}
                      >
                        <input
                          type="number"
                          min={0}
                          max={24}
                          step={1}
                          placeholder={String(dailyCapacityPlaceholder)}
                          value={hours[c.dateIso] ?? ''}
                          onChange={(e) =>
                            setHourCell(c.dateIso, e.target.value)
                          }
                          className="h-7 w-14 rounded border border-line bg-surface-elev px-1 text-center text-xs tabular-nums text-ink focus:border-brand"
                          aria-label={`Hours for ${c.dateIso}`}
                        />
                        {hasHours && (
                          <select
                            value={projectCode}
                            onChange={(e) => setCellProject(c.dateIso, e.target.value)}
                            className={`mt-1 h-6 w-14 rounded border px-0.5 text-center text-[10px] tabular-nums focus:border-brand ${
                              projectCode
                                ? 'border-brand text-brand'
                                : 'border-line bg-surface-elev text-ink-3'
                            }`}
                            aria-label={`Project for ${c.dateIso}`}
                            title={
                              projectCode
                                ? `Allocated to ${projectCode}`
                                : 'Unallocated - available bandwidth'
                            }
                          >
                            <option value="">Free</option>
                            {allocatableProjects.map((p) => (
                              <option key={p.id} value={p.code}>
                                {p.code}
                              </option>
                            ))}
                          </select>
                        )}
                      </td>
                    );
                  })}
                  <td
                    className="px-2 py-1.5 text-center"
                    title={
                      weeklyCapacityHours > 0
                        ? `Capacity ≈ ${weeklyCapacityHours}h · type a weekly total to fan out across Mon-Fri`
                        : 'Type a weekly total to fan out across Mon-Fri'
                    }
                  >
                    <input
                      type="number"
                      min={0}
                      max={24 * 5}
                      step={1}
                      placeholder={
                        weeklyCapacityHours > 0
                          ? String(weeklyCapacityHours)
                          : '38'
                      }
                      value={total === 0 ? '' : String(total)}
                      onChange={(e) => fanOutWeek(weekIndex, e.target.value)}
                      className={`h-7 w-16 rounded border border-line bg-surface-elev px-1 text-center text-xs font-semibold tabular-nums focus:border-brand ${
                        overCapacity
                          ? 'text-status-amber'
                          : underCapacity
                            ? 'text-ink-3'
                            : 'text-ink'
                      }`}
                      aria-label={`Weekly total for week of ${w.label}`}
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <div className="flex items-center gap-1">
                      <input
                        type="text"
                        maxLength={200}
                        placeholder="OOO Wed AM, client onsite, conference…"
                        value={weekNotes[w.weekStartIso] ?? ''}
                        onChange={(e) =>
                          setWeekNote(w.weekStartIso, e.target.value)
                        }
                        className="h-7 min-w-0 flex-1 rounded border border-line bg-surface-elev px-1.5 text-[11px] text-ink-2 focus:border-brand"
                        aria-label={`Note for week of ${w.label}`}
                      />
                      <select
                        value="__prompt"
                        disabled={total === 0}
                        onChange={(e) => {
                          const v = e.target.value;
                          if (v === '__prompt') return;
                          // Sentinel value for "clear allocation" — separate
                          // from the disabled prompt so we can tell them apart.
                          const code = v === '__free' ? '' : v;
                          applyProjectToWeek(weekIndex, code);
                        }}
                        className="h-7 w-24 shrink-0 rounded border border-line bg-surface-elev px-1 text-[10px] text-ink-3 focus:border-brand disabled:cursor-not-allowed disabled:opacity-50"
                        aria-label={`Apply project to week of ${w.label}`}
                        title={
                          total === 0
                            ? 'Type hours into this week first, then tag them to a project'
                            : 'Apply this project to every hours-bearing day in the week'
                        }
                      >
                        <option value="__prompt" disabled>
                          Apply to week…
                        </option>
                        <option value="__free">Free (unallocated)</option>
                        {allocatableProjects.map((p) => (
                          <option key={p.id} value={p.code}>
                            {p.code}
                          </option>
                        ))}
                      </select>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2">
        {state.status === 'error' && (
          <span className="mr-auto text-xs text-status-red">
            {state.message}
          </span>
        )}
        {state.status === 'success' && (
          <span className="mr-auto text-xs text-status-green">
            Saved · {state.cellsWritten}{' '}
            {state.cellsWritten === 1 ? 'day' : 'days'}
            {state.cellsCleared > 0 && <> · cleared {state.cellsCleared}</>}.
            {state.droppedCodes.length > 0 && (
              <span className="ml-1 text-status-amber">
                {state.droppedCodes.join(', ')}{' '}
                {state.droppedCodes.length === 1 ? 'is' : 'are'} no longer
                active — those hours were saved as Free.
              </span>
            )}
          </span>
        )}
        {state.status === 'idle' && isDirty && (
          <span className="mr-auto text-xs text-ink-3">Unsaved changes</span>
        )}
        <Button type="button" size="sm" onClick={save} disabled={pending}>
          {pending ? 'Saving…' : 'Save availability'}
        </Button>
      </div>
    </div>
  );
}
