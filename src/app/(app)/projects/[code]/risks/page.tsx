import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSession } from '@/server/session';
import { hasCapability } from '@/server/capabilities';
import { prisma } from '@/server/db';
import { RiskRegister } from './register';

export default async function RisksPage({ params }: { params: { code: string } }) {
  const session = await getSession();
  if (!session) notFound();
  if (!hasCapability(session, 'project.edit')) notFound();

  const project = await prisma.project.findUnique({
    where: { code: params.code },
    include: {
      risks: {
        orderBy: [{ status: 'asc' }, { severity: 'desc' }, { createdAt: 'desc' }],
      },
    },
  });
  if (!project) notFound();

  const canAll = session.person.roles.some((r) => ['super_admin', 'admin'].includes(r));
  if (!canAll && project.managerId !== session.person.id && project.primaryPartnerId !== session.person.id) {
    notFound();
  }

  const people = await prisma.person.findMany({
    where: { endDate: null },
    orderBy: [{ band: 'asc' }, { lastName: 'asc' }],
    select: { id: true, initials: true, headshotUrl: true, firstName: true, lastName: true },
  });

  return (
    <div className="space-y-6">
      <div className="text-sm">
        <Link href={`/projects/${project.code}`} className="text-ink-3 hover:text-ink">
          ← Back to {project.code}
        </Link>
      </div>
      <header>
        <h1 className="text-xl font-semibold text-ink">Risks — {project.name}</h1>
        <p className="text-sm text-ink-3">
          Log + track delivery risks. Status and severity update inline.
        </p>
      </header>

      <RiskRegister projectId={project.id} risks={project.risks} people={people} canEdit />
    </div>
  );
}
