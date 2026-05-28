import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSession } from '@/server/session';
import { hasCapability } from '@/server/capabilities';
import {
  getDocuSignIntegration,
  consentUrl,
  type DocuSignConfig,
} from '@/server/integrations/docusign';
import { prisma } from '@/server/db';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  ConnectForm,
  DisconnectButton,
  StampConsentButton,
} from './client';

/**
 * Admin connection panel for DocuSign.
 *
 * Three states surfaced:
 *   - Disconnected: shows the connect form
 *   - Connected, consent pending: shows the consent URL + "I granted
 *     consent" button + a warning that the integration won't actually
 *     send until consent is stamped
 *   - Connected, consent stamped: shows the live status, last envelope
 *     activity, and the webhook URL the operator needs to set on
 *     DocuSign's side
 */
export default async function DocuSignIntegrationPage() {
  const session = await getSession();
  if (!session || !hasCapability(session, 'integration.manage')) notFound();

  const row = await getDocuSignIntegration();
  const cfg = (row?.config ?? {}) as DocuSignConfig;
  const connected = row?.status === 'connected';
  const consentStamped = Boolean(cfg.consentedAt);

  // Last 5 envelopes for an at-a-glance health check.
  const recentEnvelopes = await prisma.docuSignEnvelope.findMany({
    orderBy: { createdAt: 'desc' },
    take: 5,
    select: {
      id: true,
      externalEnvelopeId: true,
      subjectType: true,
      subjectId: true,
      emailSubject: true,
      status: true,
      createdAt: true,
      sender: { select: { firstName: true, lastName: true } },
    },
  });

  return (
    <div className="space-y-6">
      <div className="text-sm">
        <Link
          href="/admin/integrations"
          className="text-ink-3 hover:text-ink"
        >
          ← Back to Integrations
        </Link>
      </div>
      <header className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink">DocuSign</h1>
          <p className="text-sm text-ink-3">
            E-signature pipeline for CSAs, Work Orders, contractor
            agreements, and other Foundry contracts. JWT-grant
            server-to-server auth — once consent is stamped, no human
            in the loop for sends.
          </p>
        </div>
        <Badge variant={connected ? (consentStamped ? 'green' : 'amber') : 'outline'}>
          {!connected
            ? 'Disconnected'
            : consentStamped
              ? 'Connected'
              : 'Consent pending'}
        </Badge>
      </header>

      {!connected && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-semibold uppercase tracking-wide text-ink-3">
              Connect
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <ol className="space-y-1 text-xs text-ink-3">
              <li>
                <strong>1.</strong> In DocuSign Admin → Apps and Keys,
                create an Integration Key (or use an existing one).
              </li>
              <li>
                <strong>2.</strong> Generate an RSA keypair under that
                key. Save both halves.
              </li>
              <li>
                <strong>3.</strong> Copy the Integration Key, API User
                GUID, and API Account ID into the form below.
              </li>
              <li>
                <strong>4.</strong> Paste the RSA private key (with
                BEGIN/END markers).
              </li>
              <li>
                <strong>5.</strong> In DocuSign Admin → Connect, create
                a configuration pointing at{' '}
                <code className="font-mono">
                  &lt;your-host&gt;/api/docusign/webhook
                </code>
                . Enable HMAC and copy the secret here.
              </li>
              <li>
                <strong>6.</strong> Pick environment (demo for
                sandbox, prod for live).
              </li>
            </ol>
            <ConnectForm />
          </CardContent>
        </Card>
      )}

      {connected && !consentStamped && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-semibold uppercase tracking-wide text-status-amber">
              Consent required (one-time)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p className="text-ink-2">
              JWT-grant requires user consent be granted once per
              integration key + environment. Open the consent URL
              below in a new tab — sign in as the API user, click
              <em> Accept</em>, then come back and click{' '}
              <em>I granted consent</em>.
            </p>
            <Link
              href={consentUrl(cfg.environment, cfg.integrationKey)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center rounded-md border border-status-amber bg-status-amber-soft px-3 py-1.5 text-xs font-medium text-status-amber hover:bg-status-amber/10"
            >
              Open DocuSign consent URL →
            </Link>
            <div>
              <StampConsentButton />
            </div>
            <p className="text-xs text-ink-3">
              We can&apos;t verify consent programmatically — the next
              send will fail with{' '}
              <code className="font-mono text-[10px]">
                consent_required
              </code>{' '}
              if you skip this step. Stamping it here just records
              that you completed the flow.
            </p>
          </CardContent>
        </Card>
      )}

      {connected && (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-semibold uppercase tracking-wide text-ink-3">
                Connection
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              <Row label="Environment">
                <Badge variant={cfg.environment === 'prod' ? 'green' : 'blue'}>
                  {cfg.environment === 'prod' ? 'Production' : 'Demo (sandbox)'}
                </Badge>
              </Row>
              <Row label="Integration key" value={cfg.integrationKey} mono />
              <Row label="API User" value={cfg.apiUserId} mono />
              <Row label="Account ID" value={cfg.accountId} mono />
              <Row
                label="Connected at"
                value={
                  cfg.connectedAt
                    ? new Date(cfg.connectedAt).toLocaleString('en-AU')
                    : '—'
                }
              />
              <Row
                label="Consent stamped"
                value={
                  cfg.consentedAt
                    ? new Date(cfg.consentedAt).toLocaleString('en-AU')
                    : '— pending —'
                }
              />
              <Row
                label="Webhook URL"
                value="/api/docusign/webhook"
                mono
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-semibold uppercase tracking-wide text-ink-3">
                Recent envelopes ({recentEnvelopes.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              {recentEnvelopes.length === 0 ? (
                <p className="text-xs text-ink-3">
                  No envelopes sent yet. They&apos;ll appear here as
                  partners initiate signatures.
                </p>
              ) : (
                recentEnvelopes.map((e) => (
                  <div
                    key={e.id}
                    className="flex items-center justify-between gap-3 rounded-md border border-line bg-surface-elev px-3 py-2 text-xs"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-ink">
                        {e.emailSubject ?? '(no subject)'}
                      </div>
                      <div className="text-ink-3">
                        {e.subjectType} · {e.subjectId.slice(0, 8)} ·{' '}
                        {e.sender.firstName} {e.sender.lastName}
                      </div>
                    </div>
                    <Badge variant={statusVariant(e.status)}>{e.status}</Badge>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-semibold uppercase tracking-wide text-ink-3">
                Disconnect
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <DisconnectButton />
              <p className="text-xs text-ink-3">
                Wipes credentials + consent stamp. Existing envelopes
                stay on file (audit trail). Reconnect anytime.
              </p>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function Row({
  label,
  value,
  mono,
  children,
}: {
  label: string;
  value?: string;
  mono?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-ink-3">{label}</span>
      <span
        className={`text-right text-ink-2 ${mono ? 'font-mono text-xs' : ''}`}
      >
        {children ?? value ?? '—'}
      </span>
    </div>
  );
}

function statusVariant(
  status: string,
): 'green' | 'amber' | 'red' | 'blue' | 'outline' {
  if (status === 'completed') return 'green';
  if (status === 'sent' || status === 'delivered') return 'blue';
  if (status === 'declined' || status === 'voided') return 'red';
  if (status === 'created') return 'amber';
  return 'outline';
}
