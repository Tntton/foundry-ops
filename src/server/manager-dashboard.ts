import { prisma } from '@/server/db';
import type { Session } from '@/server/roles';
import { addDays, startOfWeek } from '@/lib/week';
import { computeProjectPnL } from '@/server/projects/pnl';

export type ProjectQcCard = {
  id: string;
  code: string;
  name: string;
  stage: string;
  weekIndex: number; // 1-based weeks elapsed since startDate (clamped)
  weekTotal: number; // total weeks (rounded up); 0 when dates missing
  leadInitials: string;
  teamInitials: string[];
  contractValueCents: number;
  // Headline metrics (4 KPIs the QC card shows)
  progressPct: number; // weeksElapsed / weekTotal × 100, fallback to milestone-driven
  expensePct: number; // (cost.expense + cost.bill) / contractValue × 100
  marginPct: number; // margin / (revenue.invoiced + wip) × 100; null safe
  marginTone: 'green' | 'amber' | 'red';
  expenseTone: 'green' | 'amber' | 'red';
  arOutstandingCents: number;
  // Chips ("3/6 due", "scope creep", "wrapping", "on track" etc.)
  chips: Array<{ label: string; tone: 'neutral' | 'amber' | 'red' | 'green' }>;
  // QC pass — derived: green when no flags
  qcStatus: 'green' | 'amber' | 'red';
  // For the "wk N/M" + lead/team text in the card subtitle
  subtitle: string;
};

export type TeamWeekRow = {
  personId: string;
  initials: string;
  firstName: string;
  lastName: string;
  band: string;
  role: string;
  employment: 'ft' | 'contractor';
  weeklyCapacityHours: number;
  perProject: Record<string, number>; // projectCode → hours
  totalHours: number;
  utilisationPct: number | null;
  timesheetStatus: 'draft' | 'submitted' | 'approved' | 'mixed' | 'missing';
  missingDays: number;
  headshotUrl: string | null;
};

export type ManagerDashboard = {
  context: {
    isManagerScope: boolean; // true when filtered to "my projects"
    canSeeAllFirm: boolean;
    selfInitials: string;
  };
  topStats: {
    projectsLed: number;
    projectsActive: number;
    projectsWrapping: number;
    teamUtilisationPct: number | null;
    teamUtilisationTargetPct: number;
    openRisks: number;
    risksByCategory: { delivery: number; margin: number; timesheet: number; other: number };
    avgMarginPct: number | null;
    marginTargetPct: number;
  };
  projects: ProjectQcCard[];
  teamWeek: {
    weekStart: Date;
    rows: TeamWeekRow[];
    projectColumns: Array<{ id: string; code: string; name: string }>;
  };
  firmOverview: {
    inDelivery: number;
    onTrackCount: number;
    atRiskCount: number;
    offTrackCount: number;
    total: number;
    avgExpenseRatioPct: number | null;
    avgMarginPct: number | null;
    firmUtilisationPct: number | null;
  };
  alerts: Array<{
    id: string;
    severity: 'amber' | 'red';
    title: string;
    body?: string;
    cta?: { label: string; href: string };
  }>;
};

const TARGET_UTILISATION_PCT = 75;
const TARGET_MARGIN_PCT = 30;
const TARGET_EXPENSE_RATIO_PCT = 50;
const BASELINE_HOURS_PER_FTE_WEEK = 38;

function expenseTone(pct: number): 'green' | 'amber' | 'red' {
  if (pct >= 60) return 'red';
  if (pct >= TARGET_EXPENSE_RATIO_PCT) return 'amber';
  return 'green';
}
function marginTone(pct: number | null): 'green' | 'amber' | 'red' {
  if (pct === null) return 'amber';
  if (pct < 15) return 'red';
  if (pct < TARGET_MARGIN_PCT) return 'amber';
  return 'green';
}

function classifyRisk(title: string): 'delivery' | 'margin' | 'timesheet' | 'other' {
  const t = title.toLowerCase();
  if (/(margin|cost overrun|over budget|expense)/.test(t)) return 'margin';
  if (/(deliver|scope|milestone|deadline|qc|qa)/.test(t)) return 'delivery';
  if (/(timesheet|time logging|allocation)/.test(t)) return 'timesheet';
  return 'other';
}

function weeksBetween(start: Date, end: Date): number {
  return Math.max(
    1,
    Math.round((end.getTime() - start.getTime()) / (7 * 24 * 3600 * 1000)),
  );
}

/**
 * Manager-scoped dashboard payload. Filters projects to those the caller
 * leads (manager / primary partner) when scope='mine'; admins/super-admins
 * can flip to firm-wide via scope='all' on the page.
 */
export async function computeManagerDashboard(
  session: Session,
  scope: 'mine' | 'all' = 'mine',
): Promise<ManagerDashboard> {
  const me = session.person.id;
  const roles = session.person.roles;
  const canSeeAllFirm = roles.some((r) =>
    ['super_admin', 'admin', 'partner'].includes(r),
  );
  const isManagerScope = scope === 'mine';

  // Hide the firm-overhead expense buckets (FHB000 / FHO000 / FHX000)
  // from every dashboard surface. They exist as Project rows so
  // expenses can be tagged against them, but they're not real projects
  // and shouldn't show in QC tiles, team-week, or firm-overview.
  // Internal FH projects (FHP000, FHP001+) keep showing — tracked like
  // normal client work.
  const BUCKET_CODES = ['FHB000', 'FHO000', 'FHX000'];

  // ─── My / firm projects ────────────────────────────────────────────────
  const projectWhere = isManagerScope
    ? {
        stage: { not: 'archived' as const },
        OR: [{ managerId: me }, { primaryPartnerId: me }],
        code: { notIn: BUCKET_CODES },
      }
    : {
        stage: { not: 'archived' as const },
        code: { notIn: BUCKET_CODES },
      };

  const projects = await prisma.project.findMany({
    where: projectWhere,
    orderBy: [{ stage: 'asc' }, { code: 'asc' }],
    select: {
      id: true,
      code: true,
      name: true,
      stage: true,
      contractValue: true,
      startDate: true,
      endDate: true,
      managerId: true,
      primaryPartnerId: true,
      manager: { select: { initials: true } },
      primaryPartner: { select: { initials: true } },
      team: {
        select: {
          allocationPct: true,
          person: { select: { id: true, initials: true } },
        },
      },
      milestones: { select: { status: true } },
      risks: {
        where: { status: { in: ['open', 'mitigating'] } },
        select: { id: true, severity: true, status: true, title: true },
      },
    },
  });

  // Per-project P&L + open invoices for AR, run in parallel. On a
  // partner who leads ~10 projects this used to be ~10 sequential
  // round trips; now it's one fan-out.
  const projectIds = projects.map((p) => p.id);
  const [pnlEntries, openInvoices] = await Promise.all([
    Promise.all(projects.map(async (p) => [p.id, await computeProjectPnL(p.id)] as const)),
    prisma.invoice.findMany({
      where: {
        projectId: { in: projectIds },
        status: { in: ['approved', 'sent', 'partial', 'overdue'] },
      },
      select: {
        projectId: true,
        amountTotal: true,
        paymentReceivedAmount: true,
      },
    }),
  ]);
  const pnlByProject = new Map<string, Awaited<ReturnType<typeof computeProjectPnL>>>(pnlEntries);
  const arByProject = new Map<string, number>();
  for (const inv of openInvoices) {
    const out = inv.amountTotal - (inv.paymentReceivedAmount ?? 0);
    arByProject.set(inv.projectId, (arByProject.get(inv.projectId) ?? 0) + out);
  }

  // Timesheet lag: people on each project with no entries this week.
  const weekStart = startOfWeek(new Date());
  const weekEnd = addDays(weekStart, 7);
  const lastTsForLag = await prisma.timesheetEntry.findMany({
    where: {
      projectId: { in: projects.map((p) => p.id) },
      date: { gte: weekStart, lt: weekEnd },
    },
    select: { projectId: true, personId: true },
  });
  const tsKeysThisWeek = new Set(
    lastTsForLag.map((e) => `${e.projectId}:${e.personId}`),
  );

  const cards: ProjectQcCard[] = projects.map((p) => {
    const pnl = pnlByProject.get(p.id)!;
    const totalRev = pnl.revenue.invoiced + pnl.revenue.wip;
    const totalCost = pnl.cost.timesheet + pnl.cost.expense + pnl.cost.bill;
    const exGstCost = pnl.cost.expense + pnl.cost.bill;
    const expensePct =
      p.contractValue > 0
        ? Math.round((exGstCost / p.contractValue) * 100)
        : 0;
    const marginPct =
      totalRev > 0
        ? Math.round((pnl.margin / totalRev) * 100)
        : p.contractValue > 0
          ? Math.round(((p.contractValue - totalCost) / p.contractValue) * 100)
          : null;
    const ar = arByProject.get(p.id) ?? 0;

    // Progress: weeks elapsed / total weeks if dates are set; else milestone
    // delivery ratio if milestones exist; else 0.
    let weekIndex = 0;
    let weekTotal = 0;
    let progressPct = 0;
    if (p.startDate && p.endDate) {
      const total = weeksBetween(p.startDate, p.endDate);
      const elapsed = Math.max(
        0,
        Math.min(total, weeksBetween(p.startDate, new Date())),
      );
      weekIndex = elapsed;
      weekTotal = total;
      progressPct = total > 0 ? Math.round((elapsed / total) * 100) : 0;
    } else if (p.milestones.length > 0) {
      const delivered = p.milestones.filter(
        (m) => m.status === 'delivered' || m.status === 'invoiced',
      ).length;
      progressPct = Math.round((delivered / p.milestones.length) * 100);
    }

    const milestonesDelivered = p.milestones.filter(
      (m) => m.status === 'delivered' || m.status === 'invoiced',
    ).length;
    const milestonesTotal = p.milestones.length;

    const lead = p.primaryPartner.initials;
    const teamInitials = Array.from(
      new Set([
        p.manager.initials,
        ...p.team.map((t) => t.person.initials),
      ]),
    );

    // Build chip set
    const chips: ProjectQcCard['chips'] = [];
    if (milestonesTotal > 0) {
      const dueLabel = `${milestonesDelivered}/${milestonesTotal} ${
        p.stage === 'closing' || p.stage === 'delivery' ? 'delivered' : 'due'
      }`;
      chips.push({ label: dueLabel, tone: 'neutral' });
    }
    // Timesheet lag chip — name initials of any team member missing this week.
    const lagInitials = p.team
      .map((t) => t.person)
      .filter((person) => !tsKeysThisWeek.has(`${p.id}:${person.id}`))
      .map((person) => person.initials);
    if (lagInitials.length > 0 && p.stage !== 'archived') {
      const sample = lagInitials.slice(0, 2).join(', ');
      const more = lagInitials.length > 2 ? ` +${lagInitials.length - 2}` : '';
      chips.push({ label: `timesheet lag ${sample}${more}`, tone: 'amber' });
    }
    // Expense over target
    if (expensePct >= 60) chips.push({ label: 'expert costs over', tone: 'red' });
    // Margin squeeze
    if (marginPct !== null && marginPct < 20)
      chips.push({ label: 'margin squeeze', tone: 'amber' });
    // Scope creep when expense pct is high but progress is also high (rough proxy)
    if (expensePct > 50 && progressPct > 80)
      chips.push({ label: 'scope creep', tone: 'amber' });
    // Final QC chip when stage is closing
    if (p.stage === 'closing') {
      chips.push({ label: 'wrapping', tone: 'neutral' });
    }
    // On-track badge when nothing else is wrong
    if (chips.every((c) => c.tone === 'neutral') && p.stage !== 'archived') {
      chips.push({ label: 'on track', tone: 'green' });
    }

    const qcStatus: ProjectQcCard['qcStatus'] = chips.some((c) => c.tone === 'red')
      ? 'red'
      : chips.some((c) => c.tone === 'amber')
        ? 'amber'
        : 'green';

    return {
      id: p.id,
      code: p.code,
      name: p.name,
      stage: p.stage,
      weekIndex,
      weekTotal,
      leadInitials: lead,
      teamInitials,
      contractValueCents: p.contractValue,
      progressPct,
      expensePct,
      marginPct: marginPct ?? 0,
      marginTone: marginTone(marginPct),
      expenseTone: expenseTone(expensePct),
      arOutstandingCents: ar,
      chips,
      qcStatus,
      subtitle: `wk ${weekIndex || '—'}/${weekTotal || '—'} · lead ${lead}${
        teamInitials.length ? ` · team ${teamInitials.slice(0, 4).join(', ')}` : ''
      }`,
    };
  });

  // ─── Team across my projects · this week ──────────────────────────────
  const teamPersonIds = new Set<string>();
  for (const p of projects) {
    teamPersonIds.add(p.managerId);
    teamPersonIds.add(p.primaryPartnerId);
    for (const t of p.team) teamPersonIds.add(t.person.id);
  }
  const peopleRows = teamPersonIds.size
    ? await prisma.person.findMany({
        where: { id: { in: [...teamPersonIds] } },
        orderBy: [{ band: 'asc' }, { lastName: 'asc' }],
        select: {
          id: true,
          initials: true,
          headshotUrl: true,
          firstName: true,
          lastName: true,
          band: true,
          employment: true,
          fte: true,
        },
      })
    : [];
  const tsThisWeek = teamPersonIds.size
    ? await prisma.timesheetEntry.findMany({
        where: {
          personId: { in: [...teamPersonIds] },
          projectId: { in: projects.map((p) => p.id) },
          date: { gte: weekStart, lt: weekEnd },
        },
        select: {
          personId: true,
          projectId: true,
          date: true,
          hours: true,
          status: true,
        },
      })
    : [];
  const teamMembershipRoleByPerson = new Map<string, string>();
  for (const p of projects) {
    for (const t of p.team) {
      // Role on the most-recently-assigned project — good enough for the table.
      teamMembershipRoleByPerson.set(t.person.id, '');
    }
  }
  // Better: fetch role from team table
  const teamRows = await prisma.projectTeam.findMany({
    where: {
      projectId: { in: projects.map((p) => p.id) },
      personId: { in: [...teamPersonIds] },
    },
    select: { projectId: true, personId: true, roleOnProject: true },
  });
  for (const t of teamRows) {
    teamMembershipRoleByPerson.set(t.personId, t.roleOnProject);
  }
  // Override role text for partner / manager
  const partnerByPerson = new Map<string, string>();
  for (const p of projects) {
    if (p.primaryPartnerId) partnerByPerson.set(p.primaryPartnerId, 'Partner·lead');
    if (p.managerId) {
      const existing = partnerByPerson.get(p.managerId);
      if (!existing) partnerByPerson.set(p.managerId, 'Project manager');
    }
  }

  const teamRowsByPerson: TeamWeekRow[] = peopleRows
    .map((person) => {
      const fte = person.fte !== null ? Number(person.fte) : null;
      const weeklyCapacity =
        person.employment === 'contractor' ||
        person.band === 'Partner' ||
        person.band === 'MP' ||
        person.band === 'Associate_Partner' ||
        person.band === 'Support_Staff'
          ? 0
          : Math.round((fte ?? 1) * BASELINE_HOURS_PER_FTE_WEEK);

      const perProject: Record<string, number> = {};
      let total = 0;
      const days = new Set<string>();
      const statuses = new Set<string>();
      for (const e of tsThisWeek.filter((t) => t.personId === person.id)) {
        const proj = projects.find((p) => p.id === e.projectId);
        if (!proj) continue;
        const hrs = Number(e.hours);
        perProject[proj.code] = (perProject[proj.code] ?? 0) + hrs;
        total += hrs;
        days.add(e.date.toISOString().slice(0, 10));
        statuses.add(e.status);
      }

      // Days expected: 5 (Mon-Fri); missing = 5 - distinct days logged.
      const missingDays = Math.max(0, 5 - days.size);
      let timesheetStatus: TeamWeekRow['timesheetStatus'];
      if (statuses.size === 0) timesheetStatus = 'missing';
      else if (statuses.size === 1)
        timesheetStatus = ([...statuses][0] as TeamWeekRow['timesheetStatus']) ?? 'mixed';
      else timesheetStatus = 'mixed';

      const role =
        partnerByPerson.get(person.id) ??
        (teamMembershipRoleByPerson.get(person.id) || person.band);

      return {
        personId: person.id,
        initials: person.initials,
        firstName: person.firstName,
        lastName: person.lastName,
        band: person.band,
        role,
        employment: person.employment,
        weeklyCapacityHours: weeklyCapacity,
        perProject,
        totalHours: total,
        utilisationPct:
          weeklyCapacity > 0 ? Math.round((total / weeklyCapacity) * 100) : null,
        timesheetStatus,
        missingDays,
        headshotUrl: person.headshotUrl,
      };
    })
    .sort((a, b) => b.totalHours - a.totalHours);

  // ─── Top stats ─────────────────────────────────────────────────────────
  const projectsActive = projects.filter(
    (p) => p.stage === 'kickoff' || p.stage === 'delivery',
  ).length;
  const projectsWrapping = projects.filter((p) => p.stage === 'closing').length;
  const teamUtilisationPct = (() => {
    const cappedRows = teamRowsByPerson.filter((r) => r.weeklyCapacityHours > 0);
    if (cappedRows.length === 0) return null;
    const cap = cappedRows.reduce((s, r) => s + r.weeklyCapacityHours, 0);
    const logged = cappedRows.reduce((s, r) => s + r.totalHours, 0);
    return cap > 0 ? Math.round((logged / cap) * 100) : null;
  })();
  const allRisks = projects.flatMap((p) => p.risks);
  const risksByCategory = { delivery: 0, margin: 0, timesheet: 0, other: 0 };
  for (const r of allRisks) {
    risksByCategory[classifyRisk(r.title)] += 1;
  }
  const avgMarginPct = (() => {
    const m = cards.map((c) => c.marginPct).filter((v) => Number.isFinite(v));
    if (m.length === 0) return null;
    return Math.round(m.reduce((s, x) => s + x, 0) / m.length);
  })();

  // ─── Firm overview (always firm-wide so the sidebar shows context) ────
  const firmProjects = canSeeAllFirm
    ? await prisma.project.findMany({
        where: {
          stage: { not: 'archived' },
          code: { notIn: BUCKET_CODES },
        },
        select: { id: true, stage: true, contractValue: true, risks: { where: { status: { in: ['open', 'mitigating'] } } } },
      })
    : [];
  const firmInDelivery = firmProjects.filter(
    (p) => p.stage === 'kickoff' || p.stage === 'delivery' || p.stage === 'closing',
  ).length;
  const firmAtRisk = firmProjects.filter(
    (p) => p.risks.some((r) => r.severity === 'medium' || r.severity === 'high'),
  ).length;
  const firmOffTrack = firmProjects.filter(
    (p) => p.risks.some((r) => r.severity === 'high'),
  ).length;
  const firmOnTrack = Math.max(0, firmInDelivery - firmAtRisk);

  // ─── Alerts ───────────────────────────────────────────────────────────
  const alerts: ManagerDashboard['alerts'] = [];
  for (const c of cards) {
    if (c.expensePct > TARGET_EXPENSE_RATIO_PCT) {
      alerts.push({
        id: `expense:${c.id}`,
        severity: c.expensePct >= 60 ? 'red' : 'amber',
        title: `${c.code} expense ratio ${c.expensePct}% — above ${TARGET_EXPENSE_RATIO_PCT}% target.`,
        cta: { label: 'Open P&L', href: `/projects/${c.code}` },
      });
    }
  }
  // Roll up timesheet lag into one alert
  const laggers: string[] = [];
  for (const r of teamRowsByPerson) {
    if (r.timesheetStatus === 'missing' || r.missingDays >= 2) {
      laggers.push(`${r.initials} (${r.missingDays}d)`);
    }
  }
  if (laggers.length > 0) {
    alerts.push({
      id: 'ts-lag',
      severity: 'amber',
      title: `${laggers.length} ${laggers.length === 1 ? 'person' : 'people'} missing days this week.`,
      body: laggers.slice(0, 4).join(' · '),
      cta: { label: 'Nudge', href: '/timesheet/approve?tab=history' },
    });
  }

  return {
    context: {
      isManagerScope,
      canSeeAllFirm,
      selfInitials: session.person.initials,
    },
    topStats: {
      projectsLed: projects.length,
      projectsActive,
      projectsWrapping,
      teamUtilisationPct,
      teamUtilisationTargetPct: TARGET_UTILISATION_PCT,
      openRisks: allRisks.length,
      risksByCategory,
      avgMarginPct,
      marginTargetPct: TARGET_MARGIN_PCT,
    },
    projects: cards,
    teamWeek: {
      weekStart,
      rows: teamRowsByPerson,
      projectColumns: projects.map((p) => ({ id: p.id, code: p.code, name: p.name })),
    },
    firmOverview: {
      inDelivery: firmInDelivery,
      onTrackCount: firmOnTrack,
      atRiskCount: firmAtRisk,
      offTrackCount: firmOffTrack,
      total: firmProjects.length,
      avgExpenseRatioPct: cards.length
        ? Math.round(cards.reduce((s, c) => s + c.expensePct, 0) / cards.length)
        : null,
      avgMarginPct,
      firmUtilisationPct: teamUtilisationPct,
    },
    alerts,
  };
}
