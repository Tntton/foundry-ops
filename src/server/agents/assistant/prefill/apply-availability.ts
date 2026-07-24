import type { AvailabilityDayInput } from '@/app/(app)/availability/availability-editor';
import type { AvailabilityPrefillPayload } from './schemas';

/**
 * Merge an availability prefill payload into the editor's cell set.
 *
 * Pure function — given the cells the page already loaded for the
 * visible horizon + the payload, returns an enriched copy with the
 * prefilled hours set on matching dates, plus applied / ignored logs
 * for the banner.
 *
 * Behaviour (differs from timesheet on purpose):
 *  - Availability is a forecast, not an accumulating log, so a matching
 *    date's hours are OVERWRITTEN, not added. Re-issuing "4h Mon-Fri"
 *    shouldn't double a cell the user already had.
 *  - Entry whose date falls OUTSIDE the visible horizon → recorded in
 *    `ignored` so the banner can flag it (the editor only renders the
 *    8-week horizon it was handed).
 *  - The project allocation on each cell is left untouched — prefill
 *    only declares hours; the person tags projects (or leaves them
 *    Free) on the form as before.
 */
export type ApplyAvailabilityPrefillResult = {
  cells: AvailabilityDayInput[];
  applied: Array<{ dateIso: string; hours: number }>;
  ignored: Array<{ dateIso: string; reason: string }>;
};

export function applyAvailabilityPrefill(
  cells: readonly AvailabilityDayInput[],
  payload: AvailabilityPrefillPayload,
): ApplyAvailabilityPrefillResult {
  const byIso = new Map<string, number>();
  cells.forEach((c, i) => byIso.set(c.dateIso, i));

  const working: AvailabilityDayInput[] = cells.map((c) => ({ ...c }));
  const applied: ApplyAvailabilityPrefillResult['applied'] = [];
  const ignored: ApplyAvailabilityPrefillResult['ignored'] = [];
  // Last-write-wins if the model emits the same date twice.
  const seen = new Set<string>();

  for (const entry of payload.entries) {
    const idx = byIso.get(entry.dateIso);
    if (idx === undefined) {
      ignored.push({ dateIso: entry.dateIso, reason: 'outside_horizon' });
      continue;
    }
    working[idx]!.hours = entry.hours;
    if (!seen.has(entry.dateIso)) {
      applied.push({ dateIso: entry.dateIso, hours: entry.hours });
      seen.add(entry.dateIso);
    } else {
      const prior = applied.find((a) => a.dateIso === entry.dateIso);
      if (prior) prior.hours = entry.hours;
    }
  }
  return { cells: working, applied, ignored };
}
