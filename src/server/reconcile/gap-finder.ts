/**
 * Reconcile assistant — deterministic gap finder.
 *
 * Runs a fixed set of SQL queries against the schema to surface the
 * highest-leverage data-quality questions a super-admin should answer
 * to "complete" the back end. The agent UI uses this on every page-
 * load so the reconciliation queue is always fresh.
 *
 * Each rule returns one or more `Gap` rows; gaps are scored 1..3 by
 * impact (3 = blocks reporting / billing; 2 = surfaces stale data;
 * 1 = nice-to-have). The agent sorts by impact, then by createdAt
 * descending so the freshest 3-impact items lead.
 *
 * No LLM — these are deterministic rules. The agent layer routes
 * answers from the user back to per-entity update tools.
 */

import { prisma } from '@/server/db';
import { startOfCurrentAuFy } from '@/lib/au-fy';

/** Categories of gap — drives the UI grouping and icon. */
export type GapCategory =
  | 'project'
  | 'deal'
  | 'person'
  | 'client'
  | 'commercial'
  | 'timesheet'
  | 'expense'
  | 'document';

export type Gap = {
  /** Stable key — used to dedupe across renders + as the React key. */
  key: string;
  category: GapCategory;
  impact: 1 | 2 | 3;
  /** Short, action-oriented title (≤80 chars). */
  title: string;
  /** Optional secondary line — context, current value, etc. */
  detail?: string;
  /** Deep link to the relevant page if the user wants to fix it in the
   *  existing UI rather than in the reconcile chat. */
  href?: string;
  /** Entity reference the agent's tools can target — drives single-row
   *  updates from chat answers. */
  entity: {
    type: 'project' | 'deal' | 'person' | 'client';
    id: string;
    code?: string;
    name?: string;
  };
  /** Which field is missing / stale. The chat answer is wired to set
   *  this column when the user provides a value. */
  field: string;
};

/**
 * Run every gap rule and return a single ranked list.
 *
 * Each rule is independent and runs in parallel — adding a new rule
 * means pushing a new query into the Promise.all. Rules return zero
 * or more gaps; the union is filtered to a max cap (300) so the UI
 * stays responsive even on a chaotic dataset.
 */
export async function computeReconcileQueue(): Promise<Gap[]> {
  const fyStart = startOfCurrentAuFy();
  const ninetyDaysAgo = new Date(Date.now() - 90 * 86_400_000);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000);

  const [
    projectsMissingCommercials,
    projectsPastEndNoActual,
    projectsClosingStale,
    projectsNoSharepoint,
    projectsNoTeam,
    projectsNoTimesheet,
    dealsStale,
    dealsNoTargetClose,
    dealsLostNoLessons,
    peopleNoRate,
    peopleNoWhatsApp,
    clientsNoAbn,
  ] = await Promise.all([
    // ─── PROJECTS ────────────────────────────────────────────────────
    // 1. Real projects (not internal FH-*) with no contractValue. Blocks
    //    P&L / margin calculation entirely.
    prisma.project.findMany({
      where: {
        contractValue: 0,
        code: { not: { startsWith: 'FH' } },
        stage: { notIn: ['archived', 'standing', 'benched'] },
      },
      select: { id: true, code: true, name: true },
      take: 50,
    }),
    // 2. Projects past their endDate with no actualEndDate — looks
    //    open but isn't being worked on.
    prisma.project.findMany({
      where: {
        endDate: { lt: new Date() },
        actualEndDate: null,
        stage: { notIn: ['archived', 'standing', 'benched'] },
      },
      select: { id: true, code: true, name: true, endDate: true },
      take: 50,
    }),
    // 3. Projects in `closing` stage for >90 days — should either ship
    //    or archive.
    prisma.project.findMany({
      where: {
        stage: 'closing',
        updatedAt: { lt: ninetyDaysAgo },
      },
      select: { id: true, code: true, name: true, updatedAt: true },
      take: 50,
    }),
    // 4. Real client projects without a SharePoint team folder link.
    //    Blocks the "open project folder" affordance + doc autoharvest.
    prisma.project.findMany({
      where: {
        sharepointFolderUrl: null,
        code: { not: { startsWith: 'FH' } },
        stage: { notIn: ['archived'] },
      },
      select: { id: true, code: true, name: true },
      take: 50,
    }),
    // 7. Active client projects with zero team members. Resourcing /
    //    utilisation is meaningless without team assignments.
    prisma.project.findMany({
      where: {
        code: { not: { startsWith: 'FH' } },
        stage: { in: ['kickoff', 'delivery'] },
        team: { none: {} },
      },
      select: { id: true, code: true, name: true, stage: true },
      take: 50,
    }),
    // 8. Active client projects with zero timesheet entries since FY
    //    start — either they haven't started or no one is logging time.
    prisma.project.findMany({
      where: {
        code: { not: { startsWith: 'FH' } },
        stage: { in: ['kickoff', 'delivery'] },
        timesheetEntries: { none: { date: { gte: fyStart } } },
      },
      select: { id: true, code: true, name: true, stage: true },
      take: 50,
    }),
    // ─── DEALS ───────────────────────────────────────────────────────
    // 9. Open deals untouched for >30 days. BD pipeline rot.
    prisma.deal.findMany({
      where: {
        archivedAt: null,
        stage: { notIn: ['won', 'lost'] },
        OR: [
          { lastConversationAt: { lt: thirtyDaysAgo } },
          { lastConversationAt: null, createdAt: { lt: thirtyDaysAgo } },
        ],
      },
      select: { id: true, code: true, name: true, lastConversationAt: true, createdAt: true, prospectiveName: true },
      take: 50,
    }),
    // 10. Open deals with no targetCloseDate — can't forecast.
    prisma.deal.findMany({
      where: {
        archivedAt: null,
        stage: { notIn: ['won', 'lost'] },
        targetCloseDate: null,
      },
      select: { id: true, code: true, name: true, prospectiveName: true },
      take: 50,
    }),
    // 11. Lost deals without lessonsLearned. Critical for pattern
    //     recognition; we shipped /bd/outcomes for exactly this loop.
    prisma.deal.findMany({
      where: {
        stage: 'lost',
        lessonsLearned: null,
      },
      select: { id: true, code: true, name: true, prospectiveName: true },
      take: 50,
    }),
    // ─── PEOPLE ──────────────────────────────────────────────────────
    // 12. Active staff without a `rate`. Blocks $-accrued + P&L on
    //     timesheet hours.
    prisma.person.findMany({
      where: {
        endDate: null,
        inactiveAt: null,
        rate: 0,
        band: { not: 'Support_Staff' },
      },
      select: { id: true, firstName: true, lastName: true, band: true },
      take: 50,
    }),
    // 13. Partners/admins without a whatsappNumber — the side-channel
    //     approval pings can't reach them.
    prisma.person.findMany({
      where: {
        endDate: null,
        inactiveAt: null,
        whatsappNumber: null,
        roles: { hasSome: ['super_admin', 'admin', 'partner'] },
      },
      select: { id: true, firstName: true, lastName: true, roles: true },
      take: 50,
    }),
    // ─── CLIENTS ─────────────────────────────────────────────────────
    // 15. Clients without ABN — needed for invoice issuance.
    prisma.client.findMany({
      where: {
        abn: null,
        code: { not: { startsWith: 'FH' } },
        archivedAt: null,
      },
      select: { id: true, code: true, legalName: true },
      take: 30,
    }),
  ]);

  const gaps: Gap[] = [];

  for (const p of projectsMissingCommercials) {
    gaps.push({
      key: `commercial:${p.id}`,
      category: 'commercial',
      impact: 3,
      title: `${p.code} has no contract value`,
      detail: 'Margin and P&L can’t compute without it.',
      href: `/projects/${p.code}/settings`,
      entity: { type: 'project', id: p.id, code: p.code, name: p.name },
      field: 'contractValue',
    });
  }
  for (const p of projectsPastEndNoActual) {
    gaps.push({
      key: `actualEnd:${p.id}`,
      category: 'project',
      impact: 2,
      title: `${p.code} is past its end date but never wrapped`,
      detail: `endDate ${p.endDate?.toISOString().slice(0, 10)} · set actualEndDate or move to closing/archived.`,
      href: `/projects/${p.code}/settings`,
      entity: { type: 'project', id: p.id, code: p.code, name: p.name },
      field: 'actualEndDate',
    });
  }
  for (const p of projectsClosingStale) {
    gaps.push({
      key: `closingStale:${p.id}`,
      category: 'project',
      impact: 2,
      title: `${p.code} has been in "closing" for 90+ days`,
      detail: 'Either ship the final invoice and archive, or move back to delivery.',
      href: `/projects/${p.code}`,
      entity: { type: 'project', id: p.id, code: p.code, name: p.name },
      field: 'stage',
    });
  }
  for (const p of projectsNoSharepoint) {
    gaps.push({
      key: `sharepoint:${p.id}`,
      category: 'document',
      impact: 2,
      title: `${p.code} has no SharePoint folder linked`,
      detail: 'Doc autoharvest + "open folder" affordance both depend on this.',
      href: `/projects/${p.code}/settings`,
      entity: { type: 'project', id: p.id, code: p.code, name: p.name },
      field: 'sharepointFolderUrl',
    });
  }
  for (const p of projectsNoTeam) {
    gaps.push({
      key: `team:${p.id}`,
      category: 'project',
      impact: 2,
      title: `${p.code} has no team members`,
      detail: 'Utilisation, resourcing, and timesheet pickers all need at least one.',
      href: `/projects/${p.code}/team/edit`,
      entity: { type: 'project', id: p.id, code: p.code, name: p.name },
      field: 'team',
    });
  }
  for (const p of projectsNoTimesheet) {
    gaps.push({
      key: `timesheet:${p.id}`,
      category: 'timesheet',
      impact: 1,
      title: `${p.code} has no logged hours this FY`,
      detail: 'Either no one’s working on it or no one’s logging time — worth a nudge.',
      href: `/projects/${p.code}`,
      entity: { type: 'project', id: p.id, code: p.code, name: p.name },
      field: 'timesheets',
    });
  }
  for (const d of dealsStale) {
    const last = d.lastConversationAt ?? d.createdAt;
    const days = Math.floor((Date.now() - last.getTime()) / 86_400_000);
    const label = d.name || d.prospectiveName || d.code;
    gaps.push({
      key: `dealStale:${d.id}`,
      category: 'deal',
      impact: 2,
      title: `${label} — ${days}d since last conversation`,
      href: `/bd/${d.id}`,
      entity: { type: 'deal', id: d.id, code: d.code, name: label },
      field: 'lastConversationAt',
    });
  }
  for (const d of dealsNoTargetClose) {
    const label = d.name || d.prospectiveName || d.code;
    gaps.push({
      key: `dealNoClose:${d.id}`,
      category: 'deal',
      impact: 2,
      title: `${label} has no target close date`,
      detail: 'Pipeline forecast can’t weight it without one.',
      href: `/bd/${d.id}`,
      entity: { type: 'deal', id: d.id, code: d.code, name: label },
      field: 'targetCloseDate',
    });
  }
  for (const d of dealsLostNoLessons) {
    const label = d.name || d.prospectiveName || d.code;
    gaps.push({
      key: `dealLessons:${d.id}`,
      category: 'deal',
      impact: 1,
      title: `${label} (lost) has no lessons learned`,
      href: `/bd/outcomes`,
      entity: { type: 'deal', id: d.id, code: d.code, name: label },
      field: 'lessonsLearned',
    });
  }
  for (const p of peopleNoRate) {
    gaps.push({
      key: `rate:${p.id}`,
      category: 'person',
      impact: 3,
      title: `${p.firstName} ${p.lastName} has no cost rate set`,
      detail: 'Timesheet hours can’t accrue $ without it.',
      href: `/directory/people/${p.id}`,
      entity: { type: 'person', id: p.id, name: `${p.firstName} ${p.lastName}` },
      field: 'rate',
    });
  }
  for (const p of peopleNoWhatsApp) {
    gaps.push({
      key: `whatsapp:${p.id}`,
      category: 'person',
      impact: 1,
      title: `${p.firstName} ${p.lastName} has no WhatsApp number`,
      detail: 'Approval pings under $20k can’t reach them.',
      href: `/directory/people/${p.id}`,
      entity: { type: 'person', id: p.id, name: `${p.firstName} ${p.lastName}` },
      field: 'whatsappNumber',
    });
  }
  for (const c of clientsNoAbn) {
    gaps.push({
      key: `abn:${c.id}`,
      category: 'client',
      impact: 2,
      title: `${c.legalName} has no ABN on file`,
      detail: 'Required on every invoice issued to AU clients.',
      href: `/directory/clients/${c.id}`,
      entity: { type: 'client', id: c.id, code: c.code, name: c.legalName },
      field: 'abn',
    });
  }

  // Highest-impact first, then a stable secondary by key so renders
  // don't shuffle between page-loads.
  gaps.sort((a, b) => b.impact - a.impact || a.key.localeCompare(b.key));

  // Cap so a chaotic dataset doesn't ship 5MB to the client.
  return gaps.slice(0, 300);
}

/** Summary header counts so the page can render "47 open · 12 high" at
 *  a glance without re-iterating the whole array client-side. */
export function summariseGaps(gaps: Gap[]): {
  total: number;
  byImpact: Record<1 | 2 | 3, number>;
  byCategory: Record<GapCategory, number>;
} {
  const byImpact: Record<1 | 2 | 3, number> = { 1: 0, 2: 0, 3: 0 };
  const byCategory: Record<GapCategory, number> = {
    project: 0,
    deal: 0,
    person: 0,
    client: 0,
    commercial: 0,
    timesheet: 0,
    expense: 0,
    document: 0,
  };
  for (const g of gaps) {
    byImpact[g.impact] += 1;
    byCategory[g.category] += 1;
  }
  return { total: gaps.length, byImpact, byCategory };
}
