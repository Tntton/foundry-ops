import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSession } from '@/server/session';
import { hasCapability } from '@/server/capabilities';
import { getXeroIntegration, xeroConfigured, type XeroConfig } from '@/server/integrations/xero';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default async function XeroIntegrationPage({
  searchParams,
}: {
  searchParams: { connected?: string; disconnected?: string; error?: string };
}) {
  const session = await getSession();
  if (!session || !hasCapability(session, 'integration.manage')) notFound();

  const row = await getXeroIntegration();
  const cfg = row?.config as XeroConfig | undefined;
  const connected = row?.status === 'connected';
  const envConfigured = xeroConfigured();

  return (
    <div className="space-y-6">
      <div className="text-sm">
        <Link href="/admin/integrations" className="text-ink-3 hover:text-ink">
          ← Admin
        </Link>
      </div>
      <header>
        <h1 className="text-xl font-semibold text-ink">Xero integration</h1>
        <p className="text-sm text-ink-3">
          Push approved invoices + bills to Xero, pull bank feed nightly, and drive the AR
          chaser agent from overdue invoices.
        </p>
      </header>

      {searchParams.connected === '1' && (
        <div className="rounded-md border border-status-green bg-status-green-soft px-3 py-2 text-sm text-status-green">
          ✅ Connected to Xero.
        </div>
      )}
      {searchParams.disconnected === '1' && (
        <div className="rounded-md border border-status-amber bg-status-amber-soft px-3 py-2 text-sm text-status-amber">
          Disconnected. Re-connect any time.
        </div>
      )}
      {searchParams.error && (
        <div className="rounded-md border border-status-red bg-status-red-soft px-3 py-2 text-sm text-status-red">
          Error: <span className="font-mono">{searchParams.error}</span>
        </div>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Status</CardTitle>
          {connected ? (
            <Badge variant="green">Connected</Badge>
          ) : envConfigured ? (
            <Badge variant="outline">Disconnected</Badge>
          ) : (
            <Badge variant="amber">Not configured</Badge>
          )}
        </CardHeader>
        <CardContent className="space-y-4 text-sm text-ink-2">
          {!envConfigured ? (
            <p className="text-ink-3">
              <code className="font-mono">XERO_CLIENT_ID</code> and{' '}
              <code className="font-mono">XERO_CLIENT_SECRET</code> not set — ask the admin
              to populate them in <code className="font-mono">.env.local</code>.
            </p>
          ) : connected && cfg ? (
            <>
              <Row label="Connected at">
                {new Date(cfg.connectedAt).toLocaleString('en-AU')}
              </Row>
              <Row label="Organisations">
                <ul className="space-y-1">
                  {cfg.tenants.map((t) => (
                    <li key={t.tenantId} className="font-mono text-xs">
                      {t.tenantName}{' '}
                      <span className="text-ink-3">· {t.tenantType}</span>
                    </li>
                  ))}
                </ul>
              </Row>
            </>
          ) : (
            <p className="text-ink-3">
              Click Connect to launch the Xero OAuth flow. You&apos;ll be redirected to
              Xero, asked to pick your Foundry Health organisation, and brought back here
              with encrypted tokens saved.
            </p>
          )}
        </CardContent>
      </Card>

      <div className="flex gap-2">
        {connected ? (
          <>
            <Button asChild>
              <a href="/api/integrations/xero/connect">Re-connect</a>
            </Button>
            <form action="/api/integrations/xero/disconnect" method="post">
              <Button type="submit" variant="destructive">
                Disconnect
              </Button>
            </form>
          </>
        ) : (
          <Button asChild disabled={!envConfigured}>
            <a href="/api/integrations/xero/connect">Connect to Xero</a>
          </Button>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>What connecting enables</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-ink-2">
          <Row label="Invoice push (TASK-053)">
            Approved invoices auto-pushed as Xero drafts.
          </Row>
          <Row label="Bill push (TASK-054)">Approved bills auto-pushed as Xero drafts.</Row>
          <Row label="Bank feed (TASK-055)">
            Nightly bank-transaction pull for the Xero reconciler agent.
          </Row>
          <Row label="Client sync (TASK-051)">
            Clients + contractor Persons upserted as Xero contacts.
          </Row>
          <Row label="Tracking categories (TASK-052)">
            One Xero tracking-category value per project code.
          </Row>
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[200px_1fr] gap-2 py-1">
      <div className="text-ink-3">{label}</div>
      <div className="text-ink">{children}</div>
    </div>
  );
}
