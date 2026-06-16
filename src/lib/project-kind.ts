/**
 * Project-kind discrimination, by code prefix.
 *
 * The codebase splits projects into three behavioural groups, all keyed
 * off the human-readable code:
 *
 *   - `FHO000` / `FHX000`: the firm-overhead expense buckets
 *     (FHO = Operations / OPEX, FHX = BD + Other). Filtered out of every
 *     project surface in `listProjects` — they exist as Project rows so
 *     expenses can be tagged against them, but they're not "projects" in
 *     the working sense.
 *   - `FHP` (FHP000, FHP001, FHP002, …): real internal Foundry Health
 *     projects, including the FHP000 catch-all. Tracked like client
 *     projects (team, time, expenses, budget) but with no paying client
 *     → no P&L, no invoicing, no fixed start/end window. Some are standing
 *     (primer development, social media), some are episodic (conferences,
 *     brand refreshes).
 *   - everything else: client engagements. Full revenue surface — P&L,
 *     invoices, contract value, contract dates.
 *
 * The flags below let UI and server code make the same decision in one
 * place rather than open-coding the prefix check at every call site.
 */

const BUCKET_CODES = new Set(['FHO000', 'FHX000']);

export function isExpenseBucket(code: string): boolean {
  return BUCKET_CODES.has(code);
}

/**
 * Bucket codes that admin should NOT be able to allocate new lines
 * to via the AP / expense pickers. FHO000 (Operations) exists in the
 * schema so historical lines stay tagged, but TT's call (2026-05-11) is
 * that ongoing allocation funnels everything into **FHX000 (BD / Other)**
 * as the single OPEX target. FHO is derived from the category at
 * month-end-reporting time, not at allocation time, so admin shouldn't
 * pick it at the gate.
 *
 * Pickers still surface the current value as a pinned "(current)"
 * option when a row is already tagged to FHO000 — admin can see what's
 * there and re-route, they just can't *select* it fresh.
 */
const HIDDEN_PICKER_BUCKET_CODES = new Set(['FHO000']);

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
