'use server';

import SftpClient from 'ssh2-sftp-client';
import {
  getUberIntegration,
  readSftpCredentials,
  recordSftpFileImported,
} from '@/server/integrations/uber';
import { importUberCsv } from '@/server/integrations/uber-csv';

/**
 * Uber for Business SFTP pull. Connects to Uber's "Employee SFTP"
 * delivery endpoint, lists the configured remote dir, downloads any
 * trip-activity CSVs we haven't seen before, and feeds each through
 * the existing manual-upload CSV parser. Per-file idempotency is
 * tracked in `UberConfig.sftp.importedFiles`; per-trip dedupe is
 * handled by the parser via `uber:trip:<id>` supplierInvoiceNumber
 * prefix. Re-runs are safe.
 *
 * Failures don't kill the whole pull — each file is wrapped in
 * try/catch so a single malformed CSV doesn't stop us from picking
 * up the next one. Errors are logged + surfaced in the result.
 *
 * Connection lifecycle: connect → list → download each new file →
 * disconnect in a finally block. Vercel's serverless function
 * timeout is 120s for this cron route, which is plenty for the
 * file sizes Uber drops (typically <2MB).
 */

export type UberSftpPullResult = {
  ok: true;
  filesDiscovered: number;
  filesImported: number;
  filesSkipped: number; // already-imported
  filesFailed: number;
  /** Per-file aggregate trip counts so admin can see at a glance
   *  what landed without grepping logs. */
  tripsImported: number;
  tripsSkipped: number;
  tripsCanceled: number;
  unmatchedRiders: string[];
  /** Filenames of files that errored during download or parse —
   *  surfaced in the UI so admin can investigate one specific
   *  delivery without trawling the cron log. */
  failedFiles: string[];
};

export async function pullUberSftpFiles(opts: {
  actorPersonId: string;
}): Promise<UberSftpPullResult> {
  const integration = await getUberIntegration();
  if (!integration || integration.status !== 'connected') {
    throw new Error('Uber integration is not connected.');
  }
  const creds = readSftpCredentials(integration);

  const sftp = new SftpClient('uber-pull');
  let filesDiscovered = 0;
  let filesImported = 0;
  let filesSkipped = 0;
  let filesFailed = 0;
  let tripsImported = 0;
  let tripsSkipped = 0;
  let tripsCanceled = 0;
  const unmatchedRiders = new Set<string>();
  const failedFiles: string[] = [];

  try {
    await sftp.connect({
      host: creds.host,
      port: creds.port,
      username: creds.username,
      privateKey: creds.privateKey,
      ...(creds.passphrase ? { passphrase: creds.passphrase } : {}),
      // Reasonable timeouts — Uber's SFTP service is usually fast but
      // we don't want a hang to eat the whole cron budget.
      readyTimeout: 20_000,
    });

    const entries = await sftp.list(creds.remoteDir);
    // Filter to files (not directories) matching the configured
    // pattern (defaults to `.csv`). Sort by modification time so we
    // import oldest-first — keeps the per-trip dedupe order
    // deterministic when two CSVs cover overlapping windows.
    const pattern = creds.filePattern.toLowerCase();
    const candidates = entries
      .filter((e) => e.type === '-' && e.name.toLowerCase().includes(pattern))
      .sort((a, b) => a.modifyTime - b.modifyTime);
    filesDiscovered = candidates.length;

    const importedSet = new Set(creds.importedFiles);
    for (const entry of candidates) {
      if (importedSet.has(entry.name)) {
        filesSkipped += 1;
        continue;
      }
      try {
        // Read the remote file into memory as a Buffer, then decode
        // as UTF-8 for the CSV parser. Uber's CSVs are typically
        // a few hundred KB; we cap at 50MB so a misconfigured remote
        // dir doesn't OOM us.
        const remotePath = `${creds.remoteDir.replace(/\/+$/, '')}/${entry.name}`;
        const buf = (await sftp.get(remotePath)) as Buffer;
        if (buf.length > 50 * 1024 * 1024) {
          throw new Error(
            `File too large (${(buf.length / 1024 / 1024).toFixed(1)}MB) — skipping to avoid OOM.`,
          );
        }
        const csv = buf.toString('utf8');
        const result = await importUberCsv({
          csv,
          actorPersonId: opts.actorPersonId,
        });
        tripsImported += result.imported;
        tripsSkipped += result.skipped;
        tripsCanceled += result.canceled;
        for (const u of result.unmatched) unmatchedRiders.add(u);
        await recordSftpFileImported(entry.name);
        filesImported += 1;
      } catch (err) {
        console.error(
          `[uber.sftp-pull] file ${entry.name} failed:`,
          err,
        );
        failedFiles.push(entry.name);
        filesFailed += 1;
      }
    }
  } finally {
    // Always close the SFTP connection, even on error — leaked
    // sockets eat connection-pool slots on Uber's side and may
    // trigger rate-limit pushback on the next pull.
    try {
      await sftp.end();
    } catch {
      // Best-effort close; if the connect itself failed there's
      // nothing to close.
    }
  }

  return {
    ok: true,
    filesDiscovered,
    filesImported,
    filesSkipped,
    filesFailed,
    tripsImported,
    tripsSkipped,
    tripsCanceled,
    unmatchedRiders: [...unmatchedRiders],
    failedFiles,
  };
}
