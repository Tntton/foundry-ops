import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSession } from '@/server/session';
import { hasCapability } from '@/server/capabilities';
import { prisma } from '@/server/db';
import { NewBillForm } from './form';

export default async function NewBillPage() {
  const session = await getSession();
  if (!hasCapability(session, 'bill.create')) notFound();

  const [projects, contractors] = await Promise.all([
    prisma.project.findMany({
      where: { stage: { not: 'archived' } },
      orderBy: { code: 'asc' },
      select: { id: true, code: true, name: true },
    }),
    prisma.person.findMany({
      where: { employment: 'contractor', endDate: null },
      orderBy: [{ band: 'asc' }, { lastName: 'asc' }],
      select: { id: true, initials: true, firstName: true, lastName: true },
    }),
  ]);

  return (
    <div className="space-y-6">
      <div className="text-sm">
        <Link href="/bills" className="text-ink-3 hover:text-ink">
          ← Back to Bills
        </Link>
      </div>
      <header>
        <h1 className="text-xl font-semibold text-ink">New bill</h1>
        <p className="text-sm text-ink-3">
          Manual AP entry. Email intake via the AP intake agent lands with TASK-093.
        </p>
      </header>
      <NewBillForm projects={projects} contractors={contractors} />
    </div>
  );
}
