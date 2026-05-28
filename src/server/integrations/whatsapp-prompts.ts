import { prisma } from '@/server/db';
import { startOfWeek, addDays } from '@/lib/week';
import { sendWhatsAppText, isWhatsAppConfigured } from './whatsapp';

/**
 * Outbound nudges. Two flavours:
 *
 *   - **Daily timesheet reminder** — every weekday afternoon, ping any
 *     active staff member whose timesheet for the day still has zero
 *     hours logged. Skip on weekends and on inactive / archived people.
 *   - **Weekly availability prompt** — every Sunday evening, ping
 *     permanent staff to confirm next week's availability if no
 *     forecast cells are stored yet.
 *
 * Idempotent — checks `WhatsAppMessage` for the same prompt body sent
 * within the last 18 hours so re-running the scheduler doesn't double-
 * nudge. Returns counts so the caller (cron / admin trigger) can log.
 */

async function ensureConversationFor(personId: string): Promise<string> {
  const conv = await prisma.whatsAppConversation.upsert({
    where: { personId },
    create: { personId, flow: 'idle' },
    update: {},
    select: { id: true },
  });
  return conv.id;
}

async function recentlyPrompted(
  conversationId: string,
  body: string,
  windowHours = 18,
): Promise<boolean> {
  const cutoff = new Date(Date.now() - windowHours * 3600 * 1000);
  const existing = await prisma.whatsAppMessage.findFirst({
    where: {
      conversationId,
      direction: 'outbound',
      receivedAt: { gte: cutoff },
      body,
    },
    select: { id: true },
  });
  return existing !== null;
}

async function send(
  personId: string,
  toPhone: string,
  body: string,
): Promise<boolean> {
  const conversationId = await ensureConversationFor(personId);
  if (await recentlyPrompted(conversationId, body)) return false;
  let providerId: string | null = null;
  let errorMessage: string | null = null;
  try {
    providerId = await sendWhatsAppText(toPhone, body);
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : 'send failed';
    console.error('[whatsapp.prompt]', errorMessage);
  }
  await prisma.whatsAppMessage.create({
    data: {
      conversationId,
      direction: 'outbound',
      providerId,
      toPhone,
      body,
      errorMessage,
    },
  });
  await prisma.whatsAppConversation.update({
    where: { id: conversationId },
    data: { lastOutboundAt: new Date() },
  });
  return errorMessage === null;
}

export async function sendDailyTimesheetPrompts(): Promise<{
  sent: number;
  skipped: number;
}> {
  if (!isWhatsAppConfigured()) return { sent: 0, skipped: 0 };
  const now = new Date();
  const dow = now.getDay();
  // Skip weekends — Meta charges per business-message session, no
  // value in pinging staff who aren't working.
  if (dow === 0 || dow === 6) return { sent: 0, skipped: 0 };
  const todayStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const tomorrow = addDays(todayStart, 1);
  const candidates = await prisma.person.findMany({
    where: {
      endDate: null,
      inactiveAt: null,
      isStaff: true,
      whatsappNumber: { not: null },
    },
    select: { id: true, firstName: true, whatsappNumber: true },
  });
  let sent = 0;
  let skipped = 0;
  for (const p of candidates) {
    if (!p.whatsappNumber) {
      skipped += 1;
      continue;
    }
    const loggedToday = await prisma.timesheetEntry.findFirst({
      where: {
        personId: p.id,
        date: { gte: todayStart, lt: tomorrow },
      },
      select: { id: true },
    });
    if (loggedToday) {
      skipped += 1;
      continue;
    }
    const ok = await send(
      p.id,
      p.whatsappNumber,
      `Hey ${p.firstName} — quick reminder: nothing logged on the timesheet for today yet. Reply with e.g. "log 4h on PROJ001 today" and I'll draft it for you.`,
    );
    if (ok) sent += 1;
    else skipped += 1;
  }
  return { sent, skipped };
}

export async function sendWeeklyAvailabilityPrompts(): Promise<{
  sent: number;
  skipped: number;
}> {
  if (!isWhatsAppConfigured()) return { sent: 0, skipped: 0 };
  const now = new Date();
  const thisMonday = startOfWeek(now);
  const nextMonday = addDays(thisMonday, 7);
  const followingMonday = addDays(nextMonday, 7);

  const candidates = await prisma.person.findMany({
    where: {
      endDate: null,
      inactiveAt: null,
      isStaff: true,
      whatsappNumber: { not: null },
    },
    select: { id: true, firstName: true, whatsappNumber: true },
  });
  let sent = 0;
  let skipped = 0;
  for (const p of candidates) {
    if (!p.whatsappNumber) {
      skipped += 1;
      continue;
    }
    const filled = await prisma.availabilityForecast.findFirst({
      where: {
        personId: p.id,
        date: { gte: nextMonday, lt: followingMonday },
      },
      select: { id: true },
    });
    if (filled) {
      skipped += 1;
      continue;
    }
    const ok = await send(
      p.id,
      p.whatsappNumber,
      `Hi ${p.firstName} — what's your availability for next week? Reply with e.g. "8h Mon–Fri next week" or "Tue 4h, Wed 8h, Thu 8h".`,
    );
    if (ok) sent += 1;
    else skipped += 1;
  }
  return { sent, skipped };
}
