import { prisma } from '@/server/db';
import type { Session } from '@/server/roles';

export type BillListRow = {
  id: string;
  issueDate: Date;
  dueDate: Date;
  supplierName: string;
  supplierInvoiceNumber: string | null;
  category: string;
  amountTotal: number;
  gst: number;
  status: string;
  project: { id: string; code: string; name: string } | null;
};

export async function listBills(session: Session): Promise<BillListRow[]> {
  const canSeeAll = session.person.roles.some((r) =>
    ['super_admin', 'admin', 'partner'].includes(r),
  );

  const rows = await prisma.bill.findMany({
    where: canSeeAll
      ? {}
      : {
          project: {
            OR: [{ managerId: session.person.id }, { primaryPartnerId: session.person.id }],
          },
        },
    orderBy: { issueDate: 'desc' },
    take: 200,
    include: {
      project: { select: { id: true, code: true, name: true } },
    },
  });

  return rows.map((b) => ({
    id: b.id,
    issueDate: b.issueDate,
    dueDate: b.dueDate,
    supplierName: b.supplierName ?? '—',
    supplierInvoiceNumber: b.supplierInvoiceNumber,
    category: b.category,
    amountTotal: b.amountTotal,
    gst: b.gst,
    status: b.status,
    project: b.project,
  }));
}
