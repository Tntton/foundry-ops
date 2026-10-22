import { getAppToken, graphConfigured } from '@/server/graph';
import { optionalEnv } from '@/server/env';
import { prisma } from '@/server/db';
import { writeAudit } from '@/server/audit';
import { addDays, startOfWeek, todayInFirmTz } from '@/lib/week';
import { regularHoursForDay } from '@/server/band-supply';

/**
 * Outlook → availability sync (TASK-522).
 *
 * Answers TT gave on 2026-10-23, which this implements literally:
 *   Q1  all-day events plus out-of-office only. A 30-minute standup must
 *       not eat forecast hours, so plain `busy` is ignored.
 *   Q2  fill blanks only — a forecast a human typed is never overwritten.
 *   Q3  read-only. Nothing is ever written back into anyone's calendar.
 *
 * The sync is additive and reversible: it writes rows tagged
 * `source: outlook`, refreshes its own rows when the calendar changes,
 * and deletes them when the event behind them disappears. A human save
 * flips the row to `source: human`, which pins the day permanently.
 *
 * Gated on the `outlook_availability_sync` FeatureFlag and on
 * `graphConfigured()`. Graph failures are collected per person and the
 * run continues — a calendar that can't be read leaves the person's
 * grid exactly as they left it, which is the honest outcome. The one
 * thing this must never do is present an unread calendar as "free".
 */

export const OUTLOOK_SYNC_FLAG_KEY = 'outlook_availability_sync';

/** Firm calendar timezone. Requested via the Graph `Prefer` header so
 *  all-day boundaries land on the firm's calendar days, matching
 *  `todayInFirmTz`. */
export const CALENDAR_TIMEZONE = 'Australia/Sydney';

export type GraphShowAs =
  | 'free'
  | 'tentative'
  | 'busy'
  | 'oof'
  | 'workingElsewhere'
  | 'unknown';

export type GraphCalendarEvent = {
  id: string;
  subject: string | null;
  isAllDay: boolean;
  isCancelled: boolean;
  showAs: GraphShowAs;
  /** Wall-clock in CALENDAR_TIMEZONE, e.g. "2026-10-26T09:00:00.0000000". */
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
};

/**
 * Does this event reduce someone's availability?
 *
 * Out-of-office always does, whatever its length — that is the signal
 * Outlook is actually designed to carry.
 *
 * All-day events count unless they are marked `free`. An all-day event
 * showing as free is almost always a banner (a birthday, a sprint
 * name, a public-holiday feed someone subscribed to) and zeroing a
 * day on one would be wrong far more often than right. That reading
 * is a judgement inside TT's "all-day events plus out-of-office" — if
 * free all-day banners should also block, this is the line to change.
 */
export function blocksAvailability(ev: GraphCalendarEvent): boolean {
  if (ev.isCancelled) return false;
  if (ev.showAs === 'oof') return true;
  return ev.isAllDay && ev.showAs !== 'free';
}

/** The calendar day part of a Graph wall-clock timestamp. */
function dayOf(dateTime: string): string {
  return dateTime.slice(0, 10);
}

/** Hours past midnight, as a float. */
function timeOf(dateTime: string): number {
  const h = Number(dateTime.slice(11, 13));
  const m = Number(dateTime.slice(14, 16));
  if (!Number.isFinite(h) || !Number.isFinite(m)) return 0;
  return h + m / 60;
}

export type DayBlock = {
  /** Whole day gone — an all-day event, or an OOF covering it end to end. */
  allDay: boolean;
  /** Wall-clock hours blocked on this day by timed events. */
  hours: number;
  /** Event subjects, for the audit delta. Never written to the row. */
  labels: string[];
};

/**
 * Fold a person's events into per-day blocks.
 *
 * All-day events in Graph run midnight to midnight with an exclusive
 * end, so a single-day event ends on the following date. Timed events
 * that straddle midnight are split, with the middle days treated as
 * fully blocked.
 *
 * `calendarView` is deliberate: it expands recurrences into
 * occurrences, so a weekly OOF arrives as real dated instances and
 * there is no series master to interpret here.
 */
export function blocksByDay(events: readonly GraphCalendarEvent[]): Map<string, DayBlock> {
  const out = new Map<string, DayBlock>();
  const touch = (iso: string): DayBlock => {
    const cur = out.get(iso) ?? { allDay: false, hours: 0, labels: [] };
    out.set(iso, cur);
    return cur;
  };

  for (const ev of events) {
    if (!blocksAvailability(ev)) continue;
    const label = (ev.subject ?? '').trim() || 'Untitled';
    const startDay = dayOf(ev.start.dateTime);
    const endDay = dayOf(ev.end.dateTime);

    if (ev.isAllDay) {
      // Exclusive end date: 26 → 28 means the 26th and the 27th.
      for (let d = new Date(`${startDay}T00:00:00.000Z`); ; d = addDays(d, 1)) {
        const iso = d.toISOString().slice(0, 10);
        if (iso >= endDay) break;
        const cell = touch(iso);
        cell.allDay = true;
        if (!cell.labels.includes(label)) cell.labels.push(label);
      }
      continue;
    }

    const startHour = timeOf(ev.start.dateTime);
    const endHour = timeOf(ev.end.dateTime);
    if (startDay === endDay) {
      const cell = touch(startDay);
      cell.hours += Math.max(0, endHour - startHour);
      if (!cell.labels.includes(label)) cell.labels.push(label);
      continue;
    }
    // Straddles midnight: first day from start to midnight, whole days
    // in between, last day from midnight to the end time.
    for (let d = new Date(`${startDay}T00:00:00.000Z`); ; d = addDays(d, 1)) {
      const iso = d.toISOString().slice(0, 10);
      if (iso > endDay) break;
      // A midnight end belongs to the previous day. Check BEFORE
      // touching, or the day gets an empty block entry and planSync
      // reads "blocked for 0 hours" as a day worth writing a full
      // forecast row for.
      if (iso === endDay && endHour <= 0) break;
      const cell = touch(iso);
      if (iso === startDay) {
        cell.hours += Math.max(0, 24 - startHour);
      } else if (iso === endDay) {
        cell.hours += endHour;
      } else {
        cell.allDay = true;
      }
      if (!cell.labels.includes(label)) cell.labels.push(label);
    }
  }
  return out;
}

export type ExistingRow = { hours: number; source: 'human' | 'outlook' };

export type SyncPlan = {
  /** Days to create or refresh, with the hours left after the block. */
  writes: Array<{ dateIso: string; hours: number; labels: string[] }>;
  /** Previously-synced days whose calendar event has gone away. */
  deletes: string[];
  /** Days skipped because a human had already forecast them. */
  skippedHuman: string[];
};

/**
 * Decide what the sync should do to one person's horizon. Pure, so the
 * rules are testable without Graph or a database.
 */
export function planSync({
  days,
  blocks,
  existing,
  baselineHoursFor,
}: {
  /** Every dateIso in the horizon, ordered. */
  days: readonly string[];
  blocks: Map<string, DayBlock>;
  existing: Map<string, ExistingRow>;
  /** The person's normal working hours for that day; 0 = not a working day. */
  baselineHoursFor: (dateIso: string) => number;
}): SyncPlan {
  const writes: SyncPlan['writes'] = [];
  const deletes: string[] = [];
  const skippedHuman: string[] = [];

  for (const iso of days) {
    const row = existing.get(iso);
    const block = blocks.get(iso);

    // Q2: a human forecast is untouchable, whatever the calendar says.
    if (row?.source === 'human') {
      if (block) skippedHuman.push(iso);
      continue;
    }

    if (!block) {
      // Our own row with nothing behind it any more — the leave was
      // cancelled or moved. Leaving it would strand a phantom day off
      // in the forecast forever.
      if (row?.source === 'outlook') deletes.push(iso);
      continue;
    }

    // An entry that blocks nothing is not a reason to write a row.
    // Defensive: blocksByDay shouldn't produce one, and a test pins
    // that, but reading "0 hours blocked" as "forecast a full day"
    // is the expensive direction to be wrong in.
    if (!block.allDay && block.hours <= 0) {
      if (row?.source === 'outlook') deletes.push(iso);
      continue;
    }

    const baseline = baselineHoursFor(iso);
    // Not a working day for this person anyway. Writing a 0 here would
    // add noise and, worse, make the day look forecast when it isn't.
    if (baseline <= 0) {
      if (row?.source === 'outlook') deletes.push(iso);
      continue;
    }

    const blocked = block.allDay ? baseline : block.hours;
    const hours = Math.max(0, Math.min(baseline, Math.round(baseline - blocked)));
    if (row?.source === 'outlook' && row.hours === hours) continue; // no-op
    writes.push({ dateIso: iso, hours, labels: block.labels });
  }

  return { writes, deletes, skippedHuman };
}

/** A person's normal hours for a day: their standing schedule when they
 *  have one, otherwise an even FTE spread across Mon–Fri. */
export function baselineHoursForPerson(
  p: {
    fte: unknown;
    regularDaysEnabled: boolean;
    regularMonHours: number;
    regularTueHours: number;
    regularWedHours: number;
    regularThuHours: number;
    regularFriHours: number;
    regularSatHours: number;
    regularSunHours: number;
  },
  d: Date,
): number {
  if (p.regularDaysEnabled) return regularHoursForDay(p, d);
  const dow = d.getUTCDay();
  if (dow === 0 || dow === 6) return 0;
  const fte = Number(p.fte ?? 1);
  return Math.round((Number.isFinite(fte) ? fte : 1) * 38 / 5);
}

/**
 * Token for the calendar reads.
 *
 * An Exchange `ApplicationAccessPolicy` is scoped per *app
 * registration* and governs Mail, Calendars and Contacts together.
 * The existing `Foundry Ops` registration already carries a
 * RestrictAccess policy pinning `Mail.Read` to the two AP-intake
 * mailboxes — so putting `Calendars.Read` on that same registration
 * would force a choice between blocking the calendar sync for
 * everyone outside those two mailboxes and widening mail access to
 * every mailbox in the tenant. Neither is acceptable under A6.
 *
 * So the calendar sync gets its own registration with only
 * `Calendars.Read` and its own policy scoped to the staff group. When
 * `CALENDAR_ENTRA_CLIENT_ID` / `CALENDAR_ENTRA_CLIENT_SECRET` are set
 * we authenticate as that app; otherwise we fall back to the shared
 * credentials, which is fine for a tenant with no mail policy in
 * place but is not the intended production setup. See INTEGRATIONS.md.
 */
let cachedCalendarToken: { token: string; expiresAt: number } | null = null;

export async function getCalendarToken(): Promise<string> {
  const clientId = optionalEnv('CALENDAR_ENTRA_CLIENT_ID');
  const clientSecret = optionalEnv('CALENDAR_ENTRA_CLIENT_SECRET');
  const tenantId = optionalEnv('ENTRA_TENANT_ID');
  if (!clientId || !clientSecret || !tenantId) return getAppToken();

  if (cachedCalendarToken && cachedCalendarToken.expiresAt > Date.now()) {
    return cachedCalendarToken.token;
  }
  const res = await fetch(
    `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        scope: 'https://graph.microsoft.com/.default',
        grant_type: 'client_credentials',
      }),
    },
  );
  if (!res.ok) {
    throw new Error(`Calendar token fetch failed: ${res.status} ${await res.text()}`);
  }
  const json = (await res.json()) as { access_token: string; expires_in: number };
  cachedCalendarToken = {
    token: json.access_token,
    expiresAt: Date.now() + Math.max(60, json.expires_in - 60) * 1000,
  };
  return cachedCalendarToken.token;
}

/**
 * Read one person's calendar over the horizon. Read-only (Q3) — the
 * only Graph verb this integration ever uses is GET.
 */
export async function fetchCalendarView(
  upn: string,
  from: Date,
  to: Date,
): Promise<GraphCalendarEvent[]> {
  const token = await getCalendarToken();
  const params = new URLSearchParams({
    startDateTime: from.toISOString().slice(0, 19),
    endDateTime: to.toISOString().slice(0, 19),
    $select: 'id,subject,isAllDay,isCancelled,showAs,start,end',
    $top: '250',
  });
  const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(upn)}/calendarView?${params}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      // Returns start/end as wall-clock in the firm timezone, so
      // all-day boundaries line up with firm calendar days.
      Prefer: `outlook.timezone="${CALENDAR_TIMEZONE}"`,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`calendarView ${res.status}: ${text.slice(0, 300)}`);
  }
  const json = (await res.json()) as { value?: GraphCalendarEvent[] };
  return json.value ?? [];
}

export type OutlookSyncResult = {
  peopleConsidered: number;
  peopleChanged: number;
  daysWritten: number;
  daysDeleted: number;
  daysSkippedHuman: number;
  failures: Array<{ personId: string; email: string; reason: string }>;
};

/**
 * Run the sync across every active person with a Foundry mailbox.
 *
 * Sequential on purpose: ~12 mailboxes, and Graph throttles per-app.
 * One person's failure is recorded and the run carries on, because a
 * single unreadable calendar should not cost everyone else their sync.
 */
export async function runOutlookAvailabilitySync(
  weeksAhead: number = 6,
  reference: Date = todayInFirmTz(),
): Promise<OutlookSyncResult> {
  const result: OutlookSyncResult = {
    peopleConsidered: 0,
    peopleChanged: 0,
    daysWritten: 0,
    daysDeleted: 0,
    daysSkippedHuman: 0,
    failures: [],
  };
  if (!graphConfigured()) return result;

  const from = startOfWeek(reference);
  const dayCount = weeksAhead * 7;
  const to = addDays(from, dayCount);
  const dayDates = Array.from({ length: dayCount }, (_, i) => addDays(from, i));
  const days = dayDates.map((d) => d.toISOString().slice(0, 10));

  const people = await prisma.person.findMany({
    where: {
      endDate: null,
      inactiveAt: null,
      email: { endsWith: '@foundry.health' },
    },
    select: {
      id: true,
      email: true,
      fte: true,
      regularDaysEnabled: true,
      regularMonHours: true,
      regularTueHours: true,
      regularWedHours: true,
      regularThuHours: true,
      regularFriHours: true,
      regularSatHours: true,
      regularSunHours: true,
    },
  });
  result.peopleConsidered = people.length;

  for (const p of people) {
    let events: GraphCalendarEvent[];
    try {
      events = await fetchCalendarView(p.email, from, to);
    } catch (err) {
      // No mailbox, no consent for this user, or Graph is down. Record
      // it and move on — their grid keeps whatever they last saved.
      result.failures.push({
        personId: p.id,
        email: p.email,
        reason: err instanceof Error ? err.message : String(err),
      });
      continue;
    }

    const rows = await prisma.availabilityForecast.findMany({
      where: { personId: p.id, date: { gte: from, lt: to } },
      select: { date: true, hours: true, source: true },
    });
    const existing = new Map<string, ExistingRow>(
      rows.map((r) => [
        r.date.toISOString().slice(0, 10),
        { hours: r.hours, source: r.source as 'human' | 'outlook' },
      ]),
    );
    const baselineByIso = new Map(
      dayDates.map((d, i) => [days[i]!, baselineHoursForPerson(p, d)]),
    );

    const plan = planSync({
      days,
      blocks: blocksByDay(events),
      existing,
      baselineHoursFor: (iso) => baselineByIso.get(iso) ?? 0,
    });
    result.daysSkippedHuman += plan.skippedHuman.length;
    if (plan.writes.length === 0 && plan.deletes.length === 0) continue;

    // One transaction per person, audit row inside it (A9). The delta
    // carries the event subjects — the reason a day dropped to 4h is
    // worth keeping, but it does not belong in `notes`, where the
    // editor's Monday cell doubles as the week note.
    await prisma.$transaction(async (tx) => {
      for (const w of plan.writes) {
        const date = new Date(`${w.dateIso}T00:00:00.000Z`);
        await tx.availabilityForecast.upsert({
          where: { personId_date: { personId: p.id, date } },
          update: { hours: w.hours, source: 'outlook' },
          create: {
            personId: p.id,
            date,
            hours: w.hours,
            source: 'outlook',
            projectId: null,
          },
        });
      }
      if (plan.deletes.length > 0) {
        await tx.availabilityForecast.deleteMany({
          where: {
            personId: p.id,
            source: 'outlook',
            date: { in: plan.deletes.map((iso) => new Date(`${iso}T00:00:00.000Z`)) },
          },
        });
      }
      await writeAudit(tx, {
        actor: { type: 'system' },
        action: 'synced',
        entity: {
          type: 'availability_forecast',
          id: p.id,
          after: {
            integration: 'outlook_calendar',
            written: plan.writes.map((w) => ({
              date: w.dateIso,
              hours: w.hours,
              because: w.labels,
            })),
            deleted: plan.deletes,
            skippedHumanForecast: plan.skippedHuman,
          },
        },
        source: 'integration_sync',
      });
    });

    result.peopleChanged += 1;
    result.daysWritten += plan.writes.length;
    result.daysDeleted += plan.deletes.length;
  }

  return result;
}
