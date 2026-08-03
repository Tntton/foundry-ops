import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { DealStage } from '@prisma/client';
import { getSession } from '@/server/session';
import { hasAnyRole } from '@/server/roles';
import { hasCapability } from '@/server/capabilities';
import { prisma } from '@/server/db';
import { PersonAvatar } from '@/components/person-avatar';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DealStageForm } from './stage-form';
import { DealNotesForm } from './notes-form';
import { DealArchiveControls } from './archive-form';
import { DealContactsPanel } from './contacts-form';
import { DealConversationDatesForm } from './conversation-dates-form';
import { DealEditForm } from './edit-form';

function formatMoney(cents: number): string {
  if (cents === 0) return '—';
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function prettyEnum(v: string | null): string {
  if (!v) return '—';
  return v
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function daysSince(d: Date | null): number | null {
  if (!d) return null;
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86_400_000));
}

const STAGE_VARIANT: Record<DealStage, 'outline' | 'amber' | 'green' | 'blue' | 'red'> = {
  lead: 'outline',
  qualifying: 'amber',
  proposal: 'blue',
  negotiation: 'blue',
  won: 'green',
  lost: 'red',
};

export default async function DealDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const session = await getSession();
  if (!hasAnyRole(session, ['super_admin', 'admin', 'partner', 'associate_partner', 'manager'])) notFound();

  const deal = await prisma.deal.findUnique({
    where: { id: params.id },
    include: {
      client: { select: { id: true, code: true, legalName: true } },
      owner: { select: { id: true, initials: true, headshotUrl: true, firstName: true, lastName: true } },
      contacts: { orderBy: { createdAt: 'asc' } },
    },
  });
  if (!deal) notFound();

  const convertedProject = deal.convertedProjectId
    ? await prisma.project.findUnique({
        where: { id: deal.convertedProjectId },
        select: { id: true, code: true, name: true, stage: true },
      })
    : null;

  const canEdit = hasCapability(session, 'deal.edit');
  const isSuperAdmin = session!.person.roles.includes('super_admin');
  const weighted = Math.round(deal.expectedValue * (deal.probability / 100));

  // Owner + client picklists for the comprehensive edit form. Only fetched
  // when the viewer can edit — read-only viewers don't need them.
  const editOwners = canEdit && !deal.archivedAt
    ? await prisma.person.findMany({
        where: {
          endDate: null,
          roles: { hasSome: ['super_admin', 'admin', 'partner'] },
        },
        orderBy: [{ band: 'asc' }, { lastName: 'asc' }],
        select: { id: true, initials: true, headshotUrl: true, firstName: true, lastName: true },
      })
    : [];
  const editClients = canEdit && !deal.archivedAt
    ? await prisma.client.findMany({
        where: { archivedAt: null },
        orderBy: { code: 'asc' },
        select: { id: true, code: true, legalName: true },
      })
    : [];
  const lastConvDays = daysSince(deal.lastConversationAt);
  const displayName =
    deal.name && deal.name.trim().length > 0
      ? deal.name
      : `${deal.client?.legalName ?? deal.prospectiveName ?? 'Deal'}${
          deal.engagementType ? ' · ' + prettyEnum(deal.engagementType) : ''
        }`;

  return (
    <div className="space-y-6">
      <div className="text-sm">
        <Link href="/bd" className="text-ink-3 hover:text-ink">
          ← Back to BD pipeline
        </Link>
      </div>

      {deal.archivedAt && (
        <div className="rounded-md border border-status-amber bg-status-amber-soft px-3 py-2 text-sm text-status-amber">
          Archived on {deal.archivedAt.toLocaleDateString('en-AU')}. Hidden from the pipeline list.
        </div>
      )}

      <header className="flex items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="font-mono">
              {deal.code}
            </Badge>
            <h1 className="text-xl font-semibold text-ink">{displayName}</h1>
            <Badge variant={STAGE_VARIANT[deal.stage]} className="capitalize">
              {deal.stage}
            </Badge>
          </div>
          <p className="mt-1 text-sm text-ink-3">
            {deal.client ? (
              <Link href={`/directory/clients/${deal.client.id}`} className="hover:underline">
                <span className="font-mono text-xs">{deal.client.code}</span>{' '}
                <span>{deal.client.legalName}</span>
              </Link>
            ) : deal.prospectiveName ? (
              <span className="italic">{deal.prospectiveName} (prospective)</span>
            ) : (
              'No client assigned'
            )}
          </p>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-3">
            {deal.clientType && <span>Client: {prettyEnum(deal.clientType)}</span>}
            {deal.sector && <span>Sector: {prettyEnum(deal.sector)}</span>}
            {deal.engagementType && <span>Engagement: {prettyEnum(deal.engagementType)}</span>}
          </div>
        </div>
        <div className="text-right">
          <div className="text-[11px] uppercase tracking-wide text-ink-3">Weighted</div>
          <div className="text-2xl font-semibold tabular-nums text-ink">
            {formatMoney(weighted)}
          </div>
          <div className="text-xs text-ink-3">
            {formatMoney(deal.expectedValue)} × {deal.probability}%
          </div>
        </div>
      </header>

      {convertedProject && (
        <div className="rounded-md border border-status-green bg-status-green-soft px-3 py-2 text-sm text-status-green">
          Converted to project{' '}
          <Link href={`/projects/${convertedProject.code}`} className="font-mono underline">
            {convertedProject.code}
          </Link>{' '}
          — {convertedProject.name} ({convertedProject.stage})
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Stage</CardTitle>
          </CardHeader>
          <CardContent>
            {canEdit ? (
              <DealStageForm dealId={deal.id} currentStage={deal.stage} />
            ) : (
              <Badge variant={STAGE_VARIANT[deal.stage]} className="capitalize">
                {deal.stage}
              </Badge>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Owner</CardTitle>
          </CardHeader>
          <CardContent>
            <Link
              href={`/directory/people/${deal.owner.id}`}
              className="flex items-center gap-2 hover:text-ink"
            >
              <PersonAvatar
  initials={deal.owner.initials}
  headshotUrl={deal.owner.headshotUrl}
/>
              <span className="font-medium text-ink">
                {deal.owner.firstName} {deal.owner.lastName}
              </span>
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Conversations</CardTitle>
          </CardHeader>
          <CardContent>
            {canEdit ? (
              <DealConversationDatesForm
                dealId={deal.id}
                firstConversationAt={deal.firstConversationAt}
                lastConversationAt={deal.lastConversationAt}
              />
            ) : (
              <div className="space-y-1 text-sm">
                <Row label="First">
                  {deal.firstConversationAt
                    ? deal.firstConversationAt.toLocaleDateString('en-AU')
                    : '—'}
                </Row>
                <Row label="Last">
                  {deal.lastConversationAt
                    ? deal.lastConversationAt.toLocaleDateString('en-AU')
                    : '—'}
                </Row>
              </div>
            )}
            {lastConvDays !== null && (
              <p className="mt-2 text-xs text-ink-3">
                {lastConvDays === 0
                  ? 'Talked today.'
                  : `${lastConvDays} day${lastConvDays === 1 ? '' : 's'} since last conversation.`}
                {lastConvDays > 30 && (
                  <span className="ml-1 text-status-amber">Overdue for follow-up.</span>
                )}
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {canEdit && !deal.archivedAt && (
        <Card>
          <CardHeader>
            <CardTitle>Deal details</CardTitle>
          </CardHeader>
          <CardContent>
            <DealEditForm
              deal={{
                id: deal.id,
                name: deal.name,
                sector: deal.sector,
                clientType: deal.clientType,
                engagementType: deal.engagementType,
                expectedValueCents: deal.expectedValue,
                probabilityPct: deal.probability,
                ownerId: deal.ownerId,
                clientId: deal.clientId,
                prospectiveName: deal.prospectiveName,
                prospectiveProjectDetail: deal.prospectiveProjectDetail,
                targetCloseDateIso: deal.targetCloseDate
                  ? deal.targetCloseDate.toISOString().slice(0, 10)
                  : null,
              }}
              owners={editOwners}
              clients={editClients}
            />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Contacts</CardTitle>
        </CardHeader>
        <CardContent>
          <DealContactsPanel
            dealId={deal.id}
            contacts={deal.contacts.map((c) => ({
              id: c.id,
              name: c.name,
              role: c.role,
              email: c.email,
              phone: c.phone,
              notes: c.notes,
            }))}
            canEdit={canEdit}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Notes</CardTitle>
        </CardHeader>
        <CardContent>
          {canEdit ? (
            <DealNotesForm dealId={deal.id} initialNotes={deal.notes ?? ''} />
          ) : deal.notes ? (
            <p className="whitespace-pre-wrap text-sm text-ink-2">{deal.notes}</p>
          ) : (
            <p className="text-sm text-ink-3">No notes yet.</p>
          )}
        </CardContent>
      </Card>

      {!convertedProject && canEdit && (
        <Card>
          <CardHeader>
            <CardTitle>Convert to project</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-ink-2">
            {deal.clientId ? (
              <>
                <p>
                  Creates a new project pre-filled with this deal&apos;s client, name,
                  expected value (→ contract), owner (→ primary partner), and notes (→
                  description). Marks this deal as Won and links the project back here.
                </p>
                <Link
                  href={`/projects/new?fromDeal=${deal.id}`}
                  className="inline-flex h-9 items-center rounded-md bg-brand px-4 text-sm font-medium text-brand-ink hover:opacity-90"
                >
                  Convert to project →
                </Link>
              </>
            ) : (
              <>
                <p className="text-status-amber">
                  This deal is on a prospective org. Create the client record first, then
                  come back here to convert.
                </p>
                <Link href="/directory/clients/new" className="text-brand hover:underline">
                  + New client →
                </Link>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {canEdit && (
        <Card>
          <CardHeader>
            <CardTitle>Danger zone</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-ink-3">
            <p>
              Archiving hides the deal from the pipeline without losing data. Only
              super-admins can permanently delete, and never when a project is linked.
            </p>
            <DealArchiveControls
              dealId={deal.id}
              isArchived={Boolean(deal.archivedAt)}
              canDelete={isSuperAdmin}
              hasLinkedProject={Boolean(convertedProject)}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[80px_1fr] gap-2 py-0.5">
      <div className="text-ink-3">{label}</div>
      <div className="text-ink">{children}</div>
    </div>
  );
}
