import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSession } from '@/server/session';
import { hasAnyRole } from '@/server/roles';
import { hasCapability } from '@/server/capabilities';
import { prisma } from '@/server/db';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
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
        select: { id: true, initials: true, firstName: true, lastName: true },
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

  return (
    <div className="space-y-6">
      <div className="text-sm">
        <Link href="/directory/clients" className="text-ink-3 hover:text-ink">
          ← Back to Clients
        </Link>
      </div>

      <header className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="font-mono">
              {client.code}
            </Badge>
            <h1 className="text-xl font-semibold text-ink">{client.legalName}</h1>
          </div>
          {client.tradingName && (
            <p className="mt-1 text-sm text-ink-3">trading as {client.tradingName}</p>
          )}
        </div>
        {canDelete && (
          <DeleteClientButton
            clientId={client.id}
            clientCode={client.code}
            clientName={client.legalName}
            deleteBlockers={deleteBlockers}
          />
        )}
      </header>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <TotalCard
          label="Projects"
          value={String(activeProjects)}
          sub={`${client.projects.length} total`}
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
            <CardTitle>Billing</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label="ABN">{client.abn ?? '—'}</Row>
            <Row label="Billing email">
              {client.billingEmail ? (
                <span className="font-mono">{client.billingEmail}</span>
              ) : (
                '—'
              )}
            </Row>
            <Row label="Billing address">{client.billingAddress ?? '—'}</Row>
            <Row label="Payment terms">{client.paymentTerms}</Row>
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
            <CardTitle>Primary partner</CardTitle>
          </CardHeader>
          <CardContent>
            {client.primaryPartner ? (
              <Link
                href={`/directory/people/${client.primaryPartner.id}`}
                className="flex items-center gap-2 hover:text-ink"
              >
                <Avatar>
                  <AvatarFallback>{client.primaryPartner.initials}</AvatarFallback>
                </Avatar>
                <div>
                  <div className="font-medium text-ink">
                    {client.primaryPartner.firstName} {client.primaryPartner.lastName}
                  </div>
                </div>
              </Link>
            ) : (
              <p className="text-sm text-ink-3">Not assigned.</p>
            )}
          </CardContent>
        </Card>
      </div>

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
                      {p.startDate.toLocaleDateString('en-AU')} →{' '}
                      {end.toLocaleDateString('en-AU')}
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
