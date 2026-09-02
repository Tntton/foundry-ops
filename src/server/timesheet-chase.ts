import { prisma } from '@/server/db';
import { emitUserUpdateMany } from '@/server/user-updates';
import { addDays, daysInMonth, formatMonthLabel, monthStartFrom } from '@/lib/week';

/**
 * Chasing the approvers who are holding up a contractor's invoice.
 *
 * D2 (TT 2026-08-31) closes a month only when EVERY project in it is
 * approved — which is what gives a contractor one invoice per month instead
 * of one per approver. The cost of that choice is that a single unresponsive
 * lead blocks the contractor's payment indefinitely. This is the mitigation:
 * a daily cron nudges the specific people who owe a decision, escalates to
 * the admin tier if that doesn't land, and TASK-506's force-close gives an
 * admin a documented way through.
 *
 * Intervals are env-configurable rather than hard-coded (A8 pattern). The
 * FeatureFlag table is boolean-only, so it gates whether the job runs at all
 * while the thresholds live in env.
 */

export const CHASE_FLAG_KEY = 'timesheet_chase';

export type ChaseConfig = {
  /** Days after lodging before the first nudge, and between repeats. */
  chaseAfterDays: number;
  /** Days after lodging before the admin tier is pulled in. Fires once. */
  escalateAfterDays: number;
};

export function chaseConfigFromEnv(
  env: Record<string, string | undefined> = process.env,
): ChaseConfig {
  const num = (raw: string | undefined, fallback: number): number => {
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };
  return {
    chaseAfterDays: num(env['TIMESHEET_CHASE_AFTER_DAYS'], 3),
    escalateAfterDays: num(env['TIMESHEET_ESCALATE_AFTER_DAYS'], 7),
  };
}

export type ChaseAction = 'none' | 'chase' | 'escalate';

/**
 * What (if anything) to do about one lodged period right now.
 *
 * Escalation supersedes a plain chase rather than firing alongside it — two
 * notifications about the same month in the same run is how people learn to
 * ignore both.
 */
export function chaseActionFor(
  period: { lodgedAt: Date | null; lastChasedAt: Date | null; escalatedAt: Date | null },
  now: Date,
  cfg: ChaseConfig,
): ChaseAction {
  if (!period.lodgedAt) return 'none';
  const ageDays = (now.getTime() - period.lodgedAt.getTime()) / 86_400_000;

  if (ageDays >= cfg.escalateAfterDays && period.escalatedAt === null) {
    return 'escalate';
  }
  if (ageDays < cfg.chaseAfterDays) return 'none';
  if (period.lastChasedAt === null) return 'chase';

  const sinceChase = (now.getTime() - period.lastChasedAt.getTime()) / 86_400_000;
  return sinceChase >= cfg.chaseAfterDays ? 'chase' : 'none';
}

export type ChaseTarget = {
  periodId: string;
  personId: string;
  personName: string;
  year: number;
  month: number;
  monthLabel: string;
  action: Exclude<ChaseAction, 'none'>;
  ageDays: number;
  /** Projects still awaiting a decision, and who owes each. */
  outstanding: Array<{
    projectCode: string;
    hours: number;
    owedByPersonId: string | null;
  }>;
  outstandingHours: number;
  /** Deduped approver ids to notify. Admin tier included on escalation. */
  recipientIds: string[];
};

/**
 * Find every lodged month that's overdue a decision, with who owes what.
 *
 * Only `submitted` entries count as outstanding — an approved entry isn't
 * blocking anything, and a draft one was sent back, which reopens the period
 * anyway (TASK-502).
 */
export async function findChaseTargets(
  now: Date,
  cfg: ChaseConfig,
): Promise<ChaseTarget[]> {
  const oldestRelevant = addDays(now, -Math.min(cfg.chaseAfterDays, cfg.escalateAfterDays));
  const periods = await prisma.timesheetPeriod.findMany({
    where: { state: 'lodged', lodgedAt: { not: null, lte: oldestRelevant } },
    select: {
      id: true,
      personId: true,
      year: true,
      month: true,
      lodgedAt: true,
      lastChasedAt: true,
      escalatedAt: true,
      person: { select: { firstName: true, lastName: true } },
    },
  });
  if (periods.length === 0) return [];

  const admins = await prisma.person.findMany({
    where: {
      endDate: null,
      inactiveAt: null,
      roles: { hasSome: ['super_admin', 'admin'] },
    },
    select: { id: true },
  });
  const adminIds = admins.map((a) => a.id);

  const targets: ChaseTarget[] = [];
  for (const p of periods) {
    const action = chaseActionFor(p, now, cfg);
    if (action === 'none') continue;

    const start = monthStartFrom(p.year, p.month);
    const end = addDays(start, daysInMonth(p.year, p.month));
    const entries = await prisma.timesheetEntry.findMany({
      where: {
        personId: p.personId,
        date: { gte: start, lt: end },
        status: 'submitted',
      },
      select: {
        hours: true,
        project: {
          select: { code: true, managerId: true, primaryPartnerId: true },
        },
      },
    });
    // Nothing outstanding means the roll-up is stale rather than blocked —
    // leave it alone rather than nudging people about nothing.
    if (entries.length === 0) continue;

    const byProject = new Map<string, ChaseTarget['outstanding'][number]>();
    const owed = new Set<string>();
    for (const e of entries) {
      const cur = byProject.get(e.project.code) ?? {
        projectCode: e.project.code,
        hours: 0,
        owedByPersonId: e.project.managerId ?? e.project.primaryPartnerId,
      };
      cur.hours += Number(e.hours);
      byProject.set(e.project.code, cur);
      if (e.project.managerId) owed.add(e.project.managerId);
      if (e.project.primaryPartnerId) owed.add(e.project.primaryPartnerId);
    }

    // Never nudge someone about their own timesheet, even if they lead the
    // project their hours are on.
    owed.delete(p.personId);
    const recipients = new Set(owed);
    if (action === 'escalate') {
      for (const id of adminIds) {
        if (id !== p.personId) recipients.add(id);
      }
    }

    const outstanding = Array.from(byProject.values()).sort((a, b) =>
      a.projectCode.localeCompare(b.projectCode),
    );
    targets.push({
      periodId: p.id,
      personId: p.personId,
      personName: `${p.person.firstName} ${p.person.lastName}`,
      year: p.year,
      month: p.month,
      monthLabel: formatMonthLabel(start),
      action,
      ageDays: Math.floor((now.getTime() - p.lodgedAt!.getTime()) / 86_400_000),
      outstanding,
      outstandingHours: outstanding.reduce((s, o) => s + o.hours, 0),
      recipientIds: Array.from(recipients),
    });
  }
  return targets;
}

/** Body text for the in-app nudge and the WhatsApp DM. */
export function chaseMessage(t: ChaseTarget): { title: string; body: string } {
  const projects = t.outstanding.map((o) => o.projectCode).join(', ');
  const lead =
    t.action === 'escalate'
      ? `Escalation: ${t.personName}'s ${t.monthLabel} timesheet has been waiting ${t.ageDays} days.`
      : `${t.personName}'s ${t.monthLabel} timesheet has been waiting ${t.ageDays} days.`;
  return {
    title:
      t.action === 'escalate'
        ? `Overdue approval — ${t.personName}, ${t.monthLabel}`
        : `${t.personName}'s ${t.monthLabel} needs your approval`,
    body:
      `${lead} ${t.outstandingHours.toFixed(1)}h still to approve on ${projects}. ` +
      `Their invoice can't be raised until the whole month is approved.`,
  };
}

export type ChaseRunResult = {
  scanned: number;
  chased: number;
  escalated: number;
  notified: number;
};

/**
 * One pass of the chase. Safe to run daily: the interval stamps on the period
 * keep it from emitting a feed row every day for the same stuck month.
 */
export async function runTimesheetChase(
  now: Date,
  cfg: ChaseConfig,
): Promise<ChaseRunResult> {
  const targets = await findChaseTargets(now, cfg);
  let chased = 0;
  let escalated = 0;
  let notified = 0;

  for (const t of targets) {
    if (t.recipientIds.length === 0) continue;
    const { title, body } = chaseMessage(t);
    await prisma.$transaction(async (tx) => {
      await emitUserUpdateMany(tx, t.recipientIds, {
        kind: 'approval_requested',
        title,
        body,
        href: '/timesheet/approve',
        entityType: 'timesheet_period',
        entityId: null,
      });
      await tx.timesheetPeriod.update({
        where: { id: t.periodId },
        data: {
          lastChasedAt: now,
          ...(t.action === 'escalate' ? { escalatedAt: now } : {}),
        },
      });
    });
    notified += t.recipientIds.length;
    if (t.action === 'escalate') escalated += 1;
    else chased += 1;

    // WhatsApp side-channel — best-effort, never allowed to fail the run.
    try {
      const { sendTimesheetApprovalQueueNotice } = await import(
        '@/server/integrations/whatsapp-prompts'
      );
      await sendTimesheetApprovalQueueNotice({
        approverIds: t.recipientIds,
        submitterName: t.personName,
        entryCount: t.outstanding.length,
        totalHours: t.outstandingHours,
        weekLabel: t.monthLabel,
      });
    } catch (err) {
      console.error('[timesheet.chase] whatsapp notice failed:', t.periodId, err);
    }
  }

  return { scanned: targets.length, chased, escalated, notified };
}
