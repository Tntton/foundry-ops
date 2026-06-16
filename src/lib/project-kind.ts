/**
 * Project-kind discrimination, by code prefix.
 *
 * Four FH-internal prefixes, each with a `*000` catch-all where lines
 * initially land for later re-assignment to a more specific code in
 * the same family:
 *
 *   - `FHB` — Business Development. `FHB000` is the firm-level BD
 *     catch-all (proposals, conferences, pre-engagement meetings,
 *     marketing collateral). Specific BD initiatives can later get
 *     their own FHB001+ code and lines reassigned.
 *   - `FHO` — Operations / OPEX. `FHO000` is the catch-all
 *     (subscriptions, professional services, office costs).
 *   - `FHX` — Other / uncategorised. `FHX000` is the catch-all for
 *     anything that doesn't fit BD / Ops / a real project — the
 *     last-resort bucket, re-routed by admin when possible.
 *   - `FHP` — internal Foundry Health projects. `FHP000` is the
 *     catch-all for ad-hoc internal time; FHP001+ are real internal
 *     projects (primer development, social media, brand refreshes).
 *     Tracked like client projects (team, time, budget) but with no
 *     paying client → no P&L, no invoicing, no fixed window.
 *
 * Everything else = client engagements. Full revenue surface — P&L,
 * invoices, contract value, contract dates.
 *
 * The flags below let UI and server code make the same decision in one
 * place rather than open-coding the prefix check at every call site.
 *
 * Note: the three FHB/FHO/FHX `*000` codes are "expense buckets" —
 * hidden from project surfaces but pickable in the AP/expense allocator.
 * `FHP000` is treated as a real internal project (shows on the internal
 * kanban band alongside FHP001+).
 */

const BUCKET_CODES = new Set(['FHB000', 'FHO000', 'FHX000']);

export function isExpenseBucket(code: string): boolean {
  return BUCKET_CODES.has(code);
}

/**
 * Bucket codes that admin should NOT be able to allocate new lines to
 * via the AP / expense pickers.
 *
 * Empty by design (TT 2026-06-16): every `*000` catch-all (FHB000,
 * FHO000, FHX000 — and FHP000 for internal time) is a valid initial
 * landing spot. Lines get reassigned to a more specific code later if
 * a better fit emerges. No bucket is hidden at allocation time.
 *
 * Kept as a configurable surface in case the policy reverses again.
 */
const HIDDEN_PICKER_BUCKET_CODES: Set<string> = new Set();

export function isHiddenFromAllocationPicker(code: string): boolean {
  return HIDDEN_PICKER_BUCKET_CODES.has(code);
}

/**
 * True when the project belongs to the FHP internal series. Buckets
 * are NOT internal projects — they're a separate category (excluded
 * from project surfaces entirely).
 */
export function isInternalProject(code: string): boolean {
  return code.startsWith('FHP') && !isExpenseBucket(code);
}

export function isClientProject(code: string): boolean {
  return !isInternalProject(code) && !isExpenseBucket(code);
}

/**
 * Whether this project should ever surface a profit-and-loss view.
 * Internal projects have no client revenue, so P&L is meaningless —
 * they're tracked against an internal *budget* only.
 */
export function shouldShowPnL(code: string): boolean {
  return isClientProject(code);
}

/**
 * Whether this project carries a fixed start / end window. Client
 * engagements always do (kickoff date, theoretical end). Internal
 * projects often don't — primer work is standing, conference work is
 * episodic, brand refreshes happen in bursts. Settings / display logic
 * uses this to skip the "must set start + end before closing" reminder
 * for internal projects.
 */
export function hasFixedWindow(code: string): boolean {
  return isClientProject(code);
}
