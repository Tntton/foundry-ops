import { z } from 'zod';
import { prisma } from '@/server/db';
import { writeAudit } from '@/server/audit';
import type { LeaderPendingAction } from '@/server/leader-actions';

/**
 * Per-person dashboard preferences for the leader action strip: which
 * action groups are hidden or snoozed. Stored inside the existing
 * `UserPreference.prefs` JSON (key `dashboardActionGroups`) so this needs
 * no schema migration.
 *
 * A leader can, per group, either:
 *   - hide it permanently (until they switch it back on), or
 *   - snooze it for N days (auto-resurfaces once `until` passes).
 * A group with no stored state is visible.
 *
 * The grouping/suppression/merge logic is pure (unit-tested); the prisma
 * read/write wrappers are thin.
 */

type LeaderKind = LeaderPendingAction['kind'];

export const ACTION_GROUPS = [
  {
    key: 'approvals',
    label: 'Approvals',
    kinds: [
      'bill_approval_queue',
      'expense_approval_queue',
      'invoice_approval_queue',
      'timesheet_approval_queue',
    ],
  },
  {
    key: 'delivery',
    label: 'Delivery',
    kinds: ['project_stale', 'project_missing_milestones'],
  },
  {
    key: 'business_dev',
    label: 'Business Dev',
    kinds: ['deal_stale'],
  },
  {
    key: 'billing',
    label: 'Billing',
    kinds: ['invoice_to_draft'],
  },
  {
    key: 'personal',
    label: 'Personal',
    kinds: [
      'self_timesheet_overdue',
      'self_timesheet_empty_midweek',
      'self_expense_draft',
      'self_expense_rejected',
    ],
  },
] as const satisfies ReadonlyArray<{
  key: string;
  label: string;
  kinds: ReadonlyArray<LeaderKind>;
}>;

export type ActionGroupKey = (typeof ACTION_GROUPS)[number]['key'];

export const ACTION_GROUP_KEYS = ACTION_GROUPS.map((g) => g.key) as [
  ActionGroupKey,
  ...ActionGroupKey[],
];

// kind → group. Built from ACTION_GROUPS so it can't drift. The
// `Record<LeaderKind, …>` annotation makes the compiler flag any kind
// that isn't assigned to exactly one group.
export const KIND_TO_GROUP: Record<LeaderKind, ActionGroupKey> =
  ACTION_GROUPS.reduce(
    (acc, g) => {
      for (const k of g.kinds) acc[k] = g.key;
      return acc;
    },
    {} as Record<LeaderKind, ActionGroupKey>,
  );

export type GroupPrefState =
  | { mode: 'hidden' }
  | { mode: 'snoozed'; until: string }; // ISO timestamp

export type DashboardActionPrefs = Partial<Record<ActionGroupKey, GroupPrefState>>;

const GroupPrefStateSchema: z.ZodType<GroupPrefState> = z.union([
  z.object({ mode: z.literal('hidden') }),
  z.object({ mode: z.literal('snoozed'), until: z.string().datetime() }),
]);

const PrefsSchema = z
  .record(z.enum(ACTION_GROUP_KEYS), GroupPrefStateSchema)
  .default({});

/**
 * Safely extract the action-group prefs out of a `UserPreference.prefs`
 * JSON blob. Anything malformed is dropped (treated as visible) rather
 * than throwing — a corrupt pref should never break the dashboard.
 */
export function parseActionGroupPrefs(raw: unknown): DashboardActionPrefs {
  if (raw == null || typeof raw !== 'object') return {};
  const sub = (raw as Record<string, unknown>)['dashboardActionGroups'];
  const parsed = PrefsSchema.safeParse(sub ?? {});
  return parsed.success ? parsed.data : {};
}

/** True when the group is currently suppressed (hidden, or snoozed and
 *  the snooze hasn't elapsed). */
export function isGroupSuppressed(
  state: GroupPrefState | undefined,
  now: Date,
): boolean {
  if (!state) return false;
  if (state.mode === 'hidden') return true;
  return new Date(state.until).getTime() > now.getTime();
}

export type GroupOp =
  | { op: 'hide' }
  | { op: 'snooze'; days: number }
  | { op: 'clear' };

/** Merge a single group operation into an existing prefs object (pure). */
export function applyGroupOp(
  prefs: DashboardActionPrefs,
  key: ActionGroupKey,
  action: GroupOp,
  now: Date,
): DashboardActionPrefs {
  const next: DashboardActionPrefs = { ...prefs };
  if (action.op === 'clear') {
    delete next[key];
  } else if (action.op === 'hide') {
    next[key] = { mode: 'hidden' };
  } else {
    const until = new Date(now.getTime() + action.days * 24 * 3600 * 1000);
    next[key] = { mode: 'snoozed', until: until.toISOString() };
  }
  return next;
}

export type VisibleGroup = {
  key: ActionGroupKey;
  label: string;
  actions: LeaderPendingAction[];
};

export type SuppressedGroup = {
  key: ActionGroupKey;
  label: string;
  state: GroupPrefState;
  /** Whole days remaining on a snooze (null for a permanent hide). */
  snoozeDaysLeft: number | null;
};

/**
 * Split the flat action list into visible columns (in ACTION_GROUPS
 * order, only groups that actually have actions) and the set of
 * currently-suppressed groups (so the UI can offer "Show"). Pure.
 */
export function groupActions(
  actions: LeaderPendingAction[],
  prefs: DashboardActionPrefs,
  now: Date,
): { visible: VisibleGroup[]; suppressed: SuppressedGroup[] } {
  const byGroup = new Map<ActionGroupKey, LeaderPendingAction[]>();
  for (const a of actions) {
    const g = KIND_TO_GROUP[a.kind];
    const list = byGroup.get(g) ?? [];
    list.push(a);
    byGroup.set(g, list);
  }

  const visible: VisibleGroup[] = [];
  const suppressed: SuppressedGroup[] = [];
  for (const g of ACTION_GROUPS) {
    const state = prefs[g.key];
    if (isGroupSuppressed(state, now) && state) {
      const snoozeDaysLeft =
        state.mode === 'snoozed'
          ? Math.max(
              0,
              Math.ceil(
                (new Date(state.until).getTime() - now.getTime()) /
                  (24 * 3600 * 1000),
              ),
            )
          : null;
      suppressed.push({ key: g.key, label: g.label, state, snoozeDaysLeft });
      continue;
    }
    const groupActionsList = byGroup.get(g.key);
    if (groupActionsList && groupActionsList.length > 0) {
      visible.push({ key: g.key, label: g.label, actions: groupActionsList });
    }
  }
  return { visible, suppressed };
}

/** Count of actions that are NOT in a suppressed group — powers the
 *  "N things to clear" headline. Pure. */
export function countVisibleActions(
  actions: LeaderPendingAction[],
  prefs: DashboardActionPrefs,
  now: Date,
): number {
  return actions.filter((a) => !isGroupSuppressed(prefs[KIND_TO_GROUP[a.kind]], now))
    .length;
}

// ─── DB wrappers ──────────────────────────────────────────────────────

export async function getDashboardActionPrefs(
  personId: string,
): Promise<DashboardActionPrefs> {
  const row = await prisma.userPreference.findUnique({ where: { personId } });
  return parseActionGroupPrefs(row?.prefs);
}

/**
 * Apply one group operation for a person and persist it. Reads the full
 * prefs blob, merges only the `dashboardActionGroups` sub-key (leaving
 * any other preference untouched), upserts, and writes an audit event in
 * the same transaction (A9).
 */
export async function setDashboardActionGroupPref(
  personId: string,
  key: ActionGroupKey,
  action: GroupOp,
  now: Date = new Date(),
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const existing = await tx.userPreference.findUnique({ where: { personId } });
    const currentBlob =
      existing?.prefs && typeof existing.prefs === 'object'
        ? (existing.prefs as Record<string, unknown>)
        : {};
    const before = parseActionGroupPrefs(currentBlob);
    const after = applyGroupOp(before, key, action, now);
    const nextBlob = { ...currentBlob, dashboardActionGroups: after };

    await tx.userPreference.upsert({
      where: { personId },
      create: { personId, prefs: nextBlob },
      update: { prefs: nextBlob },
    });

    await writeAudit(tx, {
      actor: { type: 'person', id: personId },
      action: 'updated',
      entity: {
        type: 'dashboard_pref',
        id: personId,
        before: { [key]: before[key] ?? null },
        after: { [key]: after[key] ?? null },
      },
      source: 'web',
    });
  });
}
