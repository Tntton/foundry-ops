import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSession } from '@/server/session';
import { hasCapability } from '@/server/capabilities';
import { getXeroIntegration, xeroConfigured } from '@/server/integrations/xero';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default async function IntegrationsIndexPage() {
  const session = await getSession();
  if (!session || !hasCapability(session, 'integration.manage')) notFound();

  const xeroRow = await getXeroIntegration();
  const xeroConnected = xeroRow?.status === 'connected';
  const xeroEnvConfigured = xeroConfigured();

  const entries = [
    {
      href: '/admin/integrations/xero',
      title: 'Xero',
      blurb: 'Invoices, bills, contacts, bank feed.',
      status: xeroConnected
        ? { label: 'Connected', variant: 'green' as const }
        : xeroEnvConfigured
          ? { label: 'Disconnected', variant: 'outline' as const }
          : { label: 'Not configured', variant: 'amber' as const },
    },
    {
      href: null,
      title: 'Microsoft 365 + SharePoint',
      blurb:
        'Auto-provisioned on Person create / Project create via Graph. Credentials are env-level — no per-tenant connect UI needed.',
      status: { label: 'Env-configured', variant: 'blue' as const },
    },
    {
      href: null,
      title: 'pay.com.au (ABA generator)',
      blurb: 'Pay-run export → ABA file → CBA for payment processing.',
      status: { label: 'Later', variant: 'outline' as const },
    },
    {
      href: null,
      title: 'DocuSign',
      blurb: 'Contract send + signature webhook.',
      status: { label: 'Later', variant: 'outline' as const },
    },
    {
      href: null,
      title: 'WhatsApp Business',
      blurb: 'Inbound receipts, outbound approval nudges.',
      status: { label: 'Later', variant: 'outline' as const },
    },
  ];

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-ink">Integrations</h1>
        <p className="text-sm text-ink-3">
          Connect Foundry Ops to the systems it reads from and writes to.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {entries.map((e) => {
          const card = (
            <Card className="h-full transition-colors hover:border-brand">
              <CardHeader className="flex flex-row items-start justify-between gap-2">
                <CardTitle>{e.title}</CardTitle>
                <Badge variant={e.status.variant}>{e.status.label}</Badge>
              </CardHeader>
              <CardContent className="text-sm text-ink-2">{e.blurb}</CardContent>
            </Card>
          );
          return e.href ? (
            <Link key={e.title} href={e.href} className="block">
              {card}
            </Link>
          ) : (
            <div key={e.title}>{card}</div>
          );
        })}
      </div>
    </div>
  );
}
