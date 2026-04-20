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
  | 'IO';

export type LevelMeta = {
  code: LevelCode;
  label: string;
  band: 'MP' | 'Partner' | 'Expert' | 'Consultant' | 'Analyst';
};

export const FOUNDRY_LEVELS: readonly LevelMeta[] = [
  { code: 'L4', label: 'Partner', band: 'Partner' },
  { code: 'L3', label: 'Associate Partner', band: 'Partner' },
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
];
