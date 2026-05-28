import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSession } from '@/server/session';
import { hasCapability } from '@/server/capabilities';
import { prisma } from '@/server/db';
import { listActivePeopleOptions, listClientOptions } from '@/server/projects';
import { isLeadershipBand } from '@/lib/levels';
import { Badge } from '@/components/ui/badge';
import { NewProjectForm } from './form';

export default async function NewProjectPage({
  searchParams,
}: {
  searchParams: { fromDeal?: string; clientId?: string; kind?: string };
}) {
  const session = await getSession();
  if (!hasCapability(session, 'project.create')) notFound();

  const [clients, people] = await Promise.all([listClientOptions(), listActivePeopleOptions()]);
  // Project primary-partner picker draws from anyone with seniority
  // to own delivery (MP / Partner / Associate Partner). The
  // `isLeadershipBand` helper is shared with resource-planning,
  // availability, etc.
  const partners = people.filter((p) => isLeadershipBand(p.band));

  // Internal-project bootstrapping: resolve the firm's internal client
  // (`FH`) so we can auto-pin newly-created internal projects to it
  // without making the operator pick from the dropdown, and pick the
  // next free FHP code so the form can suggest e.g. "FHP007".
  const fhInternalClient = await prisma.client.findUnique({
    where: { code: 'FH' },
    select: { id: true, legalName: true },
  });
  const lastFhp = await prisma.project.findFirst({
    where: { code: { startsWith: 'FHP' } },
    orderBy: { code: 'desc' },
    select: { code: true },
  });
  const nextFhpCode = (() => {
    const m = lastFhp?.code.match(/^FHP(\d{3})$/);
    if (!m) return 'FHP001';
    const next = Number(m[1]) + 1;
    return `FHP${String(next).padStart(3, '0')}`;
  })();
  // Initial kind — query string lets links jump straight into one
  // branch (e.g. "/projects/new?kind=internal" from the projects
  // kanban). Default `client` matches existing behaviour.
  const initialKind: 'client' | 'internal' =
    searchParams.kind === 'internal' && fhInternalClient ? 'internal' : 'client';

  let prefill: {
    clientId?: string;
    name?: string;
    description?: string;
    contractValueDollars?: number;
    primaryPartnerId?: string;
    dealId?: string;
    dealCode?: string;
    clientLegalName?: string;
  } = {};

  if (searchParams.clientId && !searchParams.fromDeal) {
    const c = await prisma.client.findUnique({
      where: { id: searchParams.clientId },
      select: { id: true, legalName: true },
    });
    if (c) {
      prefill = { clientId: c.id, clientLegalName: c.legalName };
    }
  }

  if (searchParams.fromDeal) {
    const deal = await prisma.deal.findUnique({
      where: { id: searchParams.fromDeal },
      include: {
        client: { select: { id: true, legalName: true } },
      },
    });
    if (deal && !deal.convertedProjectId) {
      prefill = {
        dealId: deal.id,
        dealCode: deal.code,
        name: deal.name ?? undefined,
        ...(deal.notes ? { description: deal.notes } : {}),
        contractValueDollars: deal.expectedValue / 100,
        ...(deal.clientId ? { clientId: deal.clientId } : {}),
        ...(deal.client?.legalName ? { clientLegalName: deal.client.legalName } : {}),
        primaryPartnerId: deal.ownerId,
      };
    }
  }

  return (
    <div className="space-y-6">
      <div className="text-sm">
        <Link href="/projects" className="text-ink-3 hover:text-ink">
          ← Back to Projects
        </Link>
      </div>
      <header>
        <h1 className="text-xl font-semibold text-ink">New project</h1>
        <p className="text-sm text-ink-3">
          Basics + commercials + team. SharePoint folders auto-provision on save; Xero
          tracking category is created on the first invoice or bill push. Milestones are
          editable from the project detail after create.
        </p>
      </header>

      {prefill.dealId && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-status-green bg-status-green-soft px-3 py-2 text-sm text-status-green">
          Pre-filled from deal
          <Badge variant="outline" className="font-mono">
            {prefill.dealCode}
          </Badge>
          <span className="text-ink-2">— review and hit Create to link.</span>
        </div>
      )}

      {clients.length === 0 ? (
        <div className="rounded-lg border border-dashed border-line bg-card p-8 text-center text-sm text-ink-3">
          Create a client first —{' '}
          <Link href="/directory/clients/new" className="text-brand hover:underline">
            New client →
          </Link>
        </div>
      ) : prefill.dealId && !prefill.clientId ? (
        <div className="rounded-lg border border-status-amber bg-status-amber-soft p-4 text-sm text-status-amber">
          This deal is for a prospective org (not yet a client). Create the client record first,
          then come back here —{' '}
          <Link href="/directory/clients/new" className="text-brand hover:underline">
            + New client →
          </Link>
        </div>
      ) : (
        <NewProjectForm
          clients={clients}
          partners={partners}
          managers={people}
          internalClient={fhInternalClient}
          nextFhpCode={nextFhpCode}
          initialKind={initialKind}
          {...(prefill.clientId ||
          prefill.name ||
          prefill.description ||
          prefill.contractValueDollars !== undefined ||
          prefill.primaryPartnerId ||
          prefill.dealId
            ? {
                prefill: {
                  ...(prefill.clientId ? { clientId: prefill.clientId } : {}),
                  ...(prefill.name ? { name: prefill.name } : {}),
                  ...(prefill.description ? { description: prefill.description } : {}),
                  ...(prefill.contractValueDollars !== undefined
                    ? { contractValueDollars: prefill.contractValueDollars }
                    : {}),
                  ...(prefill.primaryPartnerId
                    ? { primaryPartnerId: prefill.primaryPartnerId }
                    : {}),
                  ...(prefill.dealId ? { dealId: prefill.dealId } : {}),
                },
              }
            : {})}
        />
      )}
    </div>
  );
}
