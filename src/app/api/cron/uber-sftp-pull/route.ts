import { NextResponse } from 'next/server';
import { requireEnv } from '@/server/env';
import { prisma } from '@/server/db';
import {
  getUberIntegration,
  type UberConfig,
} from '@/server/integrations/uber';
import { pullUberSftpFiles } from '@/server/integrations/uber-sftp';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// SSH handshake + file downloads can take a few seconds each; Uber's
// CSVs are small but the cold-start cost of the ssh2 native binding
// is real. 180s gives generous headroom on the Pro plan.
export const maxDuration = 180;

/**
 * Scheduled Uber for Business SFTP pull. Vercel Cron hits this via
 * the `Authorization: Bearer <CRON_SECRET>` header; in dev the
 * `?key=<CRON_SECRET>` query param works too.
 *
 * Pulls every CSV in the configured remote dir that hasn't already
 * been imported (tracked by filename in `UberConfig.sftp.importedFiles`)
 * and feeds each through the existing manual-upload parser. Trip-level
 * dedupe (via the `uber:trip:<id>` supplierInvoiceNumber prefix) is
 * the second line of defence — re-running the same file is a no-op.
 *
 * Actor: a "system" actor when nobody specific triggered it. We mint
 * one synthetic UUID per deploy — the rider person id is fine when
 * available, but we need a concrete person id for `actorPersonId`
 * since `importUberCsv` uses it as the Approval row's `requestedById`.
 * Falls back to the first super_admin (= TT) which keeps audit-trail
 * pointing to a real owner of the import.
 */
export async function GET(req: Request) {
  const cronSecret = requireEnv('CRON_SECRET');
  const auth = req.headers.get('authorization');
  const url = new URL(req.url);
  const providedKey =
    auth?.replace(/^Bearer\s+/i, '') ?? url.searchParams.get('key') ?? '';
  if (providedKey !== cronSecret) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const uberRow = await getUberIntegration();
  if (!uberRow || uberRow.status !== 'connected') {
    return NextResponse.json(
      { skipped: 'uber not connected' },
      { status: 200 },
    );
  }
  const cfg = (uberRow.config ?? {}) as UberConfig;
  if (!cfg.sftp) {
    return NextResponse.json(
      { skipped: 'uber sftp not configured' },
      { status: 200 },
    );
  }

  // Resolve the actor — first super_admin in the directory. The
  // Approval row's `requestedById` must point to a real Person FK.
  // Falls back to the first admin if no super_admin is on file.
  const actor =
    (await prisma.person.findFirst({
      where: { roles: { has: 'super_admin' }, inactiveAt: null },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    })) ??
    (await prisma.person.findFirst({
      where: { roles: { has: 'admin' }, inactiveAt: null },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    }));
  if (!actor) {
    return NextResponse.json(
      { error: 'no super_admin / admin found for cron actor' },
      { status: 500 },
    );
  }

  try {
    const result = await pullUberSftpFiles({ actorPersonId: actor.id });
    console.log('[cron/uber-sftp-pull] ok:', {
      filesImported: result.filesImported,
      filesSkipped: result.filesSkipped,
      filesFailed: result.filesFailed,
      tripsImported: result.tripsImported,
    });
    return NextResponse.json(result);
  } catch (err) {
    console.error('[cron/uber-sftp-pull] failed:', err);
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
