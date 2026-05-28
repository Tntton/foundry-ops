import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSession } from '@/server/session';
import { hasCapability } from '@/server/capabilities';
import {
  getNavanIntegration,
  navanConfigured,
  type NavanConfig,
} from '@/server/integrations/navan';
import { formatLocalDateTime } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  ConnectForm,
  DisconnectButton,
  RunSyncButton,
  ImportCsvButton,
} from './client';

/**
 * Admin connection panel for Navan.
 *
 * Two states:
 *   - Disconnected: shows the "Connect Navan" form (API key + secret +
 *     optional org id). Clicking Connect persists the credentials,
 *     flips status to `connected`, and surfaces the sync button.
 *   - Connected: shows the connection metadata (org id, last sync,
 *     watermarks) plus Run sync + Disconnect actions.
 */
export default async function NavanIntegrationPage() {
  const session = await getSession();
  if (!session || !hasCapability(session, 'integration.manage')) notFound();

  const row = await getNavanIntegration();
  const cfg = (row?.config ?? {}) as NavanConfig;
  const connected = row?.status === 'connected';
  const envOk = navanConfigured();

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
          <h1 className="text-xl font-semibold text-ink">Navan</h1>
          <p className="text-sm text-ink-3">
            Pulls travel bookings + receipts from Foundry&apos;s Navan
            account, lands them as Expense rows in /bills/intake. Owner
            is matched by traveller email → Person.email; unmatched
            travellers are skipped + reported on each sync.
          </p>
        </div>
        <Badge
          variant={
            connected ? 'green' : envOk ? 'outline' : 'amber'
          }
        >
          {connected
            ? 'Connected'
            : envOk
              ? 'Disconnected'
              : 'Not configured'}
        </Badge>
      </header>

      {!connected && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-semibold uppercase tracking-wide text-ink-3">
              Connect
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-4 text-xs text-ink-3">
              Generate an API key + secret in Navan&apos;s admin console
              under <span className="font-mono">Settings → Integrations
              → API access</span>. The secret is encrypted at rest in
              the Integration row.
            </p>
            <ConnectForm />
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
              <Row label="Org id" value={cfg.orgId ?? '—'} mono />
              <Row
                label="Connected at"
                value={
                  cfg.connectedAt
                    ? formatLocalDateTime(new Date(cfg.connectedAt))
                    : '—'
                }
              />
              <Row
                label="Last sync"
                value={
                  row?.lastSyncAt
                    ? formatLocalDateTime(row.lastSyncAt)
                    : 'Never'
                }
              />
              <Row
                label="Bookings watermark"
                value={cfg.lastBookingSyncedAt ?? '—'}
                mono
              />
              <Row
                label="Expenses watermark"
                value={cfg.lastExpenseSyncedAt ?? '—'}
                mono
              />
              <Row
                label="Token URL (override)"
                value={
                  cfg.tokenUrl ??
                  '— using default (api.navan.com/ta-auth/oauth/token) —'
                }
                mono
              />
              <Row
                label="Bookings URL (override)"
                value={
                  cfg.bookingsUrl ??
                  '— using default (api.navan.com/v1/bookings) —'
                }
                mono
              />
              <Row
                label="Expenses URL (override)"
                value={
                  cfg.expensesUrl ??
                  '— BDI credentials cover bookings only — leave blank —'
                }
                mono
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-semibold uppercase tracking-wide text-ink-3">
                Actions
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <RunSyncButton />
              <p className="text-xs text-ink-3">
                Pulls every booking + expense Navan has updated since
                the watermark and lands them as Expense rows in{' '}
                <Link
                  href="/bills/intake"
                  className="text-brand hover:underline"
                >
                  /bills/intake
                </Link>
                . Idempotent — re-runs are safe.
              </p>
              <hr className="border-line" />
              <DisconnectButton />
              <p className="text-xs text-ink-3">
                Wipes credentials + watermarks. Existing imported
                expenses stay put.
              </p>
            </CardContent>
          </Card>
        </>
      )}

      {/* CSV import is always available — useful as a backfill path
           (bookings made before the integration was wired up) AND as
           a fallback when the live BDI API isn't returning the
           expected response shape. Works whether or not the API is
           connected. */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold uppercase tracking-wide text-ink-3">
            Manual CSV import
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="text-xs text-ink-3">
            Upload the Navan bookings CSV report (Navan admin →
            Reports → Bookings → Download CSV). Each row becomes an
            Expense in <code className="font-mono">submitted</code>{' '}
            status with an Approval row attached — same shape as the
            receipt-upload flow. Idempotent: re-uploading the same
            report skips already-imported bookings via the{' '}
            <code className="font-mono">navan:booking:&lt;id&gt;</code>{' '}
            prefix. Voided rows are dropped automatically. Trip names
            that contain a project code (e.g.{' '}
            <code className="font-mono">MQH001 Feb 2026</code>) auto-tag
            the matching project.
          </p>
          <ImportCsvButton />
        </CardContent>
      </Card>
    </div>
  );
}

function Row({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-ink-3">{label}</span>
      <span className={`text-right text-ink-2 ${mono ? 'font-mono text-xs' : ''}`}>
        {value}
      </span>
    </div>
  );
}
