import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSession } from '@/server/session';
import { hasCapability } from '@/server/capabilities';
import {
  getUberIntegration,
  uberConfigured,
  type UberConfig,
} from '@/server/integrations/uber';
import { getUberEmailIntakeStats } from '@/server/integrations/uber-email-intake';
import { formatLocalDateTime } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  ConnectForm,
  DisconnectButton,
  RunSyncButton,
  ImportCsvButton,
  SftpConfigForm,
  ClearSftpButton,
  RunSftpPullButton,
} from './client';

/**
 * Admin connection panel for Uber for Business.
 *
 * Mirrors the Navan integration UX: connect via client id +
 * secret, then run sync to pull trip data. Trips land as
 * firm-paid Bills attributed to the rider, in /approvals for
 * project allocation.
 */
export default async function UberIntegrationPage() {
  const session = await getSession();
  if (!session || !hasCapability(session, 'integration.manage')) notFound();

  const row = await getUberIntegration();
  const cfg = (row?.config ?? {}) as UberConfig;
  const connected = row?.status === 'connected';
  const envOk = uberConfigured();
  const emailIntake = await getUberEmailIntakeStats();

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
          <h1 className="text-xl font-semibold text-ink">Uber for Business</h1>
          <p className="text-sm text-ink-3">
            Pulls trips from Foundry&apos;s Uber for Business account,
            lands them as firm-paid Bills attributed to the rider.
            Already paid by the corporate AMEX on Uber&apos;s side, so
            the Bill is for cost-attribution + project allocation,
            not reimbursement.
          </p>
        </div>
        <Badge
          variant={connected ? 'green' : envOk ? 'outline' : 'amber'}
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
              Create an OAuth app in Uber&apos;s developer portal at{' '}
              <code className="font-mono">developer.uber.com</code> →
              your organisation, then grant it the{' '}
              <code className="font-mono">business.trips:read</code>{' '}
              scope. Note the resulting Client ID + Client Secret.
              The secret is encrypted at rest in the Integration row.
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
                label="Trips watermark"
                value={cfg.lastTripSyncedAt ?? '—'}
                mono
              />
              <Row
                label="Token URL (override)"
                value={
                  cfg.tokenUrl ??
                  '— using default (login.uber.com/oauth/v2/token) —'
                }
                mono
              />
              <Row
                label="Trips URL (override)"
                value={
                  cfg.tripsUrl ??
                  '— using default (api.uber.com/v1/business/trips) —'
                }
                mono
              />
              <Row
                label="Scope (override)"
                value={cfg.scope ?? '— using default (business.trips:read) —'}
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
                Pulls every trip Uber has logged since the watermark
                and lands them as Bills in{' '}
                <Link
                  href="/approvals"
                  className="text-brand hover:underline"
                >
                  /approvals
                </Link>{' '}
                for project allocation. Idempotent — re-runs are safe.
                Canceled trips are skipped.
              </p>
              <hr className="border-line" />
              <DisconnectButton />
              <p className="text-xs text-ink-3">
                Wipes credentials + watermark. Existing imported
                Bills stay put.
              </p>
            </CardContent>
          </Card>
        </>
      )}

      {/* SFTP delivery — Uber's standard enterprise feed.
           Foundry pulls trip CSVs daily from Uber's SFTP endpoint;
           same file shape as the manual upload, so the CSV parser
           handles both. Separate from the REST API path above
           because Uber for Business issues SFTP credentials and
           OAuth API access as independent channels. */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold uppercase tracking-wide text-ink-3">
            SFTP delivery (Uber for Business standard feed)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {cfg.sftp ? (
            <>
              <div className="space-y-1">
                <Row label="Host" value={cfg.sftp.host} mono />
                <Row
                  label="Port"
                  value={String(cfg.sftp.port)}
                  mono
                />
                <Row label="Username" value={cfg.sftp.username} mono />
                <Row label="Remote dir" value={cfg.sftp.remoteDir} mono />
                <Row
                  label="File pattern"
                  value={cfg.sftp.filePattern ?? '.csv (default)'}
                  mono
                />
                <Row
                  label="Last pull"
                  value={
                    cfg.sftp.lastPullAt
                      ? formatLocalDateTime(new Date(cfg.sftp.lastPullAt))
                      : 'Never'
                  }
                />
                <Row
                  label="Files imported"
                  value={String(cfg.sftp.importedFiles?.length ?? 0)}
                />
              </div>
              <RunSftpPullButton />
              <p className="text-xs text-ink-3">
                Connects to Uber&apos;s SFTP, lists the remote dir,
                downloads any CSVs we haven&apos;t seen before, and
                feeds each through the same parser as the manual
                upload. Per-file idempotency (skipping already-seen
                filenames) and per-trip dedupe (via{' '}
                <code className="font-mono">uber:trip:&lt;id&gt;</code>{' '}
                prefix) both apply.
              </p>
              <hr className="border-line" />
              <ClearSftpButton />
              <p className="text-xs text-ink-3">
                Wipes the SFTP block (host / key / imported-files
                list). Existing imported Bills stay put. Use when
                rotating SSH keys.
              </p>
            </>
          ) : (
            <>
              <p className="text-xs text-ink-3">
                Uber for Business&apos; standard enterprise feed
                delivers trip activity as daily CSV files dropped to
                an SFTP endpoint. After enabling Employee SFTP in
                your Uber for Business admin panel, paste the
                connection details Uber emails you below. The private
                key is encrypted at rest and never returned to the
                client.
              </p>
              <SftpConfigForm />
            </>
          )}
        </CardContent>
      </Card>

      {/* Email-intake (Power Automate → SharePoint → cron). Paired
           with the M365 Power Automate flow documented in
           INTEGRATIONS.md §6: TT's mailbox flow watches for
           `noreply@uber.com` ride receipts, drops each PDF into the
           SharePoint inbox folder; the /api/cron/uber-receipts-pull
           cron (every 15 min) lists, OCRs, lands an Expense
           attributed to the rider, and moves the file to
           Processed/YYYY-MM-DD/. Creates Expense (reimbursable) rows
           rather than Bills — the email-receipt channel is for rides
           paid on personal cards. Corporate-AMEX rides still flow as
           Bills via the SFTP / CSV path above. */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold uppercase tracking-wide text-ink-3">
            Email-intake (Power Automate → SharePoint, every 15 min)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="space-y-1">
            <Row
              label="SharePoint enabled"
              value={emailIntake.configured ? 'Yes' : 'No — set ENTRA_* + SHAREPOINT_SITE_URL'}
            />
            <Row label="Inbox folder" value={emailIntake.inboxPath} mono />
            <Row label="Processed root" value={emailIntake.processedPath} mono />
            <Row
              label="Last poll"
              value={
                emailIntake.lastPollAt
                  ? formatLocalDateTime(emailIntake.lastPollAt)
                  : 'Never'
              }
            />
            <Row
              label="Files imported (24h)"
              value={String(emailIntake.filesImported24h)}
            />
            <Row
              label="Files unmatched (24h)"
              value={String(emailIntake.filesUnmatched24h)}
            />
            <Row
              label="Files failed (24h)"
              value={String(emailIntake.filesFailed24h)}
            />
            {emailIntake.lastResult?.skippedReason && (
              <Row
                label="Last poll status"
                value={`Skipped — ${emailIntake.lastResult.skippedReason}`}
              />
            )}
          </div>
          <p className="text-xs text-ink-3">
            Pairs with a one-time M365 Power Automate flow on TT&apos;s
            (or a shared) mailbox. Setup recipe in{' '}
            <code className="font-mono">INTEGRATIONS.md</code> §6. PDFs
            land as personal-card expenses attributed to the rider,
            queued in <code className="font-mono">/approvals</code>.
            Receipts paid on the corporate AMEX continue to arrive via
            the SFTP / CSV channels above as Bills.
          </p>
        </CardContent>
      </Card>

      {/* Manual CSV import — always available. Useful as a backfill
           (trips from before the integration was connected) and as a
           fallback when the API isn't returning data. */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold uppercase tracking-wide text-ink-3">
            Manual CSV import
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="text-xs text-ink-3">
            Upload the Uber for Business trip activity CSV (admin →
            Reports → Trip activity → Download CSV). Each row becomes
            a Bill in <code className="font-mono">pending_review</code>{' '}
            status with an Approval row attached. Idempotent:
            re-uploading the same report skips already-imported trips
            via the{' '}
            <code className="font-mono">uber:trip:&lt;id&gt;</code>{' '}
            prefix. Canceled rows are dropped automatically. Expense
            codes or memos that contain a project code (e.g.{' '}
            <code className="font-mono">MQH001</code>) auto-tag the
            matching project.
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
      <span
        className={`text-right text-ink-2 ${mono ? 'font-mono text-xs' : ''}`}
      >
        {value}
      </span>
    </div>
  );
}
