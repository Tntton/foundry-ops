'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { AllocatableProject, AvailabilityDayInput } from './availability-editor';
import { rangeDateIsos, resolveBrush, type Brush } from './availability-brush';

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

type DragState =
  | { kind: 'none' }
  /** Painting a run of days — anchor and cursor are flat cell indices. */
  | { kind: 'paint'; anchor: number; cursor: number }
  /** Moving an existing day's block onto another day. */
  | { kind: 'move'; fromIndex: number; cursor: number };

/**
 * Calendar view of the availability forecast (per TT, 2026-10-23).
 *
 * Same `AvailabilityForecast` rows the grid writes — one per person per
 * day, hours plus an optional project — rendered as dated day cells
 * with a block on each committed day instead of a number in a box.
 *
 * Two gestures, disambiguated by where the pointer goes down:
 *   - empty part of a cell  → drag paints the brush across a run of days
 *   - an existing block     → drag moves that day's hours to another day
 *
 * The brush is explicit (hours + project, or Erase) and set before
 * painting, so a drag never has to guess what the person meant. The
 * Grid view keeps real number inputs, so this is an addition, not a
 * mouse-only replacement.
 */
export function AvailabilityCalendar({
  cells,
  weeks,
  hours,
  projectCodes,
  allocatableProjects,
  dailyCapacityPlaceholder,
  todayIso,
  weekNotes,
  onWeekNote,
  initialByDay,
  onPaint,
  onMove,
}: {
  /** weeks.length × 7, ordered week-major, day-minor. Dates only. */
  cells: AvailabilityDayInput[];
  weeks: Array<{ weekStartIso: string; label: string }>;
  hours: Record<string, string>;
  projectCodes: Record<string, string>;
  allocatableProjects: AllocatableProject[];
  dailyCapacityPlaceholder: number;
  todayIso: string;
  /** Per-week note, keyed by week-start ISO — same column the Grid
   *  view edits, so the calendar isn't a lossy view of the same data. */
  weekNotes: Record<string, string>;
  onWeekNote: (weekStartIso: string, raw: string) => void;
  /** Stored value and provenance per day, for the Outlook badge. */
  initialByDay: Record<string, { hours: number | null; source: 'human' | 'outlook' }>;
  /** Apply the resolved brush to every day in the run. */
  onPaint: (dateIsos: string[], brush: Brush) => void;
  /** Move a day's hours + project onto another day, clearing the source. */
  onMove: (fromIso: string, toIso: string) => void;
}) {
  const [brushHours, setBrushHours] = useState<string>(
    dailyCapacityPlaceholder > 0 ? String(dailyCapacityPlaceholder) : '8',
  );
  const [brushProject, setBrushProject] = useState<string>('');
  const [erasing, setErasing] = useState(false);
  const [drag, setDrag] = useState<DragState>({ kind: 'none' });
  // The reducer closes over `drag`, but pointerup fires on `window` —
  // keep a ref so the listener commits the live drag, not a stale one.
  const dragRef = useRef<DragState>(drag);
  dragRef.current = drag;

  const selection = useMemo(() => {
    if (drag.kind !== 'paint') return null;
    const lo = Math.min(drag.anchor, drag.cursor);
    const hi = Math.max(drag.anchor, drag.cursor);
    return { lo, hi };
  }, [drag]);

  // The window listener below is registered once per drag, so it closes
  // over the handlers from that render. Mirror them in refs so a commit
  // always calls the live ones — otherwise a parent re-render mid-drag
  // (the brush inputs do exactly that) leaves the commit writing against
  // a stale copy of the hours map.
  const onPaintRef = useRef(onPaint);
  onPaintRef.current = onPaint;
  const onMoveRef = useRef(onMove);
  onMoveRef.current = onMove;
  const brushRef = useRef<{ hours: string; project: string; erasing: boolean }>({
    hours: brushHours,
    project: brushProject,
    erasing,
  });
  brushRef.current = { hours: brushHours, project: brushProject, erasing };

  function commit() {
    const state = dragRef.current;
    if (state.kind === 'none') return;
    // Clear the ref synchronously. pointerup and pointercancel share a
    // handler, and React won't have re-rendered between them — without
    // this a second event replays the same gesture against the state
    // the first one just wrote, which on a move clears the source and
    // then writes that empty value onto the target.
    dragRef.current = { kind: 'none' };
    const b = brushRef.current;
    if (state.kind === 'paint') {
      onPaintRef.current(
        rangeDateIsos(cells, state.anchor, state.cursor),
        resolveBrush(b.hours, b.project, b.erasing),
      );
    } else {
      const from = cells[state.fromIndex];
      const to = cells[state.cursor];
      if (from && to && from.dateIso !== to.dateIso) {
        onMoveRef.current(from.dateIso, to.dateIso);
      }
    }
    setDrag({ kind: 'none' });
  }

  // Pointer can leave the table mid-drag; commit on window pointerup so
  // a release over the page chrome still lands the edit rather than
  // stranding the grid in a dragging state.
  useEffect(() => {
    if (drag.kind === 'none') return;
    function onUp() {
      commit();
    }
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag.kind, cells]);

  function startPaint(index: number) {
    setDrag({ kind: 'paint', anchor: index, cursor: index });
  }
  function startMove(index: number) {
    setDrag({ kind: 'move', fromIndex: index, cursor: index });
  }
  function extendTo(index: number) {
    setDrag((d) => {
      if (d.kind === 'paint') return { ...d, cursor: index };
      if (d.kind === 'move') return { ...d, cursor: index };
      return d;
    });
  }

  /** Keyboard equivalent of a one-day paint — the calendar is not a
   *  mouse-only surface even though the Grid view is the fuller
   *  keyboard path. */
  function applyToOneDay(index: number) {
    const c = cells[index];
    if (!c) return;
    onPaint([c.dateIso], resolveBrush(brushHours, brushProject, erasing));
  }

  function weekTotal(weekIndex: number): number {
    let total = 0;
    for (let d = 0; d < 7; d += 1) {
      const c = cells[weekIndex * 7 + d];
      if (!c) continue;
      const v = Number((hours[c.dateIso] ?? '').trim());
      if (Number.isFinite(v)) total += v;
    }
    return total;
  }

  const brushLabel = erasing
    ? 'Erase'
    : `${Number(brushHours) || 0}h · ${brushProject || 'Free'}`;

  if (cells.length === 0) {
    return (
      <div className="rounded-lg border border-line bg-card p-6 text-center text-xs text-ink-3">
        No days in the horizon to plan. Widen the window and try again.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Brush bar — what a drag will paint. */}
      <div className="flex flex-wrap items-center gap-2 rounded-md border border-line bg-surface-subtle px-2 py-1.5">
        <span className="text-[10px] font-medium uppercase tracking-wide text-ink-3">
          Brush
        </span>
        <input
          type="number"
          min={0}
          max={24}
          step={1}
          value={brushHours}
          disabled={erasing}
          onChange={(e) => setBrushHours(e.target.value)}
          className="h-7 w-14 rounded border border-line bg-surface-elev px-1 text-center text-xs tabular-nums text-ink focus:border-brand disabled:opacity-40"
          aria-label="Hours the brush paints"
        />
        <span className="text-[11px] text-ink-3">h on</span>
        <select
          value={brushProject}
          disabled={erasing}
          onChange={(e) => setBrushProject(e.target.value)}
          className="h-7 rounded border border-line bg-surface-elev px-1 text-[11px] text-ink-2 focus:border-brand disabled:opacity-40"
          aria-label="Project the brush paints"
        >
          <option value="">Free (unallocated)</option>
          {allocatableProjects.map((p) => (
            <option key={p.id} value={p.code}>
              {p.code} — {p.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => setErasing((v) => !v)}
          aria-pressed={erasing}
          className={`h-7 rounded border px-2 text-[11px] ${
            erasing
              ? 'border-status-red text-status-red'
              : 'border-line text-ink-3 hover:text-ink-2'
          } disabled:opacity-40`}
        >
          Erase
        </button>
        <p className="ml-auto text-[11px] text-ink-3">
          Drag across days to paint <span className="font-medium text-ink-2">{brushLabel}</span>.
          Drag a block onto another day to move it. Days marked{' '}
          <span className="rounded-sm bg-surface-subtle px-0.5 text-[8px] font-medium uppercase tracking-wide text-ink-3">
            cal
          </span>{' '}
          came from Outlook — paint over one to make it yours.
        </p>
      </div>

      <div
        className="overflow-x-auto select-none"
        // Stop the browser turning a horizontal drag into a text
        // selection or a scroll gesture mid-paint.
        style={{ touchAction: 'none' }}
      >
        <table className="w-full min-w-[820px] border-collapse">
          <thead>
            <tr>
              <th className="w-20 border-b border-line bg-surface-subtle px-2 py-2 text-left text-[10px] font-medium uppercase tracking-wide text-ink-3">
                Week
              </th>
              {DAY_LABELS.map((d, i) => (
                <th
                  key={d}
                  className={`border-b border-line px-1 py-2 text-center text-[10px] font-medium uppercase tracking-wide ${
                    i >= 5
                      ? 'bg-surface-subtle/50 text-ink-3/60'
                      : 'bg-surface-subtle text-ink-3'
                  }`}
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
              const total = weekTotal(weekIndex);
              return (
                <tr key={w.weekStartIso} className="border-b border-line last:border-b-0">
                  <td className="bg-surface-subtle/40 px-2 py-1 text-[11px] font-medium text-ink-2">
                    {w.label}
                  </td>
                  {DAY_LABELS.map((_, dayIndex) => {
                    const index = weekIndex * 7 + dayIndex;
                    const c = cells[index];
                    if (!c) return <td key={dayIndex} />;
                    const raw = (hours[c.dateIso] ?? '').trim();
                    const h = raw === '' ? 0 : Number(raw) || 0;
                    const code = projectCodes[c.dateIso] ?? '';
                    const isToday = c.dateIso === todayIso;
                    const isWeekend = dayIndex >= 5;
                    const inSelection =
                      selection !== null && index >= selection.lo && index <= selection.hi;
                    const isMoveTarget = drag.kind === 'move' && drag.cursor === index;
                    const isMoveSource = drag.kind === 'move' && drag.fromIndex === index;
                    const dayNum = Number(c.dateIso.slice(8, 10));
                    // Synced only while the cell still holds what the
                    // sync wrote. Painting over it makes it the
                    // person's own, badge gone, before they even save.
                    const stored = initialByDay[c.dateIso];
                    const fromOutlook =
                      stored?.source === 'outlook' &&
                      raw === (stored.hours === null ? '' : String(stored.hours));
                    return (
                      <td
                        key={c.dateIso}
                        onPointerDown={(e) => {
                          // Left button only — a right-click should open
                          // the context menu, not start a paint.
                          if (e.button !== 0) return;
                          e.preventDefault();
                          startPaint(index);
                        }}
                        onPointerEnter={() => {
                          if (drag.kind !== 'none') extendTo(index);
                        }}
                        className={`h-[58px] cursor-cell border-l border-line/60 p-1 align-top first:border-l-0 ${
                          isWeekend ? 'bg-surface-subtle/30' : ''
                        } ${inSelection ? 'bg-brand-soft/60' : ''} ${
                          isMoveTarget ? 'ring-1 ring-inset ring-brand' : ''
                        } ${isMoveSource ? 'opacity-50' : ''} ${
                          isToday && !inSelection ? 'bg-brand-soft/25' : ''
                        }`}
                      >
                        <div
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              applyToOneDay(index);
                            }
                          }}
                          aria-label={`${c.dateIso}${h > 0 ? `, ${h} hours${code ? ` on ${code}` : ', unallocated'}` : ', no hours'}`}
                          className="flex h-full w-full flex-col gap-0.5 rounded outline-none focus-visible:ring-1 focus-visible:ring-brand"
                        >
                          <span className="flex items-baseline justify-between gap-1">
                            <span
                              className={`text-[10px] tabular-nums ${
                                isToday ? 'font-semibold text-brand' : 'text-ink-3'
                              }`}
                            >
                              {dayNum}
                            </span>
                            {fromOutlook && (
                              <span
                                className="rounded-sm bg-surface-subtle px-0.5 text-[8px] font-medium uppercase tracking-wide text-ink-3"
                                title="From Outlook — an all-day or out-of-office event. Paint over it to make it yours."
                              >
                                cal
                              </span>
                            )}
                          </span>
                          {h > 0 ? (
                            <div
                              onPointerDown={(e) => {
                                if (e.button !== 0) return;
                                // Grabbing the block means "move this
                                // day", not "start painting here".
                                e.preventDefault();
                                e.stopPropagation();
                                startMove(index);
                              }}
                              title={`${h}h ${code ? `on ${code}` : 'free'} — drag to another day to move`}
                              className={`flex-1 cursor-grab rounded px-1 py-0.5 text-left text-[10px] leading-tight ${
                                code
                                  ? 'bg-brand/15 text-brand'
                                  : 'bg-status-green/15 text-status-green'
                              }`}
                            >
                              <span className="block font-semibold tabular-nums">{h}h</span>
                              <span className="block truncate">{code || 'Free'}</span>
                            </div>
                          ) : (
                            <span className="flex-1" />
                          )}
                        </div>
                      </td>
                    );
                  })}
                  <td className="px-2 py-1 text-right text-xs font-semibold tabular-nums text-ink">
                    {total === 0 ? <span className="text-ink-3">—</span> : `${total}h`}
                  </td>
                  <td className="px-2 py-1">
                    <input
                      type="text"
                      maxLength={200}
                      placeholder="OOO Wed AM, client onsite, conference…"
                      value={weekNotes[w.weekStartIso] ?? ''}
                      onChange={(e) => onWeekNote(w.weekStartIso, e.target.value)}
                      // The row is a paint surface; typing in the note
                      // must not start a drag behind the cursor.
                      onPointerDown={(e) => e.stopPropagation()}
                      className="h-7 w-full min-w-[140px] rounded border border-line bg-surface-elev px-1.5 text-[11px] text-ink-2 focus:border-brand"
                      aria-label={`Note for week of ${w.label}`}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
