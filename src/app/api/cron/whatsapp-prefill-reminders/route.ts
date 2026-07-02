import { NextResponse } from 'next/server';
import { requireEnv } from '@/server/env';
import { isWhatsAppConfigured, sendWhatsAppText } from '@/server/integrations/whatsapp';
import {
  listActiveDispatches,
  dueReminder,
  reminderMessage,
  targetRecordExists,
  markDispatchCompleted,
  stampReminderSent,
} from '@/server/whatsapp-prefill-dispatch';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * WhatsApp prefill completion reminders (TASK-128). Vercel Cron hits this
 * via `Authorization: Bearer <CRON_SECRET>` (prod); `?key=` also works in
 * dev. Schedule lives in vercel.json.
 *
 * For each outstanding prefill link:
 *   1. If the target record now exists (they finished, however) → mark
 *      complete, no nudge.
 *   2. Otherwise, if an early or last-call reminder is due, re-send the
 *      link with a browser-trap tip and stamp the reminder timestamp.
 *
 * The reminder is free-form text, which is fine: the person messaged us
 * first to get the link, so we're inside WhatsApp's 24h service window
 * (the link's TTL is also 24h) — no template required.
 *
 * Reply-to-confirm (submitting from WhatsApp) is intentionally NOT here —
 * deferred to a later task with DB verification.
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

  if (!isWhatsAppConfigured()) {
    return NextResponse.json({ skipped: 'whatsapp not configured' }, { status: 200 });
  }

  const now = new Date();
  const active = await listActiveDispatches(now);

  let completed = 0;
  let reminded = 0;
  let failed = 0;

  for (const d of active) {
    try {
      // Already done elsewhere (web form, another entry)? Stop nagging.
      if (await targetRecordExists(d)) {
        await markDispatchCompleted(d.id, now);
        completed += 1;
        continue;
      }
      const which = dueReminder(d, now);
      if (!which) continue;
      await sendWhatsAppText(d.whatsappNumber, reminderMessage(d, which));
      await stampReminderSent(d.id, which, now);
      reminded += 1;
    } catch (err) {
      failed += 1;
      console.error('[cron/whatsapp-prefill-reminders] dispatch failed:', d.id, err);
      // Keep going — one bad row shouldn't stop the batch.
    }
  }

  console.log('[cron/whatsapp-prefill-reminders] ok:', {
    scanned: active.length,
    completed,
    reminded,
    failed,
  });
  return NextResponse.json(
    { scanned: active.length, completed, reminded, failed },
    { status: 200 },
  );
}
