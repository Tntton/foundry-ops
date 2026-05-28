'use client';

import { useState, useTransition } from 'react';
import {
  submitAvailabilityForecast,
  type AvailabilityFormState,
} from './availability-action';
import { Button } from '@/components/ui/button';

export type AvailabilityDayInput = {
  dateIso: string; // YYYY-MM-DD
  hours: number | null;
  notes: string | null;
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
}: {
  personId: string;
  /** One entry per week (default 8). Used for the row labels. */
  weeks: Array<{ weekStartIso: string; label: string }>;
  targetFirstName: string;
  /** FTE × 38 / 5 = baseline daily capacity (used as the placeholder). */
  weeklyCapacityHours: number;
  /** weeks.length × 7 cells, ordered week-major, day-minor. */
  initialCells: AvailabilityDayInput[];
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
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<AvailabilityFormState>({ status: 'idle' });

  const dailyCapacityPlaceholder =
    weeklyCapacityHours > 0 ? Math.round(weeklyCapacityHours / 5) : 0;

  function setHourCell(dateIso: string, raw: string) {
    setHours((prev) => ({ ...prev, [dateIso]: raw }));
  }
  function setWeekNote(weekStartIso: string, raw: string) {
    setWeekNotes((prev) => ({ ...prev, [weekStartIso]: raw }));
  }

  /**
   * Distribute `total` integer hours across Mon-Fri as evenly as possible,
   * pushing remainder onto the later weekdays so the cells add back up
   * exactly. Sat/Sun stay at 0. Used when the staff member just types a
   * weekly total instead of doing day-by-day allocation.
   */
  function fanOutWeek(weekIndex: number, raw: string) {
    const rowCells = initialCells.slice(weekIndex * 7, weekIndex * 7 + 7);
    setHours((prev) => {
      const next = { ...prev };
      const trimmed = raw.trim();
      if (trimmed === '') {
        // Empty total → blank all 7 day cells.
        for (const c of rowCells) next[c.dateIso] = '';
        return next;
      }
      const parsed = Number(trimmed);
      if (!Number.isFinite(parsed)) return prev;
      // Cap at 24h × 5 weekdays so we don't blow past per-day max.
      const total = Math.max(0, Math.min(24 * 5, Math.round(parsed)));
      const base = Math.floor(total / 5);
      const remainder = total % 5;
      // [Mon, Tue, Wed, Thu, Fri, Sat, Sun]
      const days = [base, base, base, base, base, 0, 0];
      // Push remainder onto the later weekdays (Fri, Thu, Wed, …).
      for (let i = 0; i < remainder; i += 1) days[4 - i]! += 1;
      for (let d = 0; d < 7; d += 1) {
        const c = rowCells[d];
        if (!c) continue;
        next[c.dateIso] = String(days[d]);
      }
      return next;
    });
  }

  function applyWeekdayDefault() {
    // Quick-fill: 1/5 of weekly capacity into Mon–Fri, 0 into Sat/Sun,
    // ONLY for cells that are currently blank. Doesn't overwrite manual
    // entries.
    if (dailyCapacityPlaceholder === 0) return;
    setHours((prev) => {
      const next = { ...prev };
      for (const c of initialCells) {
        const d = new Date(`${c.dateIso}T00:00:00.000Z`);
        const dow = d.getUTCDay(); // 0 = Sun, 6 = Sat
        const isWeekend = dow === 0 || dow === 6;
        if ((next[c.dateIso] ?? '').trim() === '') {
          next[c.dateIso] = isWeekend ? '0' : String(dailyCapacityPlaceholder);
        }
      }
      return next;
    });
  }

  function clearAll() {
    const blankH: Record<string, string> = {};
    for (const c of initialCells) blankH[c.dateIso] = '';
    setHours(blankH);
    const blankN: Record<string, string> = {};
    for (const w of weeks) blankN[w.weekStartIso] = '';
    setWeekNotes(blankN);
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
    setState({ status: 'idle' });
  }

  function save() {
    setState({ status: 'idle' });
    const cells = initialCells.map((c, idx) => {
      const rawH = (hours[c.dateIso] ?? '').trim();
      const h =
        rawH === ''
          ? null
          : Math.max(0, Math.min(24, Number(rawH) || 0));
      // Week note rides on Monday only; Tue–Sun get notes=null so any
      // legacy per-day notes get wiped on save.
      const isMonday = idx % 7 === 0;
      const weekIndex = Math.floor(idx / 7);
      const wIso = weeks[weekIndex]?.weekStartIso;
      const note =
        isMonday && wIso ? (weekNotes[wIso] ?? '').trim() : '';
      return {
        dateIso: c.dateIso,
        hours: h,
        notes: note === '' ? null : note,
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

  // Highlight today's cell to anchor the grid visually.
  const todayIso = new Date().toISOString().slice(0, 10);

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
            Hours you expect to work each day — or just type a weekly
            total in the right-hand column and we&apos;ll fan it out
            across Mon-Fri (you can still tweak individual days after).
            One short note per week for context — OOO half-day, client
            onsite, conference, school run, etc. Drives the firm-wide
            bandwidth heatmap.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {dailyCapacityPlaceholder > 0 && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={applyWeekdayDefault}
            >
              Fill weekdays ({dailyCapacityPlaceholder}h)
            </Button>
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
                    return (
                      <td
                        key={c.dateIso}
                        className={`px-1 py-1.5 align-middle text-center ${
                          isToday ? 'bg-brand-soft/40' : ''
                        }`}
                      >
                        <input
                          type="number"
                          min={0}
                          max={24}
                          step={0.5}
                          placeholder={String(dailyCapacityPlaceholder)}
                          value={hours[c.dateIso] ?? ''}
                          onChange={(e) =>
                            setHourCell(c.dateIso, e.target.value)
                          }
                          className="h-7 w-14 rounded border border-line bg-surface-elev px-1 text-center text-xs tabular-nums text-ink focus:border-brand"
                          aria-label={`Hours for ${c.dateIso}`}
                        />
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
                    <input
                      type="text"
                      maxLength={200}
                      placeholder="OOO Wed AM, client onsite, conference…"
                      value={weekNotes[w.weekStartIso] ?? ''}
                      onChange={(e) =>
                        setWeekNote(w.weekStartIso, e.target.value)
                      }
                      className="h-7 w-full rounded border border-line bg-surface-elev px-1.5 text-[11px] text-ink-2 focus:border-brand"
                      aria-label={`Note for week of ${w.label}`}
                    />
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
            {state.cellsWritten === 1 ? 'day' : 'days'}.
          </span>
        )}
        <Button type="button" size="sm" onClick={save} disabled={pending}>
          {pending ? 'Saving…' : 'Save availability'}
        </Button>
      </div>
    </div>
  );
}
