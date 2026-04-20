import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSession } from '@/server/session';
import { hasCapability } from '@/server/capabilities';
import { prisma } from '@/server/db';
import { ProjectSettingsForm } from './form';

export default async function ProjectSettingsPage({ params }: { params: { code: string } }) {
  const session = await getSession();
  if (!session) notFound();
  if (!hasCapability(session, 'project.edit')) notFound();

  const project = await prisma.project.findUnique({ where: { code: params.code } });
  if (!project) notFound();

  const canAll = session.person.roles.some((r) => ['super_admin', 'admin'].includes(r));
  if (!canAll && project.managerId !== session.person.id && project.primaryPartnerId !== session.person.id) {
    notFound();
  }

  const people = await prisma.person.findMany({
    where: { endDate: null },
    orderBy: [{ band: 'asc' }, { lastName: 'asc' }],
    select: { id: true, initials: true, firstName: true, lastName: true, band: true },
  });
  const partners = people.filter((p) => p.band === 'Partner' || p.band === 'MP');
  const managers = people;

  return (
    <div className="space-y-6">
      <div className="text-sm">
        <Link href={`/projects/${project.code}`} className="text-ink-3 hover:text-ink">
          ← Back to {project.code}
        </Link>
      </div>
      <header>
        <h1 className="text-xl font-semibold text-ink">Settings — {project.name}</h1>
        <p className="text-sm text-ink-3">
          Edit lifecycle, commercials, and leadership. Changes are audited.
        </p>
      </header>
      <ProjectSettingsForm project={project} partners={partners} managers={managers} />
    </div>
  );
}
