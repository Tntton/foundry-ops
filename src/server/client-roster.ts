import type { InvoiceStatus } from '@prisma/client';
import { prisma } from '@/server/db';

/**
 * Client roster — surfaces every client we've touched, sorted by most
 * recent work, with lifetime + LTM revenue metrics. Drives the client
 * summary list at the bottom of /directory.
 *
 * Definitions:
 *   - lastWorkAt        : MAX(invoice.issueDate) across the client's
 *                         projects, falling back to MAX(project.endDate /
 *                         actualEndDate / startDate). null when neither
 *                         exists (a brand-new client with no project).
 *   - totalRevenueCents : Σ invoice.amountExGst across status ∈
 *                         {approved, sent, partial, paid, overdue}.
 *   - revenueLtmCents   : same, but issueDate within the last 365 days.
 *   - notWorkedInLtm    : true when revenueLtmCents == 0 AND lastWorkAt
 *                         is older than 365 days (or null).
 *
 * Returns rows sorted by lastWorkAt desc — most recent work first.
 * Clients with no work history sink to the bottom.
 */

const INVOICED_STATUSES: InvoiceStatus[] = [
  'approved',
  'sent',
  'partial',
  'paid',
  'overdue',
];

export type ClientRosterProject = {
  id: string;
  code: string;
  name: string;
  stage: string;
};

export type ClientRosterRow = {
  id: string;
  code: string;
  legalName: string;
  clientType: string;
  /** Stored web domain (operator-overridable). Drives the Clearbit
   *  logo fetch; null means we'll infer at render time. */
  domain: string | null;
  /** Optional operator-set billing email — used as a domain hint when
   *  `domain` itself isn't filled in. */
  billingEmail: string | null;
  projects: ClientRosterProject[];
  /** Most recent project (by lastWorkAt-ish heuristic — defaults to the
   *  project with the latest end / actual-end / start date). */
  lastProject: ClientRosterProject | null;
  /** Sum of all approved/sent/paid invoice ex-GST, lifetime. */
  totalRevenueCents: number;
  /** Same, but only invoices issued in the last 365 days. */
  revenueLtmCents: number;
  /** Most recent activity timestamp — see header doc for fallback chain. */
  lastWorkAt: Date | null;
  /** True when there's been no activity in the last 365 days. */
  notWorkedInLtm: boolean;
};

const LTM_MS = 365 * 24 * 60 * 60 * 1000;

function projectDateAnchor(p: {
  startDate: Date | null;
  endDate: Date | null;
  actualEndDate: Date | null;
}): Date | null {
  // Pick the "most recent activity" date for a single project: prefer
  // actualEnd, then endDate (theoretical), then startDate.
  if (p.actualEndDate) return p.actualEndDate;
  if (p.endDate) return p.endDate;
  if (p.startDate) return p.startDate;
  return null;
}

export async function listClientRoster(): Promise<ClientRosterRow[]> {
  // Pull everything needed in three queries to keep within the
  // pgbouncer pool. Clients first (with their projects inline), then
  // invoices + open-deal signals keyed by clientId. Archived clients
  // and the FH internal client are excluded — both surface in their
  // own dedicated tabs (Archived clients via ?archived=1; FH on
  // /directory/company).
  const clients = await prisma.client.findMany({
    where: { archivedAt: null, code: { not: 'FH' } },
    orderBy: { code: 'asc' },
    select: {
      id: true,
      code: true,
      legalName: true,
      clientType: true,
      domain: true,
      billingEmail: true,
      projects: {
        select: {
          id: true,
          code: true,
          name: true,
          stage: true,
          startDate: true,
          endDate: true,
          actualEndDate: true,
        },
      },
    },
  });
  if (clients.length === 0) return [];

  const clientIds = clients.map((c) => c.id);
  const invoices = await prisma.invoice.findMany({
    where: { clientId: { in: clientIds }, status: { in: INVOICED_STATUSES } },
    select: {
      clientId: true,
      issueDate: true,
      amountExGst: true,
    },
  });
  // BD-active = at least one open deal (lead/qualifying/proposal/
  // negotiation) updated in the last 365 days. Counts as activity
  // even when no invoices have been issued yet — keeps relationship
  // clients in the active list while a deal is mid-flight.
  const bdActiveDeals = await prisma.deal.findMany({
    where: {
      clientId: { in: clientIds },
      stage: { in: ['lead', 'qualifying', 'proposal', 'negotiation'] },
      updatedAt: { gte: new Date(Date.now() - LTM_MS) },
    },
    select: { clientId: true },
  });
  const bdActiveByClient = new Set(
    bdActiveDeals.map((d) => d.clientId).filter((x): x is string => x !== null),
  );

  const now = Date.now();
  const ltmCutoff = now - LTM_MS;

  // Aggregate invoices per client.
  type Agg = {
    totalRevenueCents: number;
    revenueLtmCents: number;
    lastInvoiceAt: Date | null;
  };
  const aggByClient = new Map<string, Agg>();
  for (const inv of invoices) {
    const cur = aggByClient.get(inv.clientId) ?? {
      totalRevenueCents: 0,
      revenueLtmCents: 0,
      lastInvoiceAt: null,
    };
    cur.totalRevenueCents += inv.amountExGst;
    if (inv.issueDate.getTime() >= ltmCutoff) {
      cur.revenueLtmCents += inv.amountExGst;
    }
    if (!cur.lastInvoiceAt || inv.issueDate > cur.lastInvoiceAt) {
      cur.lastInvoiceAt = inv.issueDate;
    }
    aggByClient.set(inv.clientId, cur);
  }

  const rows: ClientRosterRow[] = clients.map((c) => {
    const agg =
      aggByClient.get(c.id) ?? {
        totalRevenueCents: 0,
        revenueLtmCents: 0,
        lastInvoiceAt: null,
      };
    // Project anchor — most recent project date on the client.
    let projectAnchor: Date | null = null;
    let lastProject: ClientRosterProject | null = null;
    for (const p of c.projects) {
      const d = projectDateAnchor(p);
      if (d && (!projectAnchor || d > projectAnchor)) {
        projectAnchor = d;
        lastProject = {
          id: p.id,
          code: p.code,
          name: p.name,
          stage: p.stage,
        };
      }
    }
    // lastWorkAt: invoice timestamp wins, then project anchor.
    let lastWorkAt: Date | null = agg.lastInvoiceAt;
    if (!lastWorkAt || (projectAnchor && projectAnchor > lastWorkAt)) {
      lastWorkAt = projectAnchor;
    }
    // Active = invoiced in LTM OR has an open deal updated in LTM
    // (BD signal). The flag is the inverse: dormant when neither
    // applies.
    const bdActive = bdActiveByClient.has(c.id);
    const notWorkedInLtm =
      !bdActive &&
      agg.revenueLtmCents === 0 &&
      (!lastWorkAt || now - lastWorkAt.getTime() > LTM_MS);

    const projectsSlim: ClientRosterProject[] = c.projects.map((p) => ({
      id: p.id,
      code: p.code,
      name: p.name,
      stage: p.stage,
    }));

    return {
      id: c.id,
      code: c.code,
      legalName: c.legalName,
      clientType: c.clientType,
      domain: c.domain,
      billingEmail: c.billingEmail,
      projects: projectsSlim,
      lastProject,
      totalRevenueCents: agg.totalRevenueCents,
      revenueLtmCents: agg.revenueLtmCents,
      lastWorkAt,
      notWorkedInLtm,
    };
  });

  rows.sort((a, b) => {
    // Most recent work first; clients with no work fall to the bottom.
    const aT = a.lastWorkAt?.getTime() ?? -Infinity;
    const bT = b.lastWorkAt?.getTime() ?? -Infinity;
    return bT - aT;
  });

  return rows;
}
