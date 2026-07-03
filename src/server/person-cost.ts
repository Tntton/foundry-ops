import type { Decimal } from '@prisma/client/runtime/library';

/**
 * The shape of the fields we need off Person to compute cost. Kept
 * structural (not a Prisma type) so callers can pass a subset from
 * any select clause.
 */
export type PersonCostBasis = {
  rate: number; // cents
  rateUnit: 'hour' | 'day';
  agencyMarkupPct: Decimal | number | string | null;
};

const HOURS_PER_DAY = 8;

/**
 * Fully-loaded cost per hour, in AUD cents, for this person. Applies
 * the agency markup if set (30.00 → +30%). Returns integer cents.
 *
 * Callers that historically read `person.rate` directly should switch
 * to this helper when they want the ECONOMICALLY correct firm cost
 * (i.e. what we actually pay out including agency margin). Direct
 * `person.rate` reads are still valid for "what does this person
 * take home" contexts.
 */
export function loadedCostPerHourCents(p: PersonCostBasis): number {
  const perHour = p.rateUnit === 'day' ? Math.round(p.rate / HOURS_PER_DAY) : p.rate;
  const markup = markupFactor(p.agencyMarkupPct);
  return Math.round(perHour * markup);
}

/**
 * Fully-loaded cost for `hours` worked, in AUD cents.
 */
export function loadedCostCents(p: PersonCostBasis, hours: number): number {
  return Math.round(loadedCostPerHourCents(p) * hours);
}

/**
 * Multiplier applied on top of the raw rate to arrive at fully-loaded
 * cost. 1.0 when no agency markup; 1 + pct/100 when present.
 */
export function markupFactor(pct: Decimal | number | string | null | undefined): number {
  if (pct === null || pct === undefined) return 1;
  const n = typeof pct === 'number' ? pct : Number(pct.toString());
  if (!Number.isFinite(n) || n <= 0) return 1;
  return 1 + n / 100;
}
