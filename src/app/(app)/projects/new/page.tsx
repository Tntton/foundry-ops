import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSession } from '@/server/session';
import { hasCapability } from '@/server/capabilities';
import { prisma } from '@/server/db';
import { listActivePeopleOptions, listClientOptions } from '@/server/projects';
import { Badge } from '@/components/ui/badge';
import { NewProjectForm } from './form';

export default async function NewProjectPage({
  searchParams,
}: {
  searchParams: { fromDeal?: string };
}) {
  const session = await getSession();
  if (!hasCapability(session, 'project.create')) notFound();

  const [clients, people] = await Promise.all([listClientOptions(), listActivePeopleOptions()]);
  const partners = people.filter((p) => p.band === 'Partner' || p.band === 'MP');

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
        name: deal.name,
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
