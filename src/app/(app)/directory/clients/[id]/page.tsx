import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSession } from '@/server/session';
import { hasAnyRole } from '@/server/roles';
import { hasCapability } from '@/server/capabilities';
import { prisma } from '@/server/db';
import { PersonAvatar } from '@/components/person-avatar';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { XeroSyncClientButton } from './xero-sync-button';
import { DeleteClientButton } from './delete-dialog';
import { ClientArchiveControls } from './archive-controls';

function formatMoney(cents: number): string {
  if (cents === 0) return '—';
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

const STAGE_VARIANT: Record<string, 'amber' | 'green' | 'blue' | 'outline'> = {
  kickoff: 'amber',
  delivery: 'green',
  closing: 'blue',
  archived: 'outline',
};
const INVOICE_STATUS_VARIANT: Record<
  string,
  'outline' | 'amber' | 'green' | 'blue' | 'red'
> = {
  draft: 'outline',
  pending_approval: 'amber',
  approved: 'blue',
  sent: 'blue',
  partial: 'amber',
  paid: 'green',
  overdue: 'red',
  written_off: 'outline',
};

export default async function ClientDetailPage({ params }: { params: { id: string } }) {
  const session = await getSession();
  if (!hasAnyRole(session, ['super_admin', 'admin', 'partner'])) notFound();

  const client = await prisma.client.findUnique({
    where: { id: params.id },
    include: {
      primaryPartner: {
        select: { id: true, initials: true, headshotUrl: true, firstName: true, lastName: true },
      },
      projects: {
        orderBy: { code: 'asc' },
        select: {
          id: true,
          code: true,
          name: true,
          stage: true,
          contractValue: true,
          startDate: true,
          endDate: true,
          actualEndDate: true,
        },
      },
      invoices: {
        orderBy: { issueDate: 'desc' },
        select: {
          id: true,
          number: true,
          issueDate: true,
          dueDate: true,
          amountExGst: true,
          amountTotal: true,
          gst: true,
          paymentReceivedAmount: true,
          status: true,
          project: { select: { code: true } },
        },
      },
    },
  });
  if (!client) notFound();

  const canDelete = hasCapability(session, 'client.delete');
  const canEdit = hasCapability(session, 'client.edit');
  const canCreateProject = hasCapability(session, 'project.create');

  // Analytics matching the list-view card.
  const activeProjects = client.projects.filter(
    (p) => p.stage === 'kickoff' || p.stage === 'delivery' || p.stage === 'closing',
  ).length;
  const contractValue = client.projects.reduce((s, p) => s + p.contractValue, 0);
  const invoicedStatuses = ['approved', 'sent', 'partial', 'paid', 'overdue'];
  const invoicedCents = client.invoices
    .filter((i) => invoicedStatuses.includes(i.status))
    .reduce((s, i) => s + i.amountExGst, 0);
  const paidCents = client.invoices.reduce(
    (s, i) => s + (i.paymentReceivedAmount ?? 0),
    0,
  );
  const arOutstandingCents = client.invoices
    .filter((i) => ['approved', 'sent', 'partial', 'overdue'].includes(i.status))
    .reduce((s, i) => s + (i.amountTotal - (i.paymentReceivedAmount ?? 0)), 0);

  const deleteBlockers: string[] = [];
  if (canDelete) {
    const dealCount = await prisma.deal.count({ where: { clientId: client.id } });
    if (client.projects.length)
      deleteBlockers.push(
        `${client.projects.length} project${client.projects.length === 1 ? '' : 's'}`,
      );
    if (dealCount) deleteBlockers.push(`${dealCount} deal${dealCount === 1 ? '' : 's'}`);
    if (client.invoices.length)
      deleteBlockers.push(
        `${client.invoices.length} invoice${client.invoices.length === 1 ? '' : 's'}`,
      );
  }

  const recentInvoices = client.invoices.slice(0, 10);

  // BD pipeline tied to this client. We pull every deal (open + closed)
  // so the partner can see the full history, but separate into open vs
  // closed for layout. Sequential to stay within the Supabase pool —
  // this page already runs several queries up top.
  const clientDeals = await prisma.deal.findMany({
    where: { clientId: client.id },
    orderBy: [{ archivedAt: 'asc' }, { stage: 'asc' }, { updatedAt: 'desc' }],
    select: {
      id: true,
      code: true,
      name: true,
      stage: true,
      expectedValue: true,
      probability: true,
      lastConversationAt: true,
      targetCloseDate: true,
      archivedAt: true,
      convertedProjectId: true,
      engagementType: true,
      owner: {
        select: { id: true, initials: true, headshotUrl: true, firstName: true, lastName: true },
      },
    },
  });
  const openDeals = clientDeals.filter(
    (d) => !d.archivedAt && d.stage !== 'won' && d.stage !== 'lost',
  );
  const closedDeals = clientDeals.filter(
    (d) => d.archivedAt || d.stage === 'won' || d.stage === 'lost',
  );
  const pipelineExpectedCents = openDeals.reduce(
    (s, d) => s + d.expectedValue,
    0,
  );
  const pipelineWeightedCents = openDeals.reduce(
    (s, d) => s + Math.round(d.expectedValue * (d.probability / 100)),
    0,
  );

  return (
    <div className="space-y-6">
      <div className="text-sm">
        <Link href="/directory/clients" className="text-ink-3 hover:text-ink">
          ← Back to Clients
        </Link>
      </div>

      {client.archivedAt && (
        <div className="rounded-md border border-status-amber bg-status-amber-soft px-3 py-2 text-sm text-status-amber">
          Archived on {client.archivedAt.toLocaleDateString('en-AU')}. Hidden from active client lists.
        </div>
      )}

      <header className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="font-mono">
              {client.code}
            </Badge>
            <h1 className="text-xl font-semibold text-ink">{client.legalName}</h1>
            {client.archivedAt && (
              <Badge variant="outline" className="text-[10px]">
                Archived
              </Badge>
            )}
          </div>
          {client.tradingName && (
            <p className="mt-1 text-sm text-ink-3">trading as {client.tradingName}</p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canEdit && (
            <Link
              href={`/directory/clients/${client.id}/edit`}
              className="inline-flex h-9 items-center rounded-md border border-line px-3 text-sm text-ink-2 hover:bg-surface-hover hover:text-ink"
            >
              Edit profile
            </Link>
          )}
          {canCreateProject && !client.archivedAt && (
            <Link
              href={`/projects/new?clientId=${client.id}`}
              className="inline-flex h-9 items-center rounded-md bg-brand px-3 text-sm font-medium text-brand-ink hover:opacity-90"
            >
              + New project
            </Link>
          )}
          {canDelete && (
            <DeleteClientButton
              clientId={client.id}
              clientCode={client.code}
              clientName={client.legalName}
              deleteBlockers={deleteBlockers}
            />
          )}
        </div>
      </header>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <TotalCard
          label="Projects"
          value={String(activeProjects)}
          sub={`${client.projects.length} total`}
        />
        <TotalCard
          label="Pipeline"
          value={String(openDeals.length)}
          sub={
            openDeals.length > 0
              ? `${formatMoney(pipelineExpectedCents)} · ${formatMoney(pipelineWeightedCents)} wtd.`
              : `${closedDeals.length} closed`
          }
        />
        <TotalCard
          label="Contract value"
          value={formatMoney(contractValue)}
          sub="ex GST, lifetime"
        />
        <TotalCard
          label="Invoiced"
          value={formatMoney(invoicedCents)}
          sub={`${formatMoney(paidCents)} paid`}
        />
        <TotalCard
          label="AR open"
          value={formatMoney(arOutstandingCents)}
          sub="approved / sent / partial"
          emphasis={arOutstandingCents > 0}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Identity &amp; billing</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label="Entity type">
              <Badge variant="outline" className="capitalize">
                {(client.clientType ?? 'private_company').replace(/_/g, ' ')}
              </Badge>
            </Row>
            <Row label="ABN">
              {client.abn ? (
                <span className="font-mono">
                  {client.abn.replace(/^(\d{2})(\d{3})(\d{3})(\d{3})$/, '$1 $2 $3 $4')}
                </span>
              ) : (
                '—'
              )}
            </Row>
            <Row label="ACN">
              {client.acn ? (
                <span className="font-mono">
                  {client.acn.replace(/^(\d{3})(\d{3})(\d{3})$/, '$1 $2 $3')}
                </span>
              ) : (
                '—'
              )}
            </Row>
            <Row label="Address">
              {client.streetAddress || client.suburb || client.state || client.postcode ? (
                <span>
                  {[
                    client.streetAddress,
                    [client.suburb, client.state, client.postcode]
                      .filter(Boolean)
                      .join(' '),
                    client.country !== 'AU' ? client.country : null,
                  ]
                    .filter(Boolean)
                    .join(', ')}
                </span>
              ) : client.billingAddress ? (
                <span>{client.billingAddress}</span>
              ) : (
                '—'
              )}
            </Row>
            <Row label="Billing email">
              {client.billingEmail ? (
                <span className="font-mono">{client.billingEmail}</span>
              ) : (
                '—'
              )}
            </Row>
            <Row label="Payment terms">
              <span className="capitalize">{client.paymentTerms.replace('-', ' ')}</span>
              {client.purchaseOrderRequired && (
                <Badge variant="amber" className="ml-2 text-[10px]">
                  PO required
                </Badge>
              )}
            </Row>
            {client.paymentInstructions && (
              <Row label="Payment notes">
                <span className="whitespace-pre-wrap">{client.paymentInstructions}</span>
              </Row>
            )}
            <Row label="Xero contact">
              {client.xeroContactId ? (
                <div className="flex flex-col gap-1">
                  <span className="font-mono text-xs">{client.xeroContactId}</span>
                  <XeroSyncClientButton clientId={client.id} hasContactId={true} />
                </div>
              ) : (
                <div className="flex flex-col gap-1">
                  <span className="text-ink-3">Not synced</span>
                  <XeroSyncClientButton clientId={client.id} hasContactId={false} />
                </div>
              )}
            </Row>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Day-to-day contact</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {client.contactName ? (
              <>
                <div className="font-medium text-ink">{client.contactName}</div>
                {client.contactTitle && (
                  <div className="text-xs text-ink-3">{client.contactTitle}</div>
                )}
                {client.contactEmail && (
                  <a
                    href={`mailto:${client.contactEmail}`}
                    className="block font-mono text-xs text-brand hover:underline"
                  >
                    {client.contactEmail}
                  </a>
                )}
                {client.contactPhone && (
                  <div className="font-mono text-xs text-ink-2">
                    {client.contactPhone}
                  </div>
                )}
              </>
            ) : (
              <p className="text-ink-3">No contact set.</p>
            )}
            <div className="border-t border-line pt-2 text-xs text-ink-3">
              <span className="block uppercase tracking-wide">Internal owner</span>
              {client.primaryPartner ? (
                <Link
                  href={`/directory/people/${client.primaryPartner.id}`}
                  className="mt-1 flex items-center gap-2 hover:text-ink"
                >
                  <PersonAvatar
  className="h-6 w-6"
  fallbackClassName="text-[10px]"
  initials={client.primaryPartner.initials}
  headshotUrl={client.primaryPartner.headshotUrl}
/>
                  <span className="text-sm font-medium text-ink">
                    {client.primaryPartner.firstName}{' '}
                    {client.primaryPartner.lastName}
                  </span>
                </Link>
              ) : (
                <p className="mt-1 text-ink-3">Not assigned.</p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* BD pipeline tied to this client. Surfaced before Projects so
          partners reading the file in chronological order (deal → won
          → project) get the natural flow. Won deals show their linked
          project so the connection between pipeline and delivery is
          legible at a glance. */}
      <Card className="p-0">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>
            Pipeline ({openDeals.length}
            {closedDeals.length > 0 ? ` · ${closedDeals.length} closed` : ''})
          </CardTitle>
          {hasCapability(session, 'deal.create') && !client.archivedAt && (
            <Link
              href={`/bd/new?clientId=${client.id}`}
              className="text-sm text-brand hover:underline"
            >
              + New deal
            </Link>
          )}
        </CardHeader>
        {clientDeals.length === 0 ? (
          <CardContent>
            <p className="text-sm text-ink-3">
              No deals tracked for this client yet.{' '}
              {hasCapability(session, 'deal.create') && !client.archivedAt && (
                <Link href="/bd/new" className="text-brand hover:underline">
                  Add the first one →
                </Link>
              )}
            </p>
          </CardContent>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Name / Engagement</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead>Stage</TableHead>
                <TableHead className="text-right">Expected</TableHead>
                <TableHead className="text-right">Prob</TableHead>
                <TableHead>Last convo</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[...openDeals, ...closedDeals].map((d) => {
                const days =
                  d.lastConversationAt === null
                    ? null
                    : Math.floor(
                        (Date.now() - d.lastConversationAt.getTime()) /
                          (24 * 3600 * 1000),
                      );
                return (
                  <TableRow
                    key={d.id}
                    className={
                      d.archivedAt || d.stage === 'lost'
                        ? 'opacity-60'
                        : undefined
                    }
                  >
                    <TableCell>
                      <Link
                        href={`/bd/${d.id}`}
                        className="font-mono text-xs text-ink hover:underline"
                      >
                        {d.code}
                      </Link>
                    </TableCell>
                    <TableCell className="text-ink">
                      {d.name ?? <span className="text-ink-4">(unnamed)</span>}
                      {d.engagementType && (
                        <span className="ml-1 text-xs text-ink-3">
                          · {d.engagementType.replace(/[-_]/g, ' ')}
                        </span>
                      )}
                      {d.convertedProjectId && (
                        <Link
                          href={`/projects`}
                          className="ml-2 text-[11px] text-status-green hover:underline"
                          title="Converted to a project"
                        >
                          → project ↗
                        </Link>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <PersonAvatar
  className="h-5 w-5"
  fallbackClassName="text-[9px]"
  initials={d.owner.initials}
  headshotUrl={d.owner.headshotUrl}
/>
                        <span className="text-xs text-ink-2">
                          {d.owner.firstName} {d.owner.lastName}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          d.stage === 'won'
                            ? 'green'
                            : d.stage === 'lost'
                              ? 'red'
                              : d.stage === 'negotiation' || d.stage === 'proposal'
                                ? 'blue'
                                : d.stage === 'qualifying'
                                  ? 'amber'
                                  : 'outline'
                        }
                        className="capitalize"
                      >
                        {d.stage}
                      </Badge>
                      {d.archivedAt && (
                        <Badge
                          variant="outline"
                          className="ml-1 text-[10px]"
                        >
                          Archived
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(d.expectedValue)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-xs text-ink-3">
                      {d.probability}%
                    </TableCell>
                    <TableCell className="text-xs tabular-nums">
                      {days === null ? (
                        <span className="text-ink-4">—</span>
                      ) : (
                        <span
                          className={
                            days > 30 && !d.archivedAt && d.stage !== 'won' && d.stage !== 'lost'
                              ? 'text-status-amber'
                              : 'text-ink-3'
                          }
                        >
                          {days === 0 ? 'Today' : `${days}d ago`}
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Card>

      <Card className="p-0">
        <CardHeader>
          <CardTitle>Projects ({client.projects.length})</CardTitle>
        </CardHeader>
        {client.projects.length === 0 ? (
          <CardContent>
            <p className="text-sm text-ink-3">
              No projects yet. Click + New project to start one for this client.
            </p>
          </CardContent>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Stage</TableHead>
                <TableHead>Duration</TableHead>
                <TableHead className="text-right">Contract</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {client.projects.map((p) => {
                const end = p.actualEndDate ?? p.endDate;
                return (
                  <TableRow key={p.id}>
                    <TableCell>
                      <Link
                        href={`/projects/${p.code}`}
                        className="font-mono text-xs hover:underline"
                      >
                        {p.code}
                      </Link>
                    </TableCell>
                    <TableCell className="text-ink">{p.name}</TableCell>
                    <TableCell>
                      <Badge
                        variant={STAGE_VARIANT[p.stage] ?? 'outline'}
                        className="capitalize"
                      >
                        {p.stage}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-ink-3 tabular-nums">
                      {p.startDate
                        ? p.startDate.toLocaleDateString('en-AU')
                        : '—'}{' '}
                      →{' '}
                      {end ? end.toLocaleDateString('en-AU') : '—'}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(p.contractValue)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Card>

      {recentInvoices.length > 0 && (
        <Card className="p-0">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Recent invoices</CardTitle>
            <span className="pr-4 text-xs text-ink-3">
              {client.invoices.length > 10
                ? `Showing 10 of ${client.invoices.length}`
                : `${client.invoices.length} total`}
            </span>
          </CardHeader>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Number</TableHead>
                <TableHead>Project</TableHead>
                <TableHead>Issued</TableHead>
                <TableHead>Due</TableHead>
                <TableHead className="text-right">Ex GST</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Paid</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recentInvoices.map((inv) => (
                <TableRow key={inv.id}>
                  <TableCell>
                    <Link
                      href={`/invoices/${inv.id}`}
                      className="font-mono text-xs hover:underline"
                    >
                      {inv.number}
                    </Link>
                  </TableCell>
                  <TableCell className="font-mono text-xs text-ink-3">
                    {inv.project.code}
                  </TableCell>
                  <TableCell className="tabular-nums text-xs">
                    {inv.issueDate.toLocaleDateString('en-AU')}
                  </TableCell>
                  <TableCell className="tabular-nums text-xs">
                    {inv.dueDate.toLocaleDateString('en-AU')}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-ink-2">
                    {formatMoney(inv.amountExGst)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-ink">
                    {formatMoney(inv.amountTotal)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-ink-3">
                    {inv.paymentReceivedAmount
                      ? formatMoney(inv.paymentReceivedAmount)
                      : '—'}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={INVOICE_STATUS_VARIANT[inv.status] ?? 'outline'}
                      className="capitalize"
                    >
                      {inv.status.replace(/_/g, ' ')}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      {canEdit && (
        <Card>
          <CardHeader>
            <CardTitle>Danger zone</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-ink-3">
            <p>
              Archiving hides the client from active lists but keeps all history. Use
              archive once an engagement ends.
            </p>
            <ClientArchiveControls
              clientId={client.id}
              isArchived={Boolean(client.archivedAt)}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[140px_1fr] gap-2 py-1">
      <div className="text-ink-3">{label}</div>
      <div className="text-ink">{children}</div>
    </div>
  );
}

function TotalCard({
  label,
  value,
  sub,
  emphasis,
}: {
  label: string;
  value: string;
  sub?: string;
  emphasis?: boolean;
}) {
  return (
    <Card>
      <CardHeader className="pb-1">
        <CardTitle className="text-xs font-medium uppercase tracking-wide text-ink-3">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div
          className={`text-lg font-semibold tabular-nums ${
            emphasis ? 'text-status-amber' : 'text-ink'
          }`}
        >
          {value}
        </div>
        {sub && <div className="text-[11px] text-ink-3">{sub}</div>}
      </CardContent>
    </Card>
  );
}
