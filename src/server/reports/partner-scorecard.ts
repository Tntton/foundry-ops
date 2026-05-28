import { prisma } from '@/server/db';

export type PartnerContributionTotals = {
  /** Project value (contractValue) × contributionPct, summed across all
   *  projects where this person holds the given role. Active projects
   *  only (stage != archived) — archived projects feed the lifetime
   *  invoiced/margin metrics instead. */
  bdWonValueCents: number;
  ledValueCents: number;
  directlySupportedValueCents: number;
  partiallySupportedValueCents: number;
  /** Project counts for each bucket — useful colour for partners with
   *  one big project vs many small ones. */
  bdWonCount: number;
  ledCount: number;
  directlySupportedCount: number;
  partiallySupportedCount: number;
};

export type PartnerScoreRow = {
  personId: string;
  initials: string;
  firstName: string;
  lastName: string;
  band: string;
  active: boolean;
  /** True for the three full partners (TT / Michael Bonning / Chris
   *  Parker). Drives the Partners vs Associate Partners split on the
   *  scorecard page. */
  isFullPartner: boolean;
  clientsLed: number;
  activeProjects: number;
  totalProjects: number;
  invoicedCents: number; // ex GST, lifetime
  wipCents: number;
  costCents: number;
  marginCents: number;
  marginPct: number | null;
  openDeals: number;
  weightedPipelineCents: number;
  wonDealsYtdCents: number;
  hoursApproved: number;
  decisionsMadeLast30: number;
  headshotUrl: string | null;
  contributions: PartnerContributionTotals;
};

export type PartnerScoreboard = {
  fullPartners: PartnerScoreRow[]; // 3-way split: TT / MB / CP
  associatePartners: PartnerScoreRow[]; // everyone else with role=partner
  totals: {
    activePartners: number;
    invoicedCents: number;
    marginCents: number;
    weightedPipelineCents: number;
    wonDealsYtdCents: number;
    /** Cross-partner sum of contribution-weighted project value. */
    contributionValueCents: number;
  };
};

const INVOICED_STATUSES = ['approved', 'sent', 'partial', 'paid', 'overdue'];
const WIP_STATUSES = ['draft', 'pending_approval'];
const OPEN_DEAL_STAGES = ['lead', 'qualifying', 'proposal', 'negotiation'];

/**
 * One row per Partner / Managing Partner, summarising their book of
 * business. Invoiced + margin accumulate by client leadership (Person is
 * the primary partner on the Client). Deals accumulate by owner. Decisions
 * + timesheets accumulate by personId directly.
 */
export async function computePartnerScoreboard(): Promise<PartnerScoreboard> {
  const partners = await prisma.person.findMany({
    where: {
      OR: [{ roles: { has: 'partner' } }, { roles: { has: 'super_admin' } }],
    },
    orderBy: [{ endDate: 'asc' }, { lastName: 'asc' }],
    select: {
      id: true,
      initials: true,
      headshotUrl: true,
      firstName: true,
      lastName: true,
      band: true,
      endDate: true,
      isFullPartner: true,
    },
  });
  if (partners.length === 0) {
    return {
      fullPartners: [],
      associatePartners: [],
      totals: {
        activePartners: 0,
        invoicedCents: 0,
        marginCents: 0,
        weightedPipelineCents: 0,
        wonDealsYtdCents: 0,
        contributionValueCents: 0,
      },
    };
  }

  const partnerIds = partners.map((p) => p.id);

  // Pull the clients they lead + invoices/projects hanging off those clients.
  const [clients, deals, approvals, timesheet] = await Promise.all([
    prisma.client.findMany({
      where: { primaryPartnerId: { in: partnerIds } },
      select: {
        id: true,
        primaryPartnerId: true,
        projects: {
          select: {
            id: true,
            stage: true,
            contractValue: true,
          },
        },
        invoices: {
          select: {
            amountExGst: true,
            status: true,
            paymentReceivedAmount: true,
            amountTotal: true,
          },
        },
      },
    }),
    prisma.deal.findMany({
      where: { ownerId: { in: partnerIds } },
      select: {
        ownerId: true,
        stage: true,
        expectedValue: true,
        probability: true,
        createdAt: true,
      },
    }),
    prisma.approval.findMany({
      where: {
        decidedById: { in: partnerIds },
        decidedAt: { gte: new Date(Date.now() - 30 * 24 * 3600 * 1000) },
      },
      select: { decidedById: true },
    }),
    prisma.timesheetEntry.groupBy({
      by: ['personId'],
      where: {
        personId: { in: partnerIds },
        status: { in: ['approved', 'billed'] },
      },
      _sum: { hours: true },
    }),
  ]);

  // Partner → accumulator. headshotUrl + isFullPartner are excluded (we
  // read them directly from `partners` when building the final row).
  type Bucket = Omit<
    PartnerScoreRow,
    | 'personId'
    | 'initials'
    | 'firstName'
    | 'lastName'
    | 'band'
    | 'active'
    | 'isFullPartner'
    | 'marginPct'
    | 'headshotUrl'
  > & { projectIds: Set<string> };
  const buckets = new Map<string, Bucket>();
  for (const p of partners) {
    buckets.set(p.id, {
      clientsLed: 0,
      activeProjects: 0,
      totalProjects: 0,
      invoicedCents: 0,
      wipCents: 0,
      costCents: 0,
      marginCents: 0,
      openDeals: 0,
      weightedPipelineCents: 0,
      wonDealsYtdCents: 0,
      hoursApproved: 0,
      decisionsMadeLast30: 0,
      projectIds: new Set<string>(),
      contributions: {
        bdWonValueCents: 0,
        ledValueCents: 0,
        directlySupportedValueCents: 0,
        partiallySupportedValueCents: 0,
        bdWonCount: 0,
        ledCount: 0,
        directlySupportedCount: 0,
        partiallySupportedCount: 0,
      },
    });
  }

  // Pull explicit contribution rows + their project values. Sum each
  // partner's project value × contributionPct into the right bucket.
  // Active-only (archived projects don't show "value" in the
  // forward-looking scorecard view).
  const contributions = await prisma.projectPartnerContribution.findMany({
    where: {
      personId: { in: partnerIds },
      project: { stage: { not: 'archived' } },
    },
    select: {
      personId: true,
      role: true,
      contributionPct: true,
      project: { select: { contractValue: true } },
    },
  });
  for (const c of contributions) {
    const b = buckets.get(c.personId);
    if (!b) continue;
    const valueCents = Math.round(
      (c.project.contractValue * c.contributionPct) / 100,
    );
    if (c.role === 'bd_won') {
      b.contributions.bdWonValueCents += valueCents;
      b.contributions.bdWonCount += 1;
    } else if (c.role === 'led') {
      b.contributions.ledValueCents += valueCents;
      b.contributions.ledCount += 1;
    } else if (c.role === 'directly_supported') {
      b.contributions.directlySupportedValueCents += valueCents;
      b.contributions.directlySupportedCount += 1;
    } else if (c.role === 'partially_supported') {
      b.contributions.partiallySupportedValueCents += valueCents;
      b.contributions.partiallySupportedCount += 1;
    }
  }

  for (const c of clients) {
    const b = buckets.get(c.primaryPartnerId);
    if (!b) continue;
    b.clientsLed += 1;
    for (const p of c.projects) {
      b.totalProjects += 1;
      b.projectIds.add(p.id);
      if (p.stage !== 'archived') b.activeProjects += 1;
    }
    for (const inv of c.invoices) {
      if (INVOICED_STATUSES.includes(inv.status)) {
        b.invoicedCents += inv.amountExGst;
      } else if (WIP_STATUSES.includes(inv.status)) {
        b.wipCents += inv.amountExGst;
      }
    }
  }

  // Cost on partner-led projects — sum timesheet × cost rate + approved
  // expenses + project-coded bills across the projects this partner leads
  // (via their clients).
  const projectIdsAll = [...buckets.values()].flatMap((b) => [...b.projectIds]);
  if (projectIdsAll.length > 0) {
    const [ts, ex, bi] = await Promise.all([
      prisma.timesheetEntry.findMany({
        where: {
          projectId: { in: projectIdsAll },
          status: { in: ['approved', 'billed'] },
        },
        select: {
          projectId: true,
          hours: true,
          person: { select: { rate: true } },
        },
      }),
      prisma.expense.findMany({
        where: {
          projectId: { in: projectIdsAll },
          status: { in: ['approved', 'reimbursed', 'batched_for_payment'] },
        },
        select: { projectId: true, amount: true, gst: true },
      }),
      prisma.bill.findMany({
        where: {
          projectId: { in: projectIdsAll },
          status: { in: ['approved', 'scheduled_for_payment', 'paid'] },
        },
        select: { projectId: true, amountTotal: true, gst: true },
      }),
    ]);
    // Map projectId → partnerId for fast lookup
    const projectToPartner = new Map<string, string>();
    for (const c of clients) {
      for (const p of c.projects) {
        projectToPartner.set(p.id, c.primaryPartnerId);
      }
    }
    for (const t of ts) {
      const pid = projectToPartner.get(t.projectId);
      if (!pid) continue;
      const b = buckets.get(pid);
      if (!b) continue;
      b.costCents += Math.round(Number(t.hours) * (t.person.rate ?? 0));
    }
    for (const e of ex) {
      if (!e.projectId) continue;
      const pid = projectToPartner.get(e.projectId);
      if (!pid) continue;
      const b = buckets.get(pid);
      if (!b) continue;
      b.costCents += e.amount - e.gst;
    }
    for (const bill of bi) {
      if (!bill.projectId) continue;
      const pid = projectToPartner.get(bill.projectId);
      if (!pid) continue;
      const b = buckets.get(pid);
      if (!b) continue;
      b.costCents += bill.amountTotal - bill.gst;
    }
  }

  // Deals (pipeline / won)
  const yearStart = new Date(new Date().getUTCFullYear(), 0, 1);
  for (const d of deals) {
    const b = buckets.get(d.ownerId);
    if (!b) continue;
    if (OPEN_DEAL_STAGES.includes(d.stage)) {
      b.openDeals += 1;
      b.weightedPipelineCents += Math.round(d.expectedValue * (d.probability / 100));
    } else if (d.stage === 'won' && d.createdAt >= yearStart) {
      b.wonDealsYtdCents += d.expectedValue;
    }
  }

  // Approvals decided
  for (const a of approvals) {
    if (!a.decidedById) continue;
    const b = buckets.get(a.decidedById);
    if (!b) continue;
    b.decisionsMadeLast30 += 1;
  }

  // Timesheet hours
  for (const t of timesheet) {
    const b = buckets.get(t.personId);
    if (!b) continue;
    b.hoursApproved = Number(t._sum.hours ?? 0);
  }

  const rows: PartnerScoreRow[] = partners.map((p) => {
    const b = buckets.get(p.id)!;
    const marginCents = b.invoicedCents + b.wipCents - b.costCents;
    const activeRev = b.invoicedCents + b.wipCents;
    const marginPct =
      activeRev > 0 ? Math.round((marginCents / activeRev) * 1000) / 10 : null;
    return {
      personId: p.id,
      initials: p.initials,
      firstName: p.firstName,
      lastName: p.lastName,
      band: p.band,
      active: p.endDate === null,
      isFullPartner: p.isFullPartner,
      clientsLed: b.clientsLed,
      activeProjects: b.activeProjects,
      totalProjects: b.totalProjects,
      invoicedCents: b.invoicedCents,
      wipCents: b.wipCents,
      costCents: b.costCents,
      marginCents,
      marginPct,
      openDeals: b.openDeals,
      weightedPipelineCents: b.weightedPipelineCents,
      wonDealsYtdCents: b.wonDealsYtdCents,
      hoursApproved: b.hoursApproved,
      decisionsMadeLast30: b.decisionsMadeLast30,
      headshotUrl: p.headshotUrl,
      contributions: b.contributions,
    };
  });

  rows.sort((a, b) => b.invoicedCents - a.invoicedCents);

  const fullPartners = rows.filter((r) => r.isFullPartner);
  const associatePartners = rows.filter((r) => !r.isFullPartner);

  const totals = rows.reduce(
    (acc, r) => ({
      activePartners: acc.activePartners + (r.active ? 1 : 0),
      invoicedCents: acc.invoicedCents + r.invoicedCents,
      marginCents: acc.marginCents + r.marginCents,
      weightedPipelineCents: acc.weightedPipelineCents + r.weightedPipelineCents,
      wonDealsYtdCents: acc.wonDealsYtdCents + r.wonDealsYtdCents,
      contributionValueCents:
        acc.contributionValueCents +
        r.contributions.bdWonValueCents +
        r.contributions.ledValueCents +
        r.contributions.directlySupportedValueCents +
        r.contributions.partiallySupportedValueCents,
    }),
    {
      activePartners: 0,
      invoicedCents: 0,
      marginCents: 0,
      weightedPipelineCents: 0,
      wonDealsYtdCents: 0,
      contributionValueCents: 0,
    },
  );

  return { fullPartners, associatePartners, totals };
}
