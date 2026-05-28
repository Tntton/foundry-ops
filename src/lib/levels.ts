/**
 * Foundry's level codes — stable list used across the Directory wizard, person
 * edit, and rate card pages. Display order follows the prototype rate card
 * (Leadership → Expert → Fellow → Consultant → Analyst → Intern).
 *
 * The band here maps to the schema's Band enum (MP / Partner / Expert /
 * Consultant / Analyst) — multiple level codes can share a band.
 */
export type LevelCode =
  | 'L4'
  | 'L3'
  | 'L2'
  | 'L1'
  | 'E2'
  | 'E1'
  | 'F2'
  | 'F1'
  | 'T3'
  | 'T2'
  | 'T1'
  | 'A3'
  | 'A2'
  | 'A1'
  | 'IO'
  | 'OM';

export type LevelMeta = {
  code: LevelCode;
  label: string;
  band: 'MP' | 'Partner' | 'Associate_Partner' | 'Expert' | 'Consultant' | 'Analyst' | 'Support_Staff';
};

export const FOUNDRY_LEVELS: readonly LevelMeta[] = [
  { code: 'L4', label: 'Partner', band: 'Partner' },
  // L3 = Associate Partner / Director. Now lives under its own band
  // (`Associate_Partner`) rather than nested under `Partner` so the
  // distinct rem + authority tier is captured at the band level —
  // the new `associate_partner` Role enum is the canonical authority
  // signal, this band is the matching display/pay tier label.
  { code: 'L3', label: 'Associate Partner', band: 'Associate_Partner' },
  { code: 'L2', label: 'Project Director / Senior Manager', band: 'Consultant' },
  { code: 'L1', label: 'Project Manager / Manager', band: 'Consultant' },
  { code: 'E2', label: 'Senior Expert', band: 'Expert' },
  { code: 'E1', label: 'Expert', band: 'Expert' },
  { code: 'F2', label: 'Fellow', band: 'Consultant' },
  { code: 'F1', label: 'Junior Fellow', band: 'Consultant' },
  { code: 'T3', label: 'Senior Consultant', band: 'Consultant' },
  { code: 'T2', label: 'Consultant', band: 'Consultant' },
  { code: 'T1', label: 'Consultant (junior)', band: 'Consultant' },
  { code: 'A3', label: 'Senior Analyst', band: 'Analyst' },
  { code: 'A2', label: 'Analyst', band: 'Analyst' },
  { code: 'A1', label: 'Junior Analyst', band: 'Analyst' },
  { code: 'IO', label: 'Intern', band: 'Analyst' },
  // Support staff — non-delivery firm roles. Office Manager is the
  // canonical example (Jas Navarro). Off the consulting pyramid:
  // hours don't roll into utilisation, billable capacity is zero.
  { code: 'OM', label: 'Office Manager', band: 'Support_Staff' },
];

/**
 * Display label for a level code. Falls back to the raw code when the
 * level isn't in the canonical list (defensive — schema doesn't
 * constrain `Person.level` to an enum).
 */
export function labelForLevel(code: string): string {
  const meta = FOUNDRY_LEVELS.find((l) => l.code === code);
  return meta?.label ?? code;
}

/**
 * "Is this person in the leadership tier" — the band-level union
 * used by:
 *   - The new-project + project-settings primary-partner pickers
 *     (only leadership-band people can be primaryPartnerId).
 *   - Resource planning's leadership cohort split.
 *   - Availability defaults (leadership opts out of the
 *     pyramid-tracked FTE forecast).
 *
 * Includes `Associate_Partner` so APs are correctly grouped with
 * partners + MPs for leadership-tier behaviour. The capability map
 * (`partner.scorecard.view`) is what keeps APs out of partner-
 * specific surfaces; this band predicate is the broader "in
 * leadership" check.
 */
export function isLeadershipBand(
  band: string | null | undefined,
): boolean {
  return band === 'MP' || band === 'Partner' || band === 'Associate_Partner';
}
