import { prisma } from '@/server/db';

export type ClientConcentrationRow = {
  clientId: string;
  clientCode: string;
  clientLegalName: string;
  invoicedCents: number; // ex GST, approved/sent/partial/paid/overdue
  wipCents: number; // draft + pending_approval invoices, ex GST
  activeProjects: number;
  totalProjects: number;
  sharePct: number; // invoicedCents / firm invoiced total × 100
};

export type ClientConcentration = {
  firmInvoicedCents: number;
  firmWipCents: number;
  clientCount: number;
  rows: ClientConcentrationRow[]; // sorted by invoicedCents desc
  top1Pct: number | null;
  top3Pct: number | null;
  top5Pct: number | null;
  hhi: number | null; // Herfindahl-Hirschman Index (0-10000), standard concentration measure
};

const INVOICED_STATUSES = ['approved', 'sent', 'partial', 'paid', 'overdue'];
const WIP_STATUSES = ['draft', 'pending_approval'];

/**
 * Client concentration / revenue-from-top-N analysis. Runs against the
 * firm-wide invoice book (lifetime) so a single big client's historical
 * share doesn't disappear with a recent lean month.
 *
 * Herfindahl-Hirschman Index (HHI):
 *   sum of squared market shares (each share 0-100)
 *   10000 = single client = maximum concentration
 *   < 1500 = diversified
 *   1500 - 2500 = moderate concentration
 *   > 2500 = high concentration (classic antitrust threshold)
 */
export async function computeClientConcentration(): Promise<ClientConcentration> {
  const clients = await prisma.client.findMany({
    orderBy: { code: 'asc' },
    include: {
      projects: {
        select: { id: true, stage: true },
      },
      invoices: {
        select: { amountExGst: true, status: true },
      },
    },
  });

  const rows: ClientConcentrationRow[] = clients.map((c) => {
    const invoiced = c.invoices
      .filter((i) => INVOICED_STATUSES.includes(i.status))
      .reduce((s, i) => s + i.amountExGst, 0);
    const wip = c.invoices
      .filter((i) => WIP_STATUSES.includes(i.status))
      .reduce((s, i) => s + i.amountExGst, 0);
    return {
      clientId: c.id,
      clientCode: c.code,
      clientLegalName: c.legalName,
      invoicedCents: invoiced,
      wipCents: wip,
      activeProjects: c.projects.filter(
        (p) => p.stage === 'kickoff' || p.stage === 'delivery' || p.stage === 'closing',
      ).length,
      totalProjects: c.projects.length,
      sharePct: 0, // filled in below
    };
  });

  const firmInvoiced = rows.reduce((s, r) => s + r.invoicedCents, 0);
  const firmWip = rows.reduce((s, r) => s + r.wipCents, 0);
  for (const r of rows) {
    r.sharePct =
      firmInvoiced > 0 ? Math.round((r.invoicedCents / firmInvoiced) * 1000) / 10 : 0;
  }
  rows.sort((a, b) => b.invoicedCents - a.invoicedCents);

  const top1Pct = firmInvoiced > 0 ? rows[0]?.sharePct ?? null : null;
  const top3Pct =
    firmInvoiced > 0
      ? Math.round(
          rows.slice(0, 3).reduce((s, r) => s + r.sharePct, 0) * 10,
        ) / 10
      : null;
  const top5Pct =
    firmInvoiced > 0
      ? Math.round(
          rows.slice(0, 5).reduce((s, r) => s + r.sharePct, 0) * 10,
        ) / 10
      : null;

  const hhi =
    firmInvoiced > 0
      ? Math.round(
          rows.reduce((s, r) => s + r.sharePct * r.sharePct, 0),
        )
      : null;

  return {
    firmInvoicedCents: firmInvoiced,
    firmWipCents: firmWip,
    clientCount: rows.length,
    rows,
    top1Pct,
    top3Pct,
    top5Pct,
    hhi,
  };
}
