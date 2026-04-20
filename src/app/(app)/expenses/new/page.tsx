import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSession } from '@/server/session';
import { hasCapability } from '@/server/capabilities';
import { prisma } from '@/server/db';
import { NewExpenseForm } from './form';

export default async function NewExpensePage() {
  const session = await getSession();
  if (!hasCapability(session, 'expense.submit')) notFound();

  // All active projects for the select — users can log expenses against any.
  const projects = await prisma.project.findMany({
    where: { stage: { not: 'archived' } },
    orderBy: { code: 'asc' },
    select: { id: true, code: true, name: true },
  });

  return (
    <div className="space-y-6">
      <div className="text-sm">
        <Link href="/expenses" className="text-ink-3 hover:text-ink">
          ← Back to Expenses
        </Link>
      </div>
      <header>
        <h1 className="text-xl font-semibold text-ink">New expense</h1>
        <p className="text-sm text-ink-3">
          Routes to Admin approval (≤$2k) or Super Admin (&gt;$2k). Reimbursed via next
          pay run.
        </p>
      </header>
      <NewExpenseForm projects={projects} />
    </div>
  );
}
