import type { LedgerFilters, LedgerSourceType } from '@/server/reports/ledger';

/**
 * Parse master-ledger filters from URL search params. Shared by the
 * reporting tab (TASK-069b) and the export endpoints (TASK-069c) so the
 * on-screen view and the download always scope identically.
 */

const SOURCE_TYPES: readonly LedgerSourceType[] = [
  'invoice',
  'bill',
  'expense',
  'payrun_line',
  'contractor_invoice',
  'bank_transaction',
];

type SP = Record<string, string | string[] | undefined>;

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/** Parse a `YYYY-MM-DD` string into a UTC Date, or undefined if invalid. */
export function parseYmd(s: string | undefined): Date | undefined {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/u.test(s)) return undefined;
  const d = new Date(`${s}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

export function parseLedgerFilters(sp: SP): LedgerFilters {
  const filters: LedgerFilters = {};

  const dir = first(sp['direction']);
  if (dir === 'in' || dir === 'out') filters.direction = dir;

  const src = first(sp['sourceType']);
  if (src && (SOURCE_TYPES as readonly string[]).includes(src)) {
    filters.sourceTypes = [src as LedgerSourceType];
  }

  const status = first(sp['status'])?.trim();
  if (status) filters.status = status;

  const from = parseYmd(first(sp['from']));
  if (from) filters.from = from;
  // `to` is inclusive of the whole day — push to 23:59:59.999Z.
  const to = parseYmd(first(sp['to']));
  if (to) filters.to = new Date(to.getTime() + 86_399_999);

  const projectId = first(sp['projectId'])?.trim();
  if (projectId) filters.projectId = projectId;
  const clientId = first(sp['clientId'])?.trim();
  if (clientId) filters.clientId = clientId;

  return filters;
}

/** Re-serialise filters back to a query string (for export links). */
export function ledgerFiltersToQuery(sp: SP): string {
  const params = new URLSearchParams();
  for (const key of [
    'direction',
    'sourceType',
    'status',
    'from',
    'to',
    'projectId',
    'clientId',
  ]) {
    const v = first(sp[key]);
    if (v) params.set(key, v);
  }
  const q = params.toString();
  return q ? `?${q}` : '';
}
