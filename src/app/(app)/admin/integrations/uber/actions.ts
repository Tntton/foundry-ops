'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getSession } from '@/server/session';
import { requireCapability } from '@/server/capabilities';
import { writeAudit } from '@/server/audit';
import { prisma } from '@/server/db';
import {
  saveUberConnection,
  clearUberConnection,
  saveUberSftpConnection,
  clearUberSftpConnection,
} from '@/server/integrations/uber';
import { runUberSync } from '@/server/integrations/uber-sync';
import { importUberCsv } from '@/server/integrations/uber-csv';
import { pullUberSftpFiles } from '@/server/integrations/uber-sftp';

export type ConnectUberState =
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
 * Strip a leading "Label: " from a pasted credential. Mirrors the
 * Navan helper — admins often drag-select credentials that include
 * the label prefix, which makes the OAuth call fail with a confusing
 * `invalid_client` error.
 */
function cleanCredential(raw: string): string {
  return raw
    .trim()
    .replace(/^[A-Za-z][A-Za-z0-9 ]+:\s*/u, '')
    .trim();
}

const ConnectSchema = z.object({
  clientId: z.string().trim().min(8).transform(cleanCredential),
  clientSecret: z.string().trim().min(8).transform(cleanCredential),
  orgId: z
    .string()
    .trim()
    .max(120)
    .optional()
    .or(z.literal('').transform(() => null))
    .nullable(),
  tokenUrl: optionalUrl,
  tripsUrl: optionalUrl,
  scope: z
    .string()
    .trim()
    .max(200)
    .optional()
    .or(z.literal('').transform(() => null))
    .nullable(),
});

export async function connectUberAction(
  _prev: ConnectUberState,
  formData: FormData,
): Promise<ConnectUberState> {
  const session = await getSession();
  try {
    requireCapability(session, 'integration.manage');
  } catch {
    return { status: 'error', message: 'Not authorized' };
  }
  const parsed = ConnectSchema.safeParse({
    clientId: formData.get('clientId') ?? '',
    clientSecret: formData.get('clientSecret') ?? '',
    orgId: formData.get('orgId') ?? null,
    tokenUrl: formData.get('tokenUrl') ?? null,
    tripsUrl: formData.get('tripsUrl') ?? null,
    scope: formData.get('scope') ?? null,
  });
  if (!parsed.success) {
    return {
      status: 'error',
      message: parsed.error.issues[0]?.message ?? 'Invalid input',
    };
  }
  try {
    await saveUberConnection({
      clientId: parsed.data.clientId,
      clientSecret: parsed.data.clientSecret,
      orgId: parsed.data.orgId ?? null,
      tokenUrl: parsed.data.tokenUrl ?? null,
      tripsUrl: parsed.data.tripsUrl ?? null,
      scope: parsed.data.scope ?? null,
    });
    await prisma.$transaction(async (tx) => {
      await writeAudit(tx, {
        actor: { type: 'person', id: session!.person.id },
        action: 'connected',
        entity: { type: 'integration', id: 'uber' },
        source: 'web',
      });
    });
  } catch (err) {
    console.error('[uber.connect] failed:', err);
    return { status: 'error', message: 'Connect failed — see server logs.' };
  }
  revalidatePath('/admin/integrations');
  revalidatePath('/admin/integrations/uber');
  return {
    status: 'success',
    message: 'Connected. Run a sync to pull trip data.',
  };
}

export type DisconnectUberState =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | { status: 'success' };

export async function disconnectUberAction(
  _prev: DisconnectUberState,
  _formData: FormData,
): Promise<DisconnectUberState> {
  const session = await getSession();
  try {
    requireCapability(session, 'integration.manage');
  } catch {
    return { status: 'error', message: 'Not authorized' };
  }
  try {
    await clearUberConnection();
    await prisma.$transaction(async (tx) => {
      await writeAudit(tx, {
        actor: { type: 'person', id: session!.person.id },
        action: 'disconnected',
        entity: { type: 'integration', id: 'uber' },
        source: 'web',
      });
    });
  } catch (err) {
    console.error('[uber.disconnect] failed:', err);
    return { status: 'error', message: 'Disconnect failed — see server logs.' };
  }
  revalidatePath('/admin/integrations');
  revalidatePath('/admin/integrations/uber');
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

export async function runUberSyncAction(
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
    const result = await runUberSync({
      triggeredBy: { id: session!.person.id },
    });
    revalidatePath('/admin/integrations');
    revalidatePath('/admin/integrations/uber');
    revalidatePath('/approvals');
    return {
      status: 'success',
      imported: result.imported,
      skipped: result.skipped,
      unmatched: result.unmatched,
    };
  } catch (err) {
    console.error('[uber.sync] failed:', err);
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
      canceled: number;
      unmatched: string[];
      projectAutoTagged: number;
    };

export async function importUberCsvAction(
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
    return {
      status: 'error',
      message: 'CSV is larger than 10MB — split it before re-uploading.',
    };
  }
  const csv = await file.text();
  try {
    const result = await importUberCsv({
      csv,
      actorPersonId: session!.person.id,
    });
    revalidatePath('/admin/integrations/uber');
    revalidatePath('/approvals');
    return {
      status: 'success',
      imported: result.imported,
      skipped: result.skipped,
      canceled: result.canceled,
      unmatched: result.unmatched,
      projectAutoTagged: result.projectAutoTagged,
    };
  } catch (err) {
    console.error('[uber.csv] failed:', err);
    return {
      status: 'error',
      message: (err as Error).message ?? 'CSV import failed — see server logs.',
    };
  }
}

// ─── SFTP delivery ────────────────────────────────────────────────────

export type ConfigureSftpState =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | { status: 'success'; message: string };

/**
 * Stripped-down PEM validator. Uber's SFTP wants a PKCS#8 or
 * OpenSSH-format private key — we just sanity-check the BEGIN/END
 * armour markers and length. Real decode happens inside ssh2 at
 * connect time; this only catches the "pasted the public key by
 * mistake" or "pasted truncated key" cases up front.
 */
function looksLikePrivateKey(raw: string): boolean {
  const t = raw.trim();
  if (t.length < 200) return false;
  return (
    (t.startsWith('-----BEGIN') &&
      t.includes('PRIVATE KEY') &&
      t.includes('-----END')) ||
    t.startsWith('-----BEGIN OPENSSH PRIVATE KEY-----')
  );
}

const SftpSchema = z.object({
  host: z.string().trim().min(3).max(255),
  // Most ports fit in <=5 digits; default 22.
  port: z
    .union([z.string(), z.number()])
    .transform((v) => {
      const n = typeof v === 'string' ? parseInt(v, 10) : v;
      return Number.isFinite(n) && n > 0 && n < 65536 ? n : 22;
    }),
  username: z.string().trim().min(1).max(255),
  privateKey: z
    .string()
    .min(200)
    .refine(looksLikePrivateKey, {
      message:
        'Doesn\'t look like a PEM/OpenSSH private key — make sure you pasted the BEGIN/END block.',
    }),
  passphrase: z
    .string()
    .max(255)
    .optional()
    .or(z.literal('').transform(() => null))
    .nullable(),
  remoteDir: z.string().trim().min(1).max(255),
  filePattern: z
    .string()
    .trim()
    .max(80)
    .optional()
    .or(z.literal('').transform(() => null))
    .nullable(),
});

export async function configureUberSftpAction(
  _prev: ConfigureSftpState,
  formData: FormData,
): Promise<ConfigureSftpState> {
  const session = await getSession();
  try {
    requireCapability(session, 'integration.manage');
  } catch {
    return { status: 'error', message: 'Not authorized' };
  }
  const parsed = SftpSchema.safeParse({
    host: formData.get('host') ?? '',
    port: formData.get('port') ?? 22,
    username: formData.get('username') ?? '',
    privateKey: formData.get('privateKey') ?? '',
    passphrase: formData.get('passphrase') ?? null,
    remoteDir: formData.get('remoteDir') ?? '/',
    filePattern: formData.get('filePattern') ?? null,
  });
  if (!parsed.success) {
    return {
      status: 'error',
      message: parsed.error.issues[0]?.message ?? 'Invalid input',
    };
  }
  try {
    await saveUberSftpConnection({
      host: parsed.data.host,
      port: parsed.data.port,
      username: parsed.data.username,
      privateKey: parsed.data.privateKey,
      passphrase: parsed.data.passphrase ?? null,
      remoteDir: parsed.data.remoteDir,
      filePattern: parsed.data.filePattern ?? null,
    });
    await prisma.$transaction(async (tx) => {
      await writeAudit(tx, {
        actor: { type: 'person', id: session!.person.id },
        action: 'sftp_configured',
        entity: { type: 'integration', id: 'uber' },
        source: 'web',
      });
    });
  } catch (err) {
    console.error('[uber.sftp.configure] failed:', err);
    return {
      status: 'error',
      message: 'SFTP configure failed — see server logs.',
    };
  }
  revalidatePath('/admin/integrations');
  revalidatePath('/admin/integrations/uber');
  return {
    status: 'success',
    message: 'SFTP configured. Run a pull to test the connection.',
  };
}

export type ClearSftpState =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | { status: 'success' };

export async function clearUberSftpAction(
  _prev: ClearSftpState,
  _formData: FormData,
): Promise<ClearSftpState> {
  const session = await getSession();
  try {
    requireCapability(session, 'integration.manage');
  } catch {
    return { status: 'error', message: 'Not authorized' };
  }
  try {
    await clearUberSftpConnection();
    await prisma.$transaction(async (tx) => {
      await writeAudit(tx, {
        actor: { type: 'person', id: session!.person.id },
        action: 'sftp_cleared',
        entity: { type: 'integration', id: 'uber' },
        source: 'web',
      });
    });
  } catch (err) {
    console.error('[uber.sftp.clear] failed:', err);
    return {
      status: 'error',
      message: 'Clear failed — see server logs.',
    };
  }
  revalidatePath('/admin/integrations/uber');
  return { status: 'success' };
}

export type RunSftpPullState =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | {
      status: 'success';
      filesDiscovered: number;
      filesImported: number;
      filesSkipped: number;
      filesFailed: number;
      tripsImported: number;
      tripsSkipped: number;
      tripsCanceled: number;
      unmatchedRiders: string[];
      failedFiles: string[];
    };

export async function runUberSftpPullAction(
  _prev: RunSftpPullState,
  _formData: FormData,
): Promise<RunSftpPullState> {
  const session = await getSession();
  try {
    requireCapability(session, 'integration.manage');
  } catch {
    return { status: 'error', message: 'Not authorized' };
  }
  try {
    const result = await pullUberSftpFiles({
      actorPersonId: session!.person.id,
    });
    revalidatePath('/admin/integrations/uber');
    revalidatePath('/approvals');
    return {
      status: 'success',
      filesDiscovered: result.filesDiscovered,
      filesImported: result.filesImported,
      filesSkipped: result.filesSkipped,
      filesFailed: result.filesFailed,
      tripsImported: result.tripsImported,
      tripsSkipped: result.tripsSkipped,
      tripsCanceled: result.tripsCanceled,
      unmatchedRiders: result.unmatchedRiders,
      failedFiles: result.failedFiles,
    };
  } catch (err) {
    console.error('[uber.sftp.pull] failed:', err);
    return {
      status: 'error',
      message: (err as Error).message ?? 'SFTP pull failed — see server logs.',
    };
  }
}
