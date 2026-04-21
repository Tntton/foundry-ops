import { prisma } from '@/server/db';

export type RiskRow = {
  id: string;
  title: string;
  severity: string;
  status: string;
  mitigation: string | null;
  createdAt: Date;
  updatedAt: Date;
  project: {
    id: string;
    code: string;
    name: string;
    stage: string;
  };
  owner: {
    id: string;
    initials: string;
    firstName: string;
    lastName: string;
  } | null;
};

export type FirmRisksSummary = {
  totals: {
    total: number;
    open: number;
    mitigating: number;
    closed: number;
    high: number;
    medium: number;
    low: number;
    staleOpenDays: number | null;
  };
  rows: RiskRow[];
};

export type RiskFilter = {
  severity?: 'low' | 'medium' | 'high';
  status?: 'open' | 'mitigating' | 'closed';
  includeArchived?: boolean;
};

const SEVERITY_ORDER: Record<string, number> = {
  high: 0,
  medium: 1,
  low: 2,
};

const STATUS_ORDER: Record<string, number> = {
  open: 0,
  mitigating: 1,
  closed: 2,
};

/**
 * Firm-wide risk roll-up. Defaults exclude closed risks and archived
 * projects (both rare-enough states that including them is opt-in).
 */
export async function listFirmRisks(filter: RiskFilter = {}): Promise<FirmRisksSummary> {
  const risks = await prisma.risk.findMany({
    where: {
      ...(filter.severity ? { severity: filter.severity } : {}),
      ...(filter.status
        ? { status: filter.status }
        : { status: { in: ['open', 'mitigating'] } }),
      project: filter.includeArchived
        ? undefined
        : { stage: { not: 'archived' } },
    },
    orderBy: [{ updatedAt: 'desc' }],
    include: {
      project: { select: { id: true, code: true, name: true, stage: true } },
    },
  });

  // Hydrate owners
  const ownerIds = risks
    .map((r) => r.ownerId)
    .filter((id): id is string => id !== null);
  const owners = ownerIds.length
    ? await prisma.person.findMany({
        where: { id: { in: ownerIds } },
        select: { id: true, initials: true, firstName: true, lastName: true },
      })
    : [];
  const ownerById = new Map(owners.map((o) => [o.id, o]));

  const rows = risks
    .map<RiskRow>((r) => ({
      id: r.id,
      title: r.title,
      severity: r.severity,
      status: r.status,
      mitigation: r.mitigation,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      project: r.project,
      owner: r.ownerId ? ownerById.get(r.ownerId) ?? null : null,
    }))
    // Sort: severity first (high → medium → low), then status (open → mitigating → closed),
    // then most-recently-updated.
    .sort((a, b) => {
      const sa = SEVERITY_ORDER[a.severity] ?? 9;
      const sb = SEVERITY_ORDER[b.severity] ?? 9;
      if (sa !== sb) return sa - sb;
      const la = STATUS_ORDER[a.status] ?? 9;
      const lb = STATUS_ORDER[b.status] ?? 9;
      if (la !== lb) return la - lb;
      return b.updatedAt.getTime() - a.updatedAt.getTime();
    });

  // Totals
  let open = 0,
    mitigating = 0,
    closed = 0;
  let high = 0,
    medium = 0,
    low = 0;
  let oldestOpen: Date | null = null;
  for (const r of rows) {
    if (r.status === 'open') open++;
    else if (r.status === 'mitigating') mitigating++;
    else if (r.status === 'closed') closed++;
    if (r.severity === 'high') high++;
    else if (r.severity === 'medium') medium++;
    else if (r.severity === 'low') low++;
    if (r.status === 'open') {
      if (!oldestOpen || r.createdAt < oldestOpen) oldestOpen = r.createdAt;
    }
  }
  const staleOpenDays = oldestOpen
    ? Math.floor((Date.now() - oldestOpen.getTime()) / (24 * 3600 * 1000))
    : null;

  return {
    totals: {
      total: rows.length,
      open,
      mitigating,
      closed,
      high,
      medium,
      low,
      staleOpenDays,
    },
    rows,
  };
}
