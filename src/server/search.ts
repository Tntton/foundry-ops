import { prisma } from '@/server/db';
import type { Session } from '@/server/roles';
import { hasAnyRole } from '@/server/roles';

export type SearchResult = {
  kind: 'project' | 'person' | 'client' | 'invoice' | 'bill' | 'deal';
  id: string;
  label: string; // what users see
  hint?: string; // secondary text (e.g. client name on a project)
  href: string;
};

const MAX_PER_KIND = 5;

/**
 * Global search — returns up to MAX_PER_KIND matches per entity type,
 * role-scoped. Staff see only entities on their projects; managers their
 * own; super_admin / admin / partner see everything.
 *
 * Match strategy: case-insensitive 'contains' on each entity's salient
 * string field(s). Short query (< 2 chars) returns nothing. Query trimmed
 * to first 80 chars so nobody can DOS a regex.
 */
export async function globalSearch(
  q: string,
  session: Session,
): Promise<SearchResult[]> {
  const query = q.trim().slice(0, 80);
  if (query.length < 2) return [];
  const roles = session.person.roles;
  const canSeeAll = hasAnyRole(session, ['super_admin', 'admin', 'partner']);
  const personScope = session.person.id;

  const projectScopeWhere: Record<string, unknown> = canSeeAll
    ? {}
    : roles.includes('manager')
      ? { managerId: personScope }
      : { team: { some: { personId: personScope } } };

  const [projects, people, clients, invoices, bills, deals] = await Promise.all([
    prisma.project.findMany({
      where: {
        AND: [
          projectScopeWhere,
          {
            OR: [
              { code: { contains: query, mode: 'insensitive' } },
              { name: { contains: query, mode: 'insensitive' } },
            ],
          },
        ],
      },
      take: MAX_PER_KIND,
      orderBy: { code: 'asc' },
      select: {
        id: true,
        code: true,
        name: true,
        client: { select: { code: true, legalName: true } },
      },
    }),
    canSeeAll
      ? prisma.person.findMany({
          where: {
            OR: [
              { firstName: { contains: query, mode: 'insensitive' } },
              { lastName: { contains: query, mode: 'insensitive' } },
              { email: { contains: query, mode: 'insensitive' } },
              { initials: { contains: query, mode: 'insensitive' } },
            ],
          },
          take: MAX_PER_KIND,
          orderBy: [{ endDate: 'asc' }, { lastName: 'asc' }],
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            initials: true,
            endDate: true,
          },
        })
      : Promise.resolve([]),
    canSeeAll
      ? prisma.client.findMany({
          where: {
            OR: [
              { code: { contains: query, mode: 'insensitive' } },
              { legalName: { contains: query, mode: 'insensitive' } },
              { tradingName: { contains: query, mode: 'insensitive' } },
            ],
          },
          take: MAX_PER_KIND,
          orderBy: { code: 'asc' },
          select: { id: true, code: true, legalName: true },
        })
      : Promise.resolve([]),
    canSeeAll
      ? prisma.invoice.findMany({
          where: {
            OR: [
              { number: { contains: query, mode: 'insensitive' } },
              { client: { is: { code: { contains: query, mode: 'insensitive' } } } },
            ],
          },
          take: MAX_PER_KIND,
          orderBy: { issueDate: 'desc' },
          select: {
            id: true,
            number: true,
            status: true,
            client: { select: { code: true, legalName: true } },
          },
        })
      : Promise.resolve([]),
    canSeeAll
      ? prisma.bill.findMany({
          where: {
            OR: [
              { supplierName: { contains: query, mode: 'insensitive' } },
              { supplierInvoiceNumber: { contains: query, mode: 'insensitive' } },
            ],
          },
          take: MAX_PER_KIND,
          orderBy: { issueDate: 'desc' },
          select: {
            id: true,
            supplierName: true,
            supplierInvoiceNumber: true,
          },
        })
      : Promise.resolve([]),
    canSeeAll
      ? prisma.deal.findMany({
          where: {
            OR: [
              { code: { contains: query, mode: 'insensitive' } },
              { name: { contains: query, mode: 'insensitive' } },
              { prospectiveName: { contains: query, mode: 'insensitive' } },
            ],
          },
          take: MAX_PER_KIND,
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            code: true,
            name: true,
            stage: true,
          },
        })
      : Promise.resolve([]),
  ]);

  const results: SearchResult[] = [];
  for (const p of projects) {
    results.push({
      kind: 'project',
      id: p.id,
      label: `${p.code} · ${p.name}`,
      hint: p.client.legalName,
      href: `/projects/${p.code}`,
    });
  }
  for (const person of people) {
    results.push({
      kind: 'person',
      id: person.id,
      label: `${person.firstName} ${person.lastName}`,
      hint: person.endDate === null ? person.email : `${person.email} · ended`,
      href: `/directory/people/${person.id}`,
    });
  }
  for (const c of clients) {
    results.push({
      kind: 'client',
      id: c.id,
      label: `${c.code} · ${c.legalName}`,
      href: `/directory/clients/${c.id}`,
    });
  }
  for (const inv of invoices) {
    results.push({
      kind: 'invoice',
      id: inv.id,
      label: inv.number,
      hint: `${inv.client.code} · ${inv.status}`,
      href: `/invoices/${inv.id}`,
    });
  }
  for (const b of bills) {
    results.push({
      kind: 'bill',
      id: b.id,
      label: b.supplierName ?? 'Unnamed bill',
      hint: b.supplierInvoiceNumber ?? undefined,
      href: `/bills/${b.id}`,
    });
  }
  for (const d of deals) {
    results.push({
      kind: 'deal',
      id: d.id,
      label: `${d.code} · ${d.name}`,
      hint: d.stage,
      href: `/bd/${d.id}`,
    });
  }
  return results;
}
