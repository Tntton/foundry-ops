import crypto from 'node:crypto';
import type { PersonnelPreview } from './personnel';
import type { TimesheetPreview } from './timesheets';
import type { BillsPreview } from './bills';
import type { ExpensesPreview } from './expenses';

/**
 * In-memory dry-run cache for bulk-import previews.
 *
 * The /admin/import flow is two-step: parse upload → render preview →
 * explicit Commit click. Between those steps we have to hold the
 * already-validated rows somewhere so the commit doesn't re-trust the
 * CSV (otherwise an attacker could swap the file contents between
 * preview and commit). We stash the parsed result under a random token
 * tied to the user who uploaded it; the preview URL carries the token
 * as a search-param so the page is shareable / refreshable for the
 * cache TTL.
 *
 * Per-process Map is fine for the current single-region Vercel
 * deployment — Jas + TT are the only operators and the window is
 * short. If the surface ever needs multi-region or longer-than-TTL
 * persistence, swap this for a DB-backed `ImportDryRun` table without
 * changing the action signatures.
 */

const TTL_MS = 10 * 60 * 1000;

export type CachedImport =
  | { kind: 'personnel'; userId: string; data: PersonnelPreview; expires: number }
  | { kind: 'timesheets'; userId: string; data: TimesheetPreview; expires: number }
  | { kind: 'bills'; userId: string; data: BillsPreview; expires: number }
  | { kind: 'expenses'; userId: string; data: ExpensesPreview; expires: number };

const store = new Map<string, CachedImport>();

function gc(): void {
  const now = Date.now();
  for (const [token, entry] of store.entries()) {
    if (entry.expires < now) store.delete(token);
  }
}

export function stashPersonnel(userId: string, data: PersonnelPreview): string {
  gc();
  const token = crypto.randomBytes(16).toString('hex');
  store.set(token, { kind: 'personnel', userId, data, expires: Date.now() + TTL_MS });
  return token;
}

export function stashTimesheets(userId: string, data: TimesheetPreview): string {
  gc();
  const token = crypto.randomBytes(16).toString('hex');
  store.set(token, { kind: 'timesheets', userId, data, expires: Date.now() + TTL_MS });
  return token;
}

export function readPersonnel(userId: string, token: string): PersonnelPreview | null {
  gc();
  const entry = store.get(token);
  if (!entry) return null;
  if (entry.kind !== 'personnel') return null;
  if (entry.userId !== userId) return null;
  return entry.data;
}

export function readTimesheets(userId: string, token: string): TimesheetPreview | null {
  gc();
  const entry = store.get(token);
  if (!entry) return null;
  if (entry.kind !== 'timesheets') return null;
  if (entry.userId !== userId) return null;
  return entry.data;
}

export function stashBills(userId: string, data: BillsPreview): string {
  gc();
  const token = crypto.randomBytes(16).toString('hex');
  store.set(token, { kind: 'bills', userId, data, expires: Date.now() + TTL_MS });
  return token;
}

export function readBills(userId: string, token: string): BillsPreview | null {
  gc();
  const entry = store.get(token);
  if (!entry) return null;
  if (entry.kind !== 'bills') return null;
  if (entry.userId !== userId) return null;
  return entry.data;
}

export function stashExpenses(userId: string, data: ExpensesPreview): string {
  gc();
  const token = crypto.randomBytes(16).toString('hex');
  store.set(token, { kind: 'expenses', userId, data, expires: Date.now() + TTL_MS });
  return token;
}

export function readExpenses(userId: string, token: string): ExpensesPreview | null {
  gc();
  const entry = store.get(token);
  if (!entry) return null;
  if (entry.kind !== 'expenses') return null;
  if (entry.userId !== userId) return null;
  return entry.data;
}

export function discard(token: string): void {
  store.delete(token);
}
