'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getSession } from '@/server/session';
import { requireCapability } from '@/server/capabilities';
import { writeAudit } from '@/server/audit';
import { prisma } from '@/server/db';
import {
  saveNavanConnection,
  clearNavanConnection,
} from '@/server/integrations/navan';
import { runNavanSync } from '@/server/integrations/navan-sync';
import { importNavanCsv } from '@/server/integrations/navan-csv';

export type ConnectNavanState =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | { status: 'success'; message: string };

const optionalUrl = z
  .string()
  .trim()
  .url()
  .max(500)
  .optional()
  .or(z.literal('').transform(() => null))
  .nullable();

/**
 * Sloppy-paste cleaner. The Navan credential page surfaces values
 * alongside labels — when admins drag-select the visible text they
 * often catch the label prefix too (e.g. `Secret Key: bfa0...`).
 * Strip a leading `Label:` and any surrounding whitespace so the
 * stored credential is just the value.
 */
function cleanCredential(raw: string): string {
  return raw
    .trim()
    .replace(/^[A-Za-z][A-Za-z0-9 ]+:\s*/u, '')
    .trim();
}

const ConnectSchema = z.object({
  apiKey: z.string().trim().min(8).transform(cleanCredential),
  apiSecret: z.string().trim().min(8).transform(cleanCredential),
  orgId: z.string().trim().max(120).optional().or(z.literal('').transform(() => null)).nullable(),
  // Per-tenant Navan endpoints. Leave blank to use the env / built-in
  // default. Required when Navan's docs for your tenant list a path
  // that doesn't match `https://api.navan.com/oauth2/token`.
  tokenUrl: optionalUrl,
  bookingsUrl: optionalUrl,
  expensesUrl: optionalUrl,
});

export async function connectNavanAction(
  _prev: ConnectNavanState,
  formData: FormData,
): Promise<ConnectNavanState> {
  const session = await getSession();
  try {
    requireCapability(session, 'integration.manage');
  } catch {
    return { status: 'error', message: 'Not authorized' };
  }
  const parsed = ConnectSchema.safeParse({
    apiKey: formData.get('apiKey') ?? '',
    apiSecret: formData.get('apiSecret') ?? '',
    orgId: formData.get('orgId') ?? null,
    tokenUrl: formData.get('tokenUrl') ?? null,
    bookingsUrl: formData.get('bookingsUrl') ?? null,
    expensesUrl: formData.get('expensesUrl') ?? null,
  });
  if (!parsed.success) {
    return {
      status: 'error',
      message: parsed.error.issues[0]?.message ?? 'Invalid input',
    };
  }
  try {
    await saveNavanConnection({
      apiKey: parsed.data.apiKey,
      apiSecret: parsed.data.apiSecret,
      orgId: parsed.data.orgId ?? null,
      tokenUrl: parsed.data.tokenUrl ?? null,
      bookingsUrl: parsed.data.bookingsUrl ?? null,
      expensesUrl: parsed.data.expensesUrl ?? null,
    });
    await prisma.$transaction(async (tx) => {
      await writeAudit(tx, {
        actor: { type: 'person', id: session!.person.id },
        action: 'connected',
        entity: { type: 'integration', id: 'navan' },
        source: 'web',
      });
    });
  } catch (err) {
    console.error('[navan.connect] failed:', err);
    return { status: 'error', message: 'Connect failed — see server logs.' };
  }
  revalidatePath('/admin/integrations');
  revalidatePath('/admin/integrations/navan');
  return { status: 'success', message: 'Connected. Run a sync to pull travel data.' };
}

export type DisconnectNavanState =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | { status: 'success' };

// Two args (prev + formData) so this can be passed directly to
// `useFormState` from the client. The earlier `() => disconnectNavanAction(...)`
// wrapper looked harmless but stripped the action from React's
// server-action call path — `getSession()` then returned null and the
// disconnect bounced with "Not authorized" even for super_admin.
export async function disconnectNavanAction(
  _prev: DisconnectNavanState,
  _formData: FormData,
): Promise<DisconnectNavanState> {
  const session = await getSession();
  try {
    requireCapability(session, 'integration.manage');
  } catch {
    return { status: 'error', message: 'Not authorized' };
  }
  try {
    await clearNavanConnection();
    await prisma.$transaction(async (tx) => {
      await writeAudit(tx, {
        actor: { type: 'person', id: session!.person.id },
        action: 'disconnected',
        entity: { type: 'integration', id: 'navan' },
        source: 'web',
      });
    });
  } catch (err) {
    console.error('[navan.disconnect] failed:', err);
    return { status: 'error', message: 'Disconnect failed — see server logs.' };
  }
  revalidatePath('/admin/integrations');
  revalidatePath('/admin/integrations/navan');
  return { status: 'success' };
}

export type RunSyncState =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | {
      status: 'success';
      imported: number;
      skipped: number;
      unmatched: string[];
    };

export async function runNavanSyncAction(
  _prev: RunSyncState,
  _formData: FormData,
): Promise<RunSyncState> {
  const session = await getSession();
  try {
    requireCapability(session, 'integration.manage');
  } catch {
    return { status: 'error', message: 'Not authorized' };
  }
  try {
    const result = await runNavanSync({ triggeredBy: { id: session!.person.id } });
    revalidatePath('/admin/integrations');
    revalidatePath('/admin/integrations/navan');
    revalidatePath('/bills/intake');
    return {
      status: 'success',
      imported: result.imported,
      skipped: result.skipped,
      unmatched: result.unmatched,
    };
  } catch (err) {
    console.error('[navan.sync] failed:', err);
    return {
      status: 'error',
      message: (err as Error).message ?? 'Sync failed — see server logs.',
    };
  }
}

export type ImportCsvState =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | {
      status: 'success';
      imported: number;
      skipped: number;
      voided: number;
      unmatched: string[];
      projectAutoTagged: number;
    };

/**
 * Manual CSV import — handles the Navan "Bookings" report export
 * (downloadable from Navan admin → Reports). Useful when the live BDI
 * API isn't returning data + as a one-off backfill for bookings made
 * before the integration was wired up.
 *
 * Hard cap on file size (10MB) to prevent a runaway upload from
 * blocking the action. Average Navan bookings export is under 1MB.
 */
export async function importNavanCsvAction(
  _prev: ImportCsvState,
  formData: FormData,
): Promise<ImportCsvState> {
  const session = await getSession();
  try {
    requireCapability(session, 'integration.manage');
  } catch {
    return { status: 'error', message: 'Not authorized' };
  }
  const file = formData.get('csv');
  if (!(file instanceof File) || file.size === 0) {
    return { status: 'error', message: 'No CSV file picked.' };
  }
  if (file.size > 10 * 1024 * 1024) {
    return { status: 'error', message: 'CSV is larger than 10MB — split it before re-uploading.' };
  }
  const csv = await file.text();
  try {
    const result = await importNavanCsv({
      csv,
      actorPersonId: session!.person.id,
    });
    revalidatePath('/admin/integrations/navan');
    revalidatePath('/bills/intake');
    revalidatePath('/approvals');
    return {
      status: 'success',
      imported: result.imported,
      skipped: result.skipped,
      voided: result.voided,
      unmatched: result.unmatched,
      projectAutoTagged: result.projectAutoTagged,
    };
  } catch (err) {
    console.error('[navan.csv] failed:', err);
    return {
      status: 'error',
      message: (err as Error).message ?? 'CSV import failed — see server logs.',
    };
  }
}
