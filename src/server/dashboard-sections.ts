import { z } from 'zod';
import { prisma } from '@/server/db';
import { writeAudit } from '@/server/audit';

/**
 * Per-person customisable layout for the leader dashboard. Each content
 * block is a "section" with a stable key. A leader can, per section:
 *   - move it up / down within its column,
 *   - move it between the two columns (wide `main` ↔ narrow `aside`),
 *   - collapse it (fold the body away, keep the header), or
 *   - hide it entirely (drops to a "Hidden" tray, one click to restore).
 *
 * State lives inside the existing `UserPreference.prefs` JSON under the
 * key `dashboardLayout` (the model comment already reserves it), so this
 * needs no schema migration. The layout is a *total* order over every
 * known section — main + aside partition the full registry — plus a
 * `hidden` and a `collapsed` overlay set. Storing the full registry (not
 * just the sections a given viewer can see) keeps the op logic pure and
 * availability-independent; the render step filters to what's actually
 * on screen for this person.
 *
 * The grouping / ordering / merge logic here is pure and unit-tested; the
 * prisma read/write wrappers at the bottom are thin.
 */

// ─── Registry ─────────────────────────────────────────────────────────
//
// Canonical order = the default top-to-bottom layout. `defaultColumn`
// decides which column a section lands in before the user rearranges.
// A section not present in a viewer's stored layout is appended at its
// default position, so adding a new section here is forward-compatible.

export const DASHBOARD_SECTIONS = [
  { key: 'action_strip', label: 'Actions to clear', defaultColumn: 'main' },
  { key: 'latest_updates', label: 'Latest updates', defaultColumn: 'main' },
  { key: 'feedback_pipeline', label: 'Feedback pipeline', defaultColumn: 'main' },
  { key: 'top_stats', label: 'Top stats', defaultColumn: 'main' },
  { key: 'invoice_suggestions', label: 'Invoices to draft', defaultColumn: 'main' },
  { key: 'operational_qc', label: 'Operational QC', defaultColumn: 'main' },
  { key: 'bd_pipeline', label: 'BD pipeline', defaultColumn: 'main' },
  { key: 'expense_report', label: 'Firm overhead expenses', defaultColumn: 'main' },
  { key: 'budget_watch', label: 'Budget watch', defaultColumn: 'main' },
  { key: 'team_week', label: 'Team this week', defaultColumn: 'main' },
  { key: 'firm_overview', label: 'Firm overview', defaultColumn: 'aside' },
  { key: 'this_week', label: 'This week', defaultColumn: 'aside' },
  { key: 'alerts', label: 'Alerts', defaultColumn: 'aside' },
] as const satisfies ReadonlyArray<{
  key: string;
  label: string;
  defaultColumn: DashboardColumn;
}>;

export type DashboardColumn = 'main' | 'aside';
export type DashboardSectionKey = (typeof DASHBOARD_SECTIONS)[number]['key'];

export const DASHBOARD_SECTION_KEYS = DASHBOARD_SECTIONS.map((s) => s.key) as [
  DashboardSectionKey,
  ...DashboardSectionKey[],
];

const KEY_SET = new Set<string>(DASHBOARD_SECTION_KEYS);

export const SECTION_LABEL: Record<DashboardSectionKey, string> =
  DASHBOARD_SECTIONS.reduce(
    (acc, s) => {
      acc[s.key] = s.label;
      return acc;
    },
    {} as Record<DashboardSectionKey, string>,
  );

function isSectionKey(v: unknown): v is DashboardSectionKey {
  return typeof v === 'string' && KEY_SET.has(v);
}

// ─── Layout state ─────────────────────────────────────────────────────

export type DashboardLayout = {
  /** Section keys in the wide main column, top-to-bottom. */
  main: DashboardSectionKey[];
  /** Section keys in the narrow aside column, top-to-bottom. */
  aside: DashboardSectionKey[];
  /** Sections folded to header-only. */
  collapsed: DashboardSectionKey[];
  /** Sections removed from view (restorable from the tray). */
  hidden: DashboardSectionKey[];
};

/** The out-of-the-box layout, derived from the registry defaults. */
export function defaultLayout(): DashboardLayout {
  const main: DashboardSectionKey[] = [];
  const aside: DashboardSectionKey[] = [];
  for (const s of DASHBOARD_SECTIONS) {
    (s.defaultColumn === 'aside' ? aside : main).push(s.key);
  }
  return { main, aside, collapsed: [], hidden: [] };
}

/**
 * Coerce an arbitrary stored blob into a well-formed layout: keep only
 * known keys, drop duplicates (main wins over aside on a collision), and
 * append any known-but-unplaced sections at their default position so a
 * newly-added section always shows up. Never throws — a corrupt pref
 * degrades to the default rather than breaking the dashboard.
 */
export function normalizeLayout(raw: unknown): DashboardLayout {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const readList = (v: unknown): DashboardSectionKey[] => {
    if (!Array.isArray(v)) return [];
    const out: DashboardSectionKey[] = [];
    const seen = new Set<string>();
    for (const item of v) {
      if (isSectionKey(item) && !seen.has(item)) {
        seen.add(item);
        out.push(item);
      }
    }
    return out;
  };

  const rawMain = readList(obj.main);
  const placed = new Set<DashboardSectionKey>(rawMain);
  // aside excludes anything already claimed by main.
  const rawAside = readList(obj.aside).filter((k) => !placed.has(k));
  for (const k of rawAside) placed.add(k);

  const main = [...rawMain];
  const aside = [...rawAside];
  // Append any section missing from both columns at its default slot.
  for (const s of DASHBOARD_SECTIONS) {
    if (placed.has(s.key)) continue;
    (s.defaultColumn === 'aside' ? aside : main).push(s.key);
    placed.add(s.key);
  }

  return {
    main,
    aside,
    collapsed: readList(obj.collapsed),
    hidden: readList(obj.hidden),
  };
}

/** Pull the layout out of a `UserPreference.prefs` blob (key `dashboardLayout`). */
export function parseDashboardLayout(prefsBlob: unknown): DashboardLayout {
  if (prefsBlob == null || typeof prefsBlob !== 'object') return defaultLayout();
  return normalizeLayout((prefsBlob as Record<string, unknown>).dashboardLayout);
}

export type LayoutOp =
  | { op: 'move_up'; key: DashboardSectionKey }
  | { op: 'move_down'; key: DashboardSectionKey }
  | { op: 'move_column'; key: DashboardSectionKey }
  | { op: 'collapse'; key: DashboardSectionKey }
  | { op: 'expand'; key: DashboardSectionKey }
  | { op: 'hide'; key: DashboardSectionKey }
  | { op: 'show'; key: DashboardSectionKey }
  | { op: 'reset' };

function withToggled(
  set: DashboardSectionKey[],
  key: DashboardSectionKey,
  on: boolean,
): DashboardSectionKey[] {
  const has = set.includes(key);
  if (on && !has) return [...set, key];
  if (!on && has) return set.filter((k) => k !== key);
  return set;
}

/** Apply a single layout operation, returning a new layout (pure). */
export function applyLayoutOp(layout: DashboardLayout, action: LayoutOp): DashboardLayout {
  if (action.op === 'reset') return defaultLayout();

  const base = normalizeLayout(layout);
  const { key } = action;

  switch (action.op) {
    case 'collapse':
      return { ...base, collapsed: withToggled(base.collapsed, key, true) };
    case 'expand':
      return { ...base, collapsed: withToggled(base.collapsed, key, false) };
    case 'hide':
      return { ...base, hidden: withToggled(base.hidden, key, true) };
    case 'show':
      return { ...base, hidden: withToggled(base.hidden, key, false) };
    case 'move_up':
    case 'move_down': {
      const col: DashboardColumn = base.main.includes(key) ? 'main' : 'aside';
      const list = [...base[col]];
      const i = list.indexOf(key);
      if (i === -1) return base;
      const j = action.op === 'move_up' ? i - 1 : i + 1;
      if (j < 0 || j >= list.length) return base; // already at the boundary
      const here = list[i];
      const there = list[j];
      if (here === undefined || there === undefined) return base;
      list[i] = there;
      list[j] = here;
      return { ...base, [col]: list };
    }
    case 'move_column': {
      if (base.main.includes(key)) {
        return {
          ...base,
          main: base.main.filter((k) => k !== key),
          aside: [...base.aside, key],
        };
      }
      return {
        ...base,
        aside: base.aside.filter((k) => k !== key),
        main: [...base.main, key],
      };
    }
    default:
      return base;
  }
}

export type ResolvedLayout = {
  main: DashboardSectionKey[];
  aside: DashboardSectionKey[];
  /** Available sections the user has hidden — for the restore tray. */
  hidden: DashboardSectionKey[];
  collapsed: Set<DashboardSectionKey>;
  /** True when the layout differs from the factory default (drives the
   *  "Reset layout" affordance). */
  isCustomised: boolean;
};

/**
 * Project a stored layout onto what a given viewer can actually see.
 * `available` is the set of sections that have content for this person
 * (role + data gated). Hidden sections are pulled out of their column
 * into the tray; unavailable sections vanish entirely. Pure.
 */
export function resolveDashboardLayout(
  layout: DashboardLayout,
  available: ReadonlySet<DashboardSectionKey>,
): ResolvedLayout {
  const norm = normalizeLayout(layout);
  const hiddenSet = new Set(norm.hidden);
  const keep = (k: DashboardSectionKey) => available.has(k) && !hiddenSet.has(k);

  return {
    main: norm.main.filter(keep),
    aside: norm.aside.filter(keep),
    hidden: DASHBOARD_SECTIONS.map((s) => s.key).filter(
      (k) => available.has(k) && hiddenSet.has(k),
    ),
    collapsed: new Set(norm.collapsed.filter((k) => available.has(k))),
    isCustomised: !layoutsEqual(norm, defaultLayout()),
  };
}

function layoutsEqual(a: DashboardLayout, b: DashboardLayout): boolean {
  const eq = (x: DashboardSectionKey[], y: DashboardSectionKey[]) =>
    x.length === y.length && x.every((v, i) => v === y[i]);
  const eqSet = (x: DashboardSectionKey[], y: DashboardSectionKey[]) =>
    x.length === y.length && new Set(x).size === new Set([...x, ...y]).size;
  return (
    eq(a.main, b.main) &&
    eq(a.aside, b.aside) &&
    eqSet(a.collapsed, b.collapsed) &&
    eqSet(a.hidden, b.hidden)
  );
}

// ─── DB wrappers ──────────────────────────────────────────────────────

export async function getDashboardLayout(personId: string): Promise<DashboardLayout> {
  const row = await prisma.userPreference.findUnique({ where: { personId } });
  return parseDashboardLayout(row?.prefs);
}

const LayoutOpSchema: z.ZodType<LayoutOp> = z.union([
  z.object({ op: z.literal('move_up'), key: z.enum(DASHBOARD_SECTION_KEYS) }),
  z.object({ op: z.literal('move_down'), key: z.enum(DASHBOARD_SECTION_KEYS) }),
  z.object({ op: z.literal('move_column'), key: z.enum(DASHBOARD_SECTION_KEYS) }),
  z.object({ op: z.literal('collapse'), key: z.enum(DASHBOARD_SECTION_KEYS) }),
  z.object({ op: z.literal('expand'), key: z.enum(DASHBOARD_SECTION_KEYS) }),
  z.object({ op: z.literal('hide'), key: z.enum(DASHBOARD_SECTION_KEYS) }),
  z.object({ op: z.literal('show'), key: z.enum(DASHBOARD_SECTION_KEYS) }),
  z.object({ op: z.literal('reset') }),
]);

/**
 * Apply one layout operation for a person and persist it. Reads the full
 * prefs blob, merges only the `dashboardLayout` sub-key (leaving any other
 * preference untouched), upserts, and writes an audit event in the same
 * transaction (A9).
 */
export async function setDashboardLayoutOp(
  personId: string,
  op: LayoutOp,
): Promise<void> {
  const validated = LayoutOpSchema.parse(op);
  await prisma.$transaction(async (tx) => {
    const existing = await tx.userPreference.findUnique({ where: { personId } });
    const currentBlob =
      existing?.prefs && typeof existing.prefs === 'object'
        ? (existing.prefs as Record<string, unknown>)
        : {};
    const before = parseDashboardLayout(currentBlob);
    const after = applyLayoutOp(before, validated);
    const nextBlob = { ...currentBlob, dashboardLayout: after };

    await tx.userPreference.upsert({
      where: { personId },
      create: { personId, prefs: nextBlob },
      update: { prefs: nextBlob },
    });

    await writeAudit(tx, {
      actor: { type: 'person', id: personId },
      action: 'updated',
      entity: {
        type: 'dashboard_layout',
        id: personId,
        before: { layout: before },
        after: { layout: after, op: validated },
      },
      source: 'web',
    });
  });
}
