import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSession } from '@/server/session';
import { hasCapability } from '@/server/capabilities';
import { prisma } from '@/server/db';
import { TeamEditForm } from './form';

export default async function EditTeamPage({ params }: { params: { code: string } }) {
  const session = await getSession();
  if (!session) notFound();
  if (!hasCapability(session, 'project.edit')) notFound();

  const project = await prisma.project.findUnique({
    where: { code: params.code },
    include: {
      team: {
        include: {
          person: {
            select: { id: true, initials: true, firstName: true, lastName: true, band: true },
          },
        },
      },
    },
  });
  if (!project) notFound();

  const canAll = session.person.roles.some((r) => ['super_admin', 'admin'].includes(r));
  if (!canAll && project.managerId !== session.person.id && project.primaryPartnerId !== session.person.id) {
    notFound();
  }

  const allPeople = await prisma.person.findMany({
    where: { endDate: null },
    orderBy: [{ band: 'asc' }, { lastName: 'asc' }],
    select: { id: true, initials: true, firstName: true, lastName: true, band: true },
  });

  const initialMembers = project.team.map((t) => ({
    personId: t.personId,
    roleOnProject: t.roleOnProject,
    allocationPct: t.allocationPct,
    id: t.person.id,
    initials: t.person.initials,
    firstName: t.person.firstName,
    lastName: t.person.lastName,
    band: t.person.band,
  }));

  return (
    <div className="space-y-6">
      <div className="text-sm">
        <Link href={`/projects/${project.code}`} className="text-ink-3 hover:text-ink">
          ← Back to {project.code}
        </Link>
      </div>
      <header>
        <h1 className="text-xl font-semibold text-ink">Team — {project.name}</h1>
        <p className="text-sm text-ink-3">
          Add or remove people and set allocation %. Changes are audited.
        </p>
      </header>
      <TeamEditForm
        projectId={project.id}
        initialMembers={initialMembers}
        allPeople={allPeople}
      />
    </div>
  );
}
