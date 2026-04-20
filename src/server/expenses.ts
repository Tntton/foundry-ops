import { prisma } from '@/server/db';
import type { Session } from '@/server/roles';

export type ExpenseListRow = {
  id: string;
  date: Date;
  amountCents: number;
  gstCents: number;
  category: string;
  vendor: string | null;
  description: string | null;
  status: string;
  project: { id: string; code: string; name: string } | null;
  person: { id: string; initials: string; firstName: string; lastName: string };
};

/**
 * Role-scoped expense list:
 *  - super_admin / admin: see all
 *  - partner: see own + their projects' team expenses
 *  - manager: see own + their projects' expenses (for approval)
 *  - staff: see own only
 */
export async function listExpenses(session: Session, scope: 'mine' | 'all' = 'mine') {
  const personId = session.person.id;
  const roles = session.person.roles;

  const where: Record<string, unknown> = {};
  if (scope === 'mine' || roles.includes('staff') || (roles.includes('manager') && !roles.some((r) => ['super_admin', 'admin', 'partner'].includes(r)))) {
    if (scope === 'mine') {
      where['personId'] = personId;
    } else if (roles.includes('manager')) {
      where['OR'] = [
        { personId },
        { project: { managerId: personId } },
      ];
    } else {
      where['personId'] = personId;
    }
  }

  const rows = await prisma.expense.findMany({
    where,
    orderBy: { date: 'desc' },
    take: 200,
    include: {
      project: { select: { id: true, code: true, name: true } },
      person: { select: { id: true, initials: true, firstName: true, lastName: true } },
    },
  });

  return rows.map<ExpenseListRow>((e) => ({
    id: e.id,
    date: e.date,
    amountCents: e.amount,
    gstCents: e.gst,
    category: e.category,
    vendor: e.vendor,
    description: e.description,
    status: e.status,
    project: e.project,
    person: e.person,
  }));
}
