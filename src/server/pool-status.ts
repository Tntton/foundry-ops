import type { PoolStatus } from '@prisma/client';

/**
 * Effective pool engagement status surfaced as a colour pip on the pool
 * chip, directory roster, and profile page.
 *
 *   - `on_project`        — has ≥1 active project team allocation. Light
 *                           Foundry green.
 *   - `previous_project`  — no active allocation, but has past project
 *                           timesheet hours. Default neutral.
 *   - `never_on_project`  — no current allocation AND no historical
 *                           project hours. Light red.
 *   - `on_sabbatical`     — manual super_admin override (paused / leave).
 *                           Light grey.
 *
 * Computation flow: super_admin override wins; otherwise infer from the
 * project / timesheet activity flags handed in.
 */

export type PoolStatusInputs = {
  override: PoolStatus | null;
  hasActiveProject: boolean;
  hasAnyProjectHistory: boolean;
};

export function computePoolStatus(inputs: PoolStatusInputs): PoolStatus {
  if (inputs.override) return inputs.override;
  if (inputs.hasActiveProject) return 'on_project';
  if (inputs.hasAnyProjectHistory) return 'previous_project';
  return 'never_on_project';
}

/** Tailwind classes (ring + bg + text accent) for each status. Kept as
 *  a single map so client components and server templates render the
 *  same colour treatment. */
export const POOL_STATUS_STYLES: Record<
  PoolStatus,
  { bg: string; border: string; text: string; pip: string; label: string }
> = {
  on_project: {
    // Light Foundry green tint on the chip body, slightly stronger
    // green border so it pops without shouting.
    bg: 'bg-status-green-soft',
    border: 'border-status-green/50',
    text: 'text-ink',
    pip: 'bg-status-green',
    label: 'On project',
  },
  previous_project: {
    bg: 'bg-card',
    border: 'border-line',
    text: 'text-ink',
    pip: 'bg-ink-3',
    label: 'Previous project',
  },
  never_on_project: {
    bg: 'bg-status-red-soft',
    border: 'border-status-red/40',
    text: 'text-ink',
    pip: 'bg-status-red',
    label: 'Never on project',
  },
  on_sabbatical: {
    bg: 'bg-surface-subtle',
    border: 'border-line',
    text: 'text-ink-3',
    pip: 'bg-ink-4',
    label: 'On sabbatical',
  },
};

export const POOL_STATUS_OPTIONS: Array<{ value: PoolStatus; label: string }> = [
  { value: 'on_project', label: 'On project' },
  { value: 'previous_project', label: 'Previous project' },
  { value: 'never_on_project', label: 'Never on project' },
  { value: 'on_sabbatical', label: 'On sabbatical' },
];
