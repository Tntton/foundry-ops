import type { Capability } from '@/server/capabilities';
import { hasCapability } from '@/server/capabilities';
import type { Session } from '@/server/roles';
import {
  REQUIRED_TIMESHEET_HEADERS,
  buildTimesheetPreview,
} from '@/server/imports/timesheets';
import {
  REQUIRED_PERSONNEL_HEADERS,
  buildPersonnelPreview,
} from '@/server/imports/personnel';
import {
  REQUIRED_BILLS_HEADERS,
  buildBillsPreview,
} from '@/server/imports/bills';
import {
  REQUIRED_EXPENSES_HEADERS,
  buildExpensesPreview,
} from '@/server/imports/expenses';
import {
  stashTimesheets,
  stashPersonnel,
  stashBills,
  stashExpenses,
} from '@/server/imports/cache';

/**
 * Admin drag-drop CSV pipeline for the assistant (TASK-302f).
 *
 * When an admin drops a CSV onto the assistant panel, we detect which
 * bulk-import surface it maps to by inspecting the header row, run the
 * existing `buildXPreview` parser (identical code path the admin
 * surface uses on direct upload), stash the parsed preview in the
 * shared in-memory cache, and return a URL to `/admin/import/<kind>?
 * stage=preview&token=…`. The admin lands directly on the preview
 * screen with the Commit button live.
 *
 * The assistant NEVER writes bulk data — Commit stays on the admin
 * page. This is a routing accelerator, not a new write path.
 */

export type BulkCsvKind = 'timesheets' | 'personnel' | 'bills' | 'expenses';

/**
 * Required-header sets per kind, plus the capability that gates the
 * admin surface (checked before we even bother parsing).
 */
const KINDS: ReadonlyArray<{
  kind: BulkCsvKind;
  headers: readonly string[];
  capability: Capability;
  label: string;
}> = [
  {
    kind: 'timesheets',
    headers: REQUIRED_TIMESHEET_HEADERS,
    capability: 'timesheet.approve',
    label: 'timesheet',
  },
  {
    kind: 'personnel',
    headers: REQUIRED_PERSONNEL_HEADERS,
    capability: 'person.create',
    label: 'personnel',
  },
  {
    kind: 'bills',
    headers: REQUIRED_BILLS_HEADERS,
    capability: 'bill.create',
    label: 'bill',
  },
  {
    kind: 'expenses',
    headers: REQUIRED_EXPENSES_HEADERS,
    capability: 'expense.approve.under_2k',
    label: 'expense',
  },
];

/**
 * Read the first non-empty line of a CSV and return its lowercased,
 * comma-split header cells. Doesn't attempt full CSV parsing — headers
 * with commas / quotes are exotic in the four templates we support and
 * would be caught by the real parser downstream.
 */
export function extractHeaderCells(csvText: string): string[] {
  const lines = csvText.split(/\r?\n/u);
  const firstNonEmpty = lines.find((l) => l.trim().length > 0);
  if (!firstNonEmpty) return [];
  return firstNonEmpty
    .split(',')
    .map((c) => c.trim().replace(/^"|"$/gu, '').toLowerCase());
}

/**
 * Pure kind detector — given a header cell set, returns the best-match
 * kind or null. "Best match" = the kind with the highest coverage of
 * its required headers, provided coverage is ≥ 0.75. Exported for
 * testing.
 */
export function detectBulkKind(headerCells: readonly string[]): BulkCsvKind | null {
  const cellSet = new Set(headerCells);
  let best: { kind: BulkCsvKind; coverage: number } | null = null;
  for (const k of KINDS) {
    const present = k.headers.filter((h) => cellSet.has(h)).length;
    const coverage = present / k.headers.length;
    if (coverage >= 0.75 && (!best || coverage > best.coverage)) {
      best = { kind: k.kind, coverage };
    }
  }
  return best?.kind ?? null;
}

export type BulkDispatchResult =
  | {
      ok: true;
      kind: BulkCsvKind;
      url: string;
      summary: string;
      counts: {
        totalRows: number;
        accepted: number;
        rejected: number;
      };
    }
  | { ok: false; error: string };

/**
 * Full pipeline: detect kind → capability check → build preview →
 * stash → return URL. Called from `/api/assistant/chat` when a CSV
 * lands on the drag-drop path.
 */
export async function dispatchBulkCsv(input: {
  session: Session;
  csvText: string;
  fileName: string;
}): Promise<BulkDispatchResult> {
  const headers = extractHeaderCells(input.csvText);
  const kind = detectBulkKind(headers);
  if (!kind) {
    return {
      ok: false,
      error:
        "I couldn't tell what kind of CSV this is. Expected columns for one of: timesheets, personnel, bills, expenses. Download the template from /admin/import to check.",
    };
  }
  const meta = KINDS.find((k) => k.kind === kind)!;
  if (!hasCapability(input.session, meta.capability)) {
    return {
      ok: false,
      error: `Bulk ${meta.label} import needs the '${meta.capability}' capability, which your role doesn't have. Ask an admin.`,
    };
  }

  const personId = input.session.person.id;
  try {
    if (kind === 'timesheets') {
      const r = await buildTimesheetPreview(input.csvText, input.fileName);
      if (!r.ok) return { ok: false, error: r.error.message };
      const token = stashTimesheets(personId, r.preview);
      return {
        ok: true,
        kind,
        url: `/admin/import/timesheets?stage=preview&token=${encodeURIComponent(token)}`,
        summary: `${meta.label} CSV · ${r.preview.totalRows} rows · ${r.preview.acceptedCount} accepted · ${r.preview.rejectedCount} rejected`,
        counts: {
          totalRows: r.preview.totalRows,
          accepted: r.preview.acceptedCount,
          rejected: r.preview.rejectedCount,
        },
      };
    }
    if (kind === 'personnel') {
      const r = await buildPersonnelPreview(input.csvText, input.fileName);
      if (!r.ok) return { ok: false, error: r.error.message };
      const token = stashPersonnel(personId, r.preview);
      // Personnel uses new/update/error counts (upsert semantics) rather
      // than accepted/rejected. Sum them for the caller-facing counts +
      // give a slightly different summary sentence.
      const accepted = r.preview.newCount + r.preview.updateCount;
      return {
        ok: true,
        kind,
        url: `/admin/import/personnel?stage=preview&token=${encodeURIComponent(token)}`,
        summary: `${meta.label} CSV · ${r.preview.totalRows} rows · ${r.preview.newCount} new · ${r.preview.updateCount} updates · ${r.preview.errorCount} errors`,
        counts: {
          totalRows: r.preview.totalRows,
          accepted,
          rejected: r.preview.errorCount,
        },
      };
    }
    if (kind === 'bills') {
      const r = await buildBillsPreview(input.csvText, input.fileName);
      if (!r.ok) return { ok: false, error: r.error.message };
      const token = stashBills(personId, r.preview);
      return {
        ok: true,
        kind,
        url: `/admin/import/bills?stage=preview&token=${encodeURIComponent(token)}`,
        summary: `${meta.label} CSV · ${r.preview.totalRows} rows · ${r.preview.acceptedCount} accepted · ${r.preview.rejectedCount} rejected`,
        counts: {
          totalRows: r.preview.totalRows,
          accepted: r.preview.acceptedCount,
          rejected: r.preview.rejectedCount,
        },
      };
    }
    // expenses
    const r = await buildExpensesPreview(input.csvText, input.fileName);
    if (!r.ok) return { ok: false, error: r.error.message };
    const token = stashExpenses(personId, r.preview);
    return {
      ok: true,
      kind,
      url: `/admin/import/expenses?stage=preview&token=${encodeURIComponent(token)}`,
      summary: `${meta.label} CSV · ${r.preview.totalRows} rows · ${r.preview.acceptedCount} accepted · ${r.preview.rejectedCount} rejected`,
      counts: {
        totalRows: r.preview.totalRows,
        accepted: r.preview.acceptedCount,
        rejected: r.preview.rejectedCount,
      },
    };
  } catch (err) {
    console.error(`[assistant.bulk] ${kind} preview failed:`, err);
    return { ok: false, error: `Parsing ${meta.label} CSV failed: ${(err as Error).message}` };
  }
}
