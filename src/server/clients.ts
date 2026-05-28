import { prisma } from '@/server/db';

export type ClientProjectSummary = {
  id: string;
  code: string;
  name: string;
  stage: string;
  contractValueCents: number;
};

export type ClientListRow = {
  id: string;
  code: string;
  legalName: string;
  tradingName: string | null;
  /** Stored web domain (e.g. "ifm.com.au") used to fetch the company
   *  logo via Clearbit. Null = inferred at render time. */
  domain: string | null;
  /** Billing contact email; doubles as a domain hint when `domain` is
   *  unset. */
  billingEmail: string | null;
  primaryPartner: {
    id: string;
    initials: string;
    firstName: string;
    lastName: string;
    headshotUrl: string | null;
  } | null;
  archivedAt: Date | null;
  activeProjects: number;
  totalProjects: number;
  contractValueCents: number; // sum across all projects (including archived)
  invoicedCents: number; // gross invoiced (approved/sent/partial/paid/overdue), ex GST
  paidCents: number; // received payments
  arOutstandingCents: number; // open AR (amountTotal - paymentReceivedAmount) for approved/sent/partial/overdue
  projects: ClientProjectSummary[];
};

export async function listClients(
  search?: string,
  opts: { includeArchived?: boolean } = {},
): Promise<ClientListRow[]> {
  const searchFilter = search?.trim()
    ? {
        OR: [
          { code: { contains: search.trim(), mode: 'insensitive' as const } },
          { legalName: { contains: search.trim(), mode: 'insensitive' as const } },
          { tradingName: { contains: search.trim(), mode: 'insensitive' as const } },
        ],
      }
    : null;
  // The FH internal client is now surfaced on its own /directory/company
  // tab — exclude it from the standard /directory/clients list so it
  // doesn't sit alongside paying clients.
  const where = {
    ...(opts.includeArchived ? {} : { archivedAt: null }),
    ...(searchFilter ?? {}),
    code: { not: 'FH' },
  };
  const rows = await prisma.client.findMany({
    where,
    orderBy: { code: 'asc' },
    include: {
      primaryPartner: {
        select: { id: true, initials: true, headshotUrl: true, firstName: true, lastName: true },
      },
      projects: {
        orderBy: { code: 'asc' },
        select: {
          id: true,
          code: true,
          name: true,
          stage: true,
          contractValue: true,
        },
      },
      invoices: {
        select: {
          amountExGst: true,
          amountTotal: true,
          paymentReceivedAmount: true,
          status: true,
        },
      },
    },
  });

  return rows.map((c) => {
    const activeProjects = c.projects.filter(
      (p) => p.stage === 'kickoff' || p.stage === 'delivery' || p.stage === 'closing',
    ).length;
    const contractValue = c.projects.reduce((s, p) => s + p.contractValue, 0);
    const invoicedStatuses = ['approved', 'sent', 'partial', 'paid', 'overdue'];
    const invoiced = c.invoices
      .filter((i) => invoicedStatuses.includes(i.status))
      .reduce((s, i) => s + i.amountExGst, 0);
    const paid = c.invoices.reduce((s, i) => s + (i.paymentReceivedAmount ?? 0), 0);
    const openAr = c.invoices
      .filter((i) => ['approved', 'sent', 'partial', 'overdue'].includes(i.status))
      .reduce((s, i) => s + (i.amountTotal - (i.paymentReceivedAmount ?? 0)), 0);

    return {
      id: c.id,
      code: c.code,
      legalName: c.legalName,
      tradingName: c.tradingName,
      domain: c.domain,
      billingEmail: c.billingEmail,
      archivedAt: c.archivedAt,
      primaryPartner: c.primaryPartner
        ? {
            id: c.primaryPartner.id,
            initials: c.primaryPartner.initials,
            firstName: c.primaryPartner.firstName,
            lastName: c.primaryPartner.lastName,
            headshotUrl: c.primaryPartner.headshotUrl,
          }
        : null,
      activeProjects,
      totalProjects: c.projects.length,
      contractValueCents: contractValue,
      invoicedCents: invoiced,
      paidCents: paid,
      arOutstandingCents: openAr,
      projects: c.projects.map((p) => ({
        id: p.id,
        code: p.code,
        name: p.name,
        stage: p.stage,
        contractValueCents: p.contractValue,
      })),
    };
  });
}

export async function listPartnerOptions() {
  return prisma.person.findMany({
    where: { roles: { has: 'partner' } },
    orderBy: [{ band: 'asc' }, { lastName: 'asc' }],
    select: { id: true, initials: true, headshotUrl: true, firstName: true, lastName: true },
  });
}
