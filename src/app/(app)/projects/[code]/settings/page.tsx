import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSession } from '@/server/session';
import { hasCapability } from '@/server/capabilities';
import { prisma } from '@/server/db';
import { isLeadershipBand } from '@/lib/levels';
import { ProjectSettingsForm } from './form';
import { ProjectPaperworkPanel } from '../paperwork/panel';

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

  const [people, clients] = await Promise.all([
    prisma.person.findMany({
      where: { endDate: null },
      orderBy: [{ band: 'asc' }, { lastName: 'asc' }],
      select: { id: true, initials: true, headshotUrl: true, firstName: true, lastName: true, band: true },
    }),
    // All clients + their existing project codes, so the form can
    // auto-suggest the next code number per client (CAC001 → CAC002
    // etc.). Including archived clients so a re-coded project that
    // points at an old client still resolves.
    prisma.client.findMany({
      orderBy: { code: 'asc' },
      select: {
        id: true,
        code: true,
        legalName: true,
        projects: { select: { code: true } },
      },
    }),
  ]);
  const partners = people.filter((p) => isLeadershipBand(p.band));
  const managers = people;

  // For each client, figure out the next available sequence number.
  // Pattern: <code><nnn> e.g. CAC001. Strip the prefix, parse number,
  // pick max+1. Skips codes that don't match the pattern (e.g. legacy
  // "IFM001-2" — the suffix breaks parsing; treated as -1 so it
  // doesn't bump the max). Falls back to 1 when no projects yet.
  const clientChoices = clients.map((c) => {
    const used: number[] = [];
    for (const p of c.projects) {
      const m = p.code.match(new RegExp(`^${c.code}(\\d+)$`));
      if (m && m[1]) used.push(parseInt(m[1], 10));
    }
    const next = used.length === 0 ? 1 : Math.max(...used) + 1;
    return {
      id: c.id,
      code: c.code,
      legalName: c.legalName,
      nextNumber: next,
    };
  });

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
      <ProjectSettingsForm
        project={project}
        partners={partners}
        managers={managers}
        clientChoices={clientChoices}
      />

      <section className="space-y-3 rounded-lg border border-line bg-card p-5">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-3">
          Engagement paperwork
        </h2>
        <p className="text-[11px] text-ink-3">
          The CSA is the master agreement with the client; the Work Order
          captures this project&apos;s scope, fees, and expense rules. Changes
          to the project&apos;s contract value, payment terms, or pass-through
          flag flow through to the next generated WO draft.
        </p>
        <ProjectPaperworkPanel
          project={{
            id: project.id,
            code: project.code,
            csaSharepointUrl: project.csaSharepointUrl,
            csaUploadedAt: project.csaUploadedAt,
            workOrderSharepointUrl: project.workOrderSharepointUrl,
            workOrderUploadedAt: project.workOrderUploadedAt,
            workOrderDraftText: project.workOrderDraftText,
            workOrderGeneratedAt: project.workOrderGeneratedAt,
          }}
          canEdit
        />
      </section>
    </div>
  );
}
