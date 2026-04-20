import { prisma } from '@/server/db';
import type { Session } from '@/server/roles';

export type InvoiceListRow = {
  id: string;
  number: string;
  issueDate: Date;
  dueDate: Date;
  amountTotal: number;
  amountExGst: number;
  gst: number;
  status: string;
  client: { id: string; code: string; legalName: string };
  project: { id: string; code: string; name: string };
};

export async function listInvoices(session: Session): Promise<InvoiceListRow[]> {
  const canSeeAll = session.person.roles.some((r) =>
    ['super_admin', 'admin', 'partner'].includes(r),
  );
  const where = canSeeAll
    ? {}
    : { project: { OR: [{ managerId: session.person.id }, { primaryPartnerId: session.person.id }] } };

  const rows = await prisma.invoice.findMany({
    where,
    orderBy: { issueDate: 'desc' },
    take: 200,
    include: {
      client: { select: { id: true, code: true, legalName: true } },
      project: { select: { id: true, code: true, name: true } },
    },
  });

  return rows.map((i) => ({
    id: i.id,
    number: i.number,
    issueDate: i.issueDate,
    dueDate: i.dueDate,
    amountTotal: i.amountTotal,
    amountExGst: i.amountExGst,
    gst: i.gst,
    status: i.status,
    client: i.client,
    project: i.project,
  }));
}

export async function nextInvoiceNumber(projectCode: string): Promise<string> {
  const existing = await prisma.invoice.findMany({
    where: { number: { startsWith: `${projectCode}-INV-` } },
    select: { number: true },
  });
  let maxSeq = 0;
  for (const e of existing) {
    const m = e.number.match(/-(\d+)$/);
    if (m && m[1]) {
      const n = parseInt(m[1], 10);
      if (Number.isFinite(n) && n > maxSeq) maxSeq = n;
    }
  }
  return `${projectCode}-INV-${String(maxSeq + 1).padStart(2, '0')}`;
}
