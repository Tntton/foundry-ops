import { prisma } from '@/server/db';

export type ClientListRow = {
  id: string;
  code: string;
  legalName: string;
  tradingName: string | null;
  primaryPartner: { id: string; initials: string; firstName: string; lastName: string } | null;
  activeProjects: number;
  arOutstandingCents: number;
};

export async function listClients(search?: string): Promise<ClientListRow[]> {
  const where = search?.trim()
    ? {
        OR: [
          { code: { contains: search.trim(), mode: 'insensitive' as const } },
          { legalName: { contains: search.trim(), mode: 'insensitive' as const } },
          { tradingName: { contains: search.trim(), mode: 'insensitive' as const } },
        ],
      }
    : {};
  const rows = await prisma.client.findMany({
    where,
    orderBy: { code: 'asc' },
    include: {
      primaryPartner: {
        select: { id: true, initials: true, firstName: true, lastName: true },
      },
      projects: {
        where: { stage: { in: ['kickoff', 'delivery', 'closing'] } },
        select: { id: true },
      },
      invoices: {
        where: { status: { in: ['approved', 'sent', 'partial', 'overdue'] } },
        select: { amountTotal: true, paymentReceivedAmount: true },
      },
    },
  });

  return rows.map((c) => ({
    id: c.id,
    code: c.code,
    legalName: c.legalName,
    tradingName: c.tradingName,
    primaryPartner: c.primaryPartner
      ? {
          id: c.primaryPartner.id,
          initials: c.primaryPartner.initials,
          firstName: c.primaryPartner.firstName,
          lastName: c.primaryPartner.lastName,
        }
      : null,
    activeProjects: c.projects.length,
    arOutstandingCents: c.invoices.reduce(
      (sum, inv) => sum + (inv.amountTotal - (inv.paymentReceivedAmount ?? 0)),
      0,
    ),
  }));
}

export async function listPartnerOptions() {
  return prisma.person.findMany({
    where: { roles: { has: 'partner' } },
    orderBy: [{ band: 'asc' }, { lastName: 'asc' }],
    select: { id: true, initials: true, firstName: true, lastName: true },
  });
}
