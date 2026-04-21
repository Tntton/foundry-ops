import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { DealStage } from '@prisma/client';
import { getSession } from '@/server/session';
import { hasAnyRole } from '@/server/roles';
import { hasCapability } from '@/server/capabilities';
import { prisma } from '@/server/db';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DealStageForm } from './stage-form';
import { DealNotesForm } from './notes-form';

function formatMoney(cents: number): string {
  if (cents === 0) return '—';
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    maximumFractionDigits: 0,
  }).format(cents / 100);
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
  if (!hasAnyRole(session, ['super_admin', 'admin', 'partner'])) notFound();

  const deal = await prisma.deal.findUnique({
    where: { id: params.id },
    include: {
      client: { select: { id: true, code: true, legalName: true } },
      owner: { select: { id: true, initials: true, firstName: true, lastName: true } },
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
  const weighted = Math.round(deal.expectedValue * (deal.probability / 100));

  return (
    <div className="space-y-6">
      <div className="text-sm">
        <Link href="/bd" className="text-ink-3 hover:text-ink">
          ← Back to BD pipeline
        </Link>
      </div>

      <header className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="font-mono">
              {deal.code}
            </Badge>
            <h1 className="text-xl font-semibold text-ink">{deal.name}</h1>
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
              <Avatar>
                <AvatarFallback>{deal.owner.initials}</AvatarFallback>
              </Avatar>
              <span className="font-medium text-ink">
                {deal.owner.firstName} {deal.owner.lastName}
              </span>
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Timing</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <Row label="Created">{deal.createdAt.toLocaleDateString('en-AU')}</Row>
            <Row label="Target close">
              {deal.targetCloseDate ? deal.targetCloseDate.toLocaleDateString('en-AU') : '—'}
            </Row>
          </CardContent>
        </Card>
      </div>

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
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[120px_1fr] gap-2 py-1">
      <div className="text-ink-3">{label}</div>
      <div className="text-ink">{children}</div>
    </div>
  );
}
