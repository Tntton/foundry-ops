import { NextResponse } from 'next/server';
import { requireEnv } from '@/server/env';
import { prisma } from '@/server/db';
import { pollAllMailboxes } from '@/server/integrations/m365-mail-intake';
import { writeAudit } from '@/server/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Two mailboxes × up to 100 messages/fire × OCR-per-candidate. Budget
// generously so the second mailbox doesn't lose out to a slow first —
// same 180s ceiling the Uber cron uses.
export const maxDuration = 180;

/**
 * Scheduled AP autoharvest — TASK-093.
 *
 * Every 15 min (see vercel.json) polls the enabled mailboxes on
 * MailboxPollCursor via Microsoft Graph app-token, extracts invoice
 * fields from PDF/image attachments via claude-sonnet, and lands a
 * Bill row (status pending_review) + Approval + AuditEvent per invoice.
 *
 * Auth: Vercel Cron hits with `Authorization: Bearer <CRON_SECRET>`;
 * `?key=…` works for manual runs from a browser.
 *
 * Actor: pinned to the first super_admin (= TT) so AuditEvent + Approval
 * rows have a real Person FK. Same convention as the Uber cron.
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
    const { mailboxes } = await pollAllMailboxes({ actorPersonId: actor.id });

    console.log(
      '[cron/invoice-autoharvest] ok:',
      mailboxes.map((m) => ({
        upn: m.mailboxUpn,
        messagesConsidered: m.messagesConsidered,
        candidatesScanned: m.candidatesScanned,
        billsCreated: m.billsCreated,
        duplicates: m.billsSkippedDuplicate,
        extractionsFailed: m.extractionsFailed,
        skipped: m.skippedReason,
        errors: m.errors.length,
      })),
    );

    // Heartbeat — one AuditEvent per mailbox per fire, even on no-op
    // runs. system-health reads these to distinguish "cron never ran"
    // from "cron ran, nothing to process". Matches the pattern the Uber
    // cron uses so both integrations render consistently on the health
    // page.
    await prisma.$transaction(async (tx) => {
      for (const m of mailboxes) {
        await writeAudit(tx, {
          actor: { type: 'person', id: actor.id },
          action: 'synced',
          entity: {
            type: 'integration',
            id: 'm365_mail',
            after: {
              mailboxUpn: m.mailboxUpn,
              messagesConsidered: m.messagesConsidered,
              candidatesScanned: m.candidatesScanned,
              billsCreated: m.billsCreated,
              billsSkippedDuplicate: m.billsSkippedDuplicate,
              extractionsFailed: m.extractionsFailed,
              lowConfidenceCount: m.lowConfidenceCount,
              skippedReason: m.skippedReason ?? null,
              errorCount: m.errors.length,
            },
          },
          source: 'integration_sync',
        });
      }
    });

    return NextResponse.json({ mailboxes });
  } catch (err) {
    console.error('[cron/invoice-autoharvest] failed:', err);
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
