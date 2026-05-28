import { NextResponse } from 'next/server';
import { requireEnv } from '@/server/env';
import { prisma } from '@/server/db';
import { processInbox } from '@/server/integrations/uber-email-intake';
import { writeAudit } from '@/server/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Graph list + per-file download/OCR/move adds up — budget for ~10
// PDFs per fire at the 15-min cadence. 180s gives generous headroom
// before Vercel's max function duration on the Pro plan kicks in.
export const maxDuration = 180;

/**
 * Scheduled Uber receipt email-intake. Pairs with the M365 Power
 * Automate flow that watches an inbox for `noreply@uber.com` ride
 * receipts and drops the PDF attachment into a SharePoint folder.
 *
 * Auth: Vercel Cron hits this with `Authorization: Bearer <CRON_SECRET>`;
 * the `?key=…` query param works for manual runs from a browser.
 *
 * Actor: pinned to the first super_admin (= TT) so the AuditEvent
 * has a real Person FK. The Expense itself is attributed to the
 * rider — the actor is just the system-triggerer.
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
    const result = await processInbox({ actorPersonId: actor.id });
    console.log('[cron/uber-receipts-pull] ok:', {
      filesDiscovered: result.filesDiscovered,
      filesImported: result.filesImported,
      filesSkipped: result.filesSkipped,
      filesUnmatched: result.filesUnmatched,
      filesFailed: result.filesFailed,
      skippedReason: result.skippedReason,
    });

    // Heartbeat — system-health derives "up vs not_configured" from
    // the most recent succeeded cron-fire audit event in the last
    // 24h. Write one even on a no-op run so an empty inbox doesn't
    // make the integration look dead.
    await prisma.$transaction(async (tx) => {
      await writeAudit(tx, {
        actor: { type: 'person', id: actor.id },
        action: 'synced',
        entity: {
          type: 'integration',
          id: 'uber',
          after: {
            via: 'uber_email_intake',
            ...result,
          },
        },
        source: 'integration_sync',
      });
    });

    return NextResponse.json(result);
  } catch (err) {
    console.error('[cron/uber-receipts-pull] failed:', err);
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
