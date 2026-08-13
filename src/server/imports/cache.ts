import crypto from 'node:crypto';
import { prisma } from '@/server/db';
import type { Prisma } from '@prisma/client';
import type { PersonnelPreview } from './personnel';
import type { TimesheetPreview } from './timesheets';
import type { BillsPreview } from './bills';
import type { ExpensesPreview } from './expenses';

/**
 * DB-backed dry-run cache for bulk-import previews.
 *
 * The /admin/import flow is two-step: parse upload → render preview →
 * explicit Commit click. Between those steps we hold the already-validated
 * rows so the commit doesn't re-trust the CSV (otherwise an attacker could
 * swap the file contents between preview and commit). We stash the parsed
 * result under a random token tied to the uploader; the preview URL carries
 * the token as a search-param so the page is shareable / refreshable for
 * the cache TTL.
 *
 * This used to be a per-process `Map`. That silently failed on Vercel: the
 * parse request and the preview/commit request are separate serverless
 * invocations and routinely land on *different* instances, so the second
 * step couldn't find the stash and the operator saw "preview expired or
 * already committed" even seconds later. Backing it with a shared table
 * fixes every import surface. Rows are short-lived and GC'd opportunistically.
 *
 * The stored `data` is a *Preview object. All four preview shapes are
 * JSON-safe by construction (ISO date strings + number dollars, no Date /
 * BigInt), so they round-trip through the `jsonb` column unchanged.
 */

const TTL_MS = 10 * 60 * 1000;

type ImportKind = 'personnel' | 'timesheets' | 'bills' | 'expenses';

async function stash(
  kind: ImportKind,
  userId: string,
  data: unknown,
): Promise<string> {
  const token = crypto.randomBytes(16).toString('hex');
  await prisma.importDryRun.create({
    data: {
      token,
      userId,
      kind,
      data: data as Prisma.InputJsonValue,
      expiresAt: new Date(Date.now() + TTL_MS),
    },
  });
  // Opportunistic GC — best-effort, never block the stash on it.
  prisma.importDryRun
    .deleteMany({ where: { expiresAt: { lt: new Date() } } })
    .catch(() => undefined);
  return token;
}

async function read<T>(
  kind: ImportKind,
  userId: string,
  token: string,
): Promise<T | null> {
  const entry = await prisma.importDryRun.findUnique({ where: { token } });
  if (!entry) return null;
  if (entry.kind !== kind) return null;
  if (entry.userId !== userId) return null;
  if (entry.expiresAt.getTime() < Date.now()) return null;
  return entry.data as T;
}

export function stashPersonnel(userId: string, data: PersonnelPreview): Promise<string> {
  return stash('personnel', userId, data);
}

export function stashTimesheets(userId: string, data: TimesheetPreview): Promise<string> {
  return stash('timesheets', userId, data);
}

export function stashBills(userId: string, data: BillsPreview): Promise<string> {
  return stash('bills', userId, data);
}

export function stashExpenses(userId: string, data: ExpensesPreview): Promise<string> {
  return stash('expenses', userId, data);
}

export function readPersonnel(userId: string, token: string): Promise<PersonnelPreview | null> {
  return read<PersonnelPreview>('personnel', userId, token);
}

export function readTimesheets(userId: string, token: string): Promise<TimesheetPreview | null> {
  return read<TimesheetPreview>('timesheets', userId, token);
}

export function readBills(userId: string, token: string): Promise<BillsPreview | null> {
  return read<BillsPreview>('bills', userId, token);
}

export function readExpenses(userId: string, token: string): Promise<ExpensesPreview | null> {
  return read<ExpensesPreview>('expenses', userId, token);
}

export async function discard(token: string): Promise<void> {
  // delete() throws if the row is already gone (expired-GC'd or committed
  // in a racing tab); deleteMany() is idempotent.
  await prisma.importDryRun.deleteMany({ where: { token } });
}
