import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSession } from '@/server/session';
import { hasAnyRole } from '@/server/roles';
import { hasCapability } from '@/server/capabilities';
import { prisma } from '@/server/db';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { XeroSyncClientButton } from './xero-sync-button';
import { DeleteClientButton } from './delete-dialog';

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
        select: { id: true, code: true, name: true, stage: true },
      },
    },
  });
  if (!client) notFound();

  const canDelete = hasCapability(session, 'client.delete');
  const [projectCount, dealCount, invoiceCount] = canDelete
    ? await Promise.all([
        prisma.project.count({ where: { clientId: client.id } }),
        prisma.deal.count({ where: { clientId: client.id } }),
        prisma.invoice.count({ where: { clientId: client.id } }),
      ])
    : [0, 0, 0];
  const deleteBlockers: string[] = [];
  if (projectCount)
    deleteBlockers.push(`${projectCount} project${projectCount === 1 ? '' : 's'}`);
  if (dealCount) deleteBlockers.push(`${dealCount} deal${dealCount === 1 ? '' : 's'}`);
  if (invoiceCount)
    deleteBlockers.push(`${invoiceCount} invoice${invoiceCount === 1 ? '' : 's'}`);

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

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
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

      <Card>
        <CardHeader>
          <CardTitle>Projects ({client.projects.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {client.projects.length === 0 ? (
            <p className="text-sm text-ink-3">
              No projects yet. Click + New project to start one for this client.
            </p>
          ) : (
            <ul className="space-y-1 text-sm">
              {client.projects.map((p) => (
                <li key={p.id} className="flex items-center gap-2">
                  <Badge variant="outline" className="font-mono">
                    {p.code}
                  </Badge>
                  <span className="text-ink">{p.name}</span>
                  <Badge variant={p.stage === 'archived' ? 'outline' : 'green'}>{p.stage}</Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
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
