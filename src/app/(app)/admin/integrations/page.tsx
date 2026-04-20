import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSession } from '@/server/session';
import { hasCapability } from '@/server/capabilities';
import { optionalEnv } from '@/server/env';
import { graphConfigured } from '@/server/graph';
import { getXeroIntegration, xeroConfigured } from '@/server/integrations/xero';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

type StatusVariant = 'green' | 'amber' | 'outline' | 'blue';

export default async function IntegrationsIndexPage() {
  const session = await getSession();
  if (!session || !hasCapability(session, 'integration.manage')) notFound();

  const xeroRow = await getXeroIntegration();
  const xeroConnected = xeroRow?.status === 'connected';
  const xeroEnvConfigured = xeroConfigured();

  const m365Configured = graphConfigured();
  const sharepointSite = optionalEnv('SHAREPOINT_SITE_URL');
  const sharepointClientsRoot = optionalEnv('SHAREPOINT_CLIENTS_ROOT');
  const sharepointAdminRoot = optionalEnv('SHAREPOINT_ADMIN_ROOT');
  const sharepointTemplate = optionalEnv('SHAREPOINT_TEAM_TEMPLATE_PATH');
  const sharepointConfigured = Boolean(sharepointSite && sharepointClientsRoot);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-ink">Integrations</h1>
        <p className="text-sm text-ink-3">
          Connect Foundry Ops to the systems it reads from and writes to.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <IntegrationCard
          href="/admin/integrations/xero"
          title="Xero"
          blurb="Invoices, bills, contacts, bank feed."
          status={
            xeroConnected
              ? { label: 'Connected', variant: 'green' }
              : xeroEnvConfigured
                ? { label: 'Disconnected', variant: 'outline' }
                : { label: 'Not configured', variant: 'amber' }
          }
        />

        <IntegrationCard
          title="Microsoft 365"
          blurb={
            m365Configured
              ? 'User provisioning + deactivation on Person archive via Graph.'
              : 'Set ENTRA_TENANT_ID / CLIENT_ID / CLIENT_SECRET in env to enable.'
          }
          status={
            m365Configured
              ? { label: 'Env-configured', variant: 'blue' }
              : { label: 'Not configured', variant: 'amber' }
          }
        />

        <Card className="md:col-span-2">
          <CardHeader className="flex flex-row items-start justify-between gap-2">
            <div>
              <CardTitle>SharePoint</CardTitle>
              <p className="mt-1 text-sm text-ink-3">
                Per-project folder provisioning via Graph, using the team + admin roots below.
              </p>
            </div>
            <Badge
              variant={sharepointConfigured ? 'blue' : 'amber'}
            >
              {sharepointConfigured ? 'Env-configured' : 'Not configured'}
            </Badge>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label="Site URL">
              {sharepointSite ? (
                <span className="font-mono text-xs break-all text-ink-2">{sharepointSite}</span>
              ) : (
                <span className="text-ink-3">
                  <code className="font-mono">SHAREPOINT_SITE_URL</code> unset
                </span>
              )}
            </Row>
            <Row label="Team root">
              {sharepointClientsRoot ? (
                <span className="font-mono text-xs text-ink-2">
                  /{sharepointClientsRoot}
                </span>
              ) : (
                <span className="text-ink-3">
                  <code className="font-mono">SHAREPOINT_CLIENTS_ROOT</code> unset
                </span>
              )}
            </Row>
            <Row label="Admin root">
              {sharepointAdminRoot ? (
                <span className="font-mono text-xs text-ink-2">/{sharepointAdminRoot}</span>
              ) : (
                <span className="text-ink-3">none — admin folder skipped</span>
              )}
            </Row>
            <Row label="Template">
              {sharepointTemplate ? (
                <span className="font-mono text-xs text-ink-2">/{sharepointTemplate}</span>
              ) : (
                <span className="text-ink-3">
                  none — flat subfolders instead of a template copy
                </span>
              )}
            </Row>
          </CardContent>
        </Card>

        <IntegrationCard
          title="pay.com.au (ABA generator)"
          blurb="Pay-run export → ABA file → CBA for payment processing."
          status={{ label: 'Later', variant: 'outline' }}
        />
        <IntegrationCard
          title="DocuSign"
          blurb="Contract send + signature webhook."
          status={{ label: 'Later', variant: 'outline' }}
        />
        <IntegrationCard
          title="WhatsApp Business"
          blurb="Inbound receipts, outbound approval nudges."
          status={{ label: 'Later', variant: 'outline' }}
        />
      </div>
    </div>
  );
}

function IntegrationCard({
  href,
  title,
  blurb,
  status,
}: {
  href?: string;
  title: string;
  blurb: string;
  status: { label: string; variant: StatusVariant };
}) {
  const card = (
    <Card className="h-full transition-colors hover:border-brand">
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <CardTitle>{title}</CardTitle>
        <Badge variant={status.variant}>{status.label}</Badge>
      </CardHeader>
      <CardContent className="text-sm text-ink-2">{blurb}</CardContent>
    </Card>
  );
  return href ? (
    <Link href={href} className="block">
      {card}
    </Link>
  ) : (
    card
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[110px_1fr] gap-2 py-1">
      <div className="text-ink-3">{label}</div>
      <div className="text-ink">{children}</div>
    </div>
  );
}
