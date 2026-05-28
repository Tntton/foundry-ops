import type { RecruitStatus, RecruitTargetBand } from '@prisma/client';
import { prisma } from '@/server/db';

/**
 * Recruitment pipeline server helpers — kanban data fetch + lifecycle
 * mutations. Super-admin-gated at the route level; this module assumes
 * the caller has already passed the `recruit.manage` capability check.
 *
 * Per the BD-pipeline pattern: a card lives in exactly one
 * (status, targetBand) bucket, and the kanban renders one column per
 * targetBand for status='active' plus a "Nixed" column showing
 * status='nixed' rows. Converted prospects are hidden from the active
 * board entirely (their hire lives on the Directory now).
 */

export const TARGET_BAND_LABELS: Record<RecruitTargetBand, string> = {
  senior_leader: 'Senior Leaders',
  expert: 'Experts',
  fellow: 'Fellows',
  consultant: 'Consultants',
  analyst: 'Analysts',
};

/** Column order on the kanban — leadership-tier first so the most
 *  senior hires sit at the top-left of the board. Nixed pinned to
 *  the right as a sink for passed-on prospects. */
export const TARGET_BAND_ORDER: readonly RecruitTargetBand[] = [
  'senior_leader',
  'expert',
  'fellow',
  'consultant',
  'analyst',
];

export type RecruitCard = {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  location: string | null;
  targetBand: RecruitTargetBand;
  status: RecruitStatus;
  stage: string | null;
  source: string | null;
  notes: string | null;
  linkedinUrl: string | null;
  cvSharepointUrl: string | null;
  /** Days since the prospect was added — sortable signal for the
   *  card layout (oldest at the top of each column nudges admin
   *  to act on stalled rows). */
  daysInPipeline: number;
  owner: {
    id: string;
    initials: string;
    firstName: string;
    lastName: string;
    headshotUrl: string | null;
  };
  referredBy: {
    id: string;
    initials: string;
    firstName: string;
    lastName: string;
  } | null;
  linkedPersonId: string | null;
  createdAt: Date;
  closedAt: Date | null;
};

export type RecruitBoard = {
  /** Active prospects grouped by targetBand. Order matches
   *  TARGET_BAND_ORDER for the column layout. */
  columns: Array<{
    band: RecruitTargetBand;
    label: string;
    cards: RecruitCard[];
  }>;
  /** The Nixed column — status='nixed' across all bands. Renders as
   *  the rightmost column. Capped at the 30 most recent rows so the
   *  kanban stays scannable; older nixed prospects are still
   *  reachable via the dedicated list view (future). */
  nixed: RecruitCard[];
  /** Top-line counts for the header strip. */
  totalActive: number;
  totalNixed: number;
};

function toCard(row: Awaited<ReturnType<typeof prisma.recruitProspect.findMany>>[number]): RecruitCard {
  const r = row as typeof row & {
    owner: { id: string; initials: string; firstName: string; lastName: string; headshotUrl: string | null };
    referredBy: { id: string; initials: string; firstName: string; lastName: string } | null;
  };
  const ageMs = Date.now() - r.createdAt.getTime();
  return {
    id: r.id,
    firstName: r.firstName,
    lastName: r.lastName,
    email: r.email,
    location: r.location,
    targetBand: r.targetBand,
    status: r.status,
    stage: r.stage,
    source: r.source,
    notes: r.notes,
    linkedinUrl: r.linkedinUrl,
    cvSharepointUrl: r.cvSharepointUrl,
    daysInPipeline: Math.floor(ageMs / 86_400_000),
    owner: {
      id: r.owner.id,
      initials: r.owner.initials,
      firstName: r.owner.firstName,
      lastName: r.owner.lastName,
      headshotUrl: r.owner.headshotUrl,
    },
    referredBy: r.referredBy
      ? {
          id: r.referredBy.id,
          initials: r.referredBy.initials,
          firstName: r.referredBy.firstName,
          lastName: r.referredBy.lastName,
        }
      : null,
    linkedPersonId: r.linkedPersonId,
    createdAt: r.createdAt,
    closedAt: r.closedAt,
  };
}

/**
 * Fetch the full recruitment board for the kanban view. Optional
 * `ownerId` filter scopes the board to a specific partner's
 * prospects (their "my pipeline" view). Without it, the board shows
 * every active + nixed prospect across the firm.
 */
export async function getRecruitBoard(filter?: {
  ownerId?: string;
}): Promise<RecruitBoard> {
  const baseWhere = filter?.ownerId ? { ownerId: filter.ownerId } : {};
  const [active, nixed] = await Promise.all([
    prisma.recruitProspect.findMany({
      where: { ...baseWhere, status: 'active' },
      orderBy: [{ createdAt: 'asc' }],
      include: {
        owner: {
          select: { id: true, initials: true, firstName: true, lastName: true, headshotUrl: true },
        },
        referredBy: {
          select: { id: true, initials: true, firstName: true, lastName: true },
        },
      },
    }),
    prisma.recruitProspect.findMany({
      where: { ...baseWhere, status: 'nixed' },
      orderBy: [{ closedAt: 'desc' }],
      take: 30,
      include: {
        owner: {
          select: { id: true, initials: true, firstName: true, lastName: true, headshotUrl: true },
        },
        referredBy: {
          select: { id: true, initials: true, firstName: true, lastName: true },
        },
      },
    }),
  ]);

  const activeCards = active.map(toCard);
  const cardsByBand = new Map<RecruitTargetBand, RecruitCard[]>();
  for (const band of TARGET_BAND_ORDER) cardsByBand.set(band, []);
  for (const c of activeCards) {
    cardsByBand.get(c.targetBand)?.push(c);
  }

  return {
    columns: TARGET_BAND_ORDER.map((band) => ({
      band,
      label: TARGET_BAND_LABELS[band],
      cards: cardsByBand.get(band) ?? [],
    })),
    nixed: nixed.map(toCard),
    totalActive: activeCards.length,
    totalNixed: nixed.length,
  };
}

/**
 * Single-row fetch for the detail page.
 */
export async function getRecruit(id: string): Promise<RecruitCard | null> {
  const row = await prisma.recruitProspect.findUnique({
    where: { id },
    include: {
      owner: {
        select: { id: true, initials: true, firstName: true, lastName: true, headshotUrl: true },
      },
      referredBy: {
        select: { id: true, initials: true, firstName: true, lastName: true },
      },
    },
  });
  return row ? toCard(row) : null;
}
