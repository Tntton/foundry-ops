import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSession } from '@/server/session';
import { hasCapability } from '@/server/capabilities';
import { getMailIntakeStats } from '@/server/integrations/m365-mail-intake';
import { formatLocalDateTime } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { MailboxToggleButton } from './client';

/**
 * AP autoharvest admin surface (TASK-093).
 *
 * One card per MailboxPollCursor row. Shows last-poll timestamp, 24h
 * counters (candidates, bills created, low-confidence, failed extracts),
 * recent failure drilldown, and a toggle to enable/disable polling per
 * mailbox. Toggling trung@ off is the "vendor migration complete"
 * checkpoint — see INTEGRATIONS.md §7 migration plan.
 */
export default async function MailIntakePage() {
  const session = await getSession();
  if (!session || !hasCapability(session, 'integration.manage')) notFound();

  const stats = await getMailIntakeStats();

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
          <h1 className="text-xl font-semibold text-ink">Mail intake (AP autoharvest)</h1>
          <p className="text-sm text-ink-3">
            Every 15 min, polls each enabled mailbox via Microsoft Graph,
            extracts invoice fields from PDF/image attachments via{' '}
            <code className="font-mono">claude-sonnet</code>, and lands a
            Bill in{' '}
            <Link
              href="/approvals"
              className="text-brand hover:underline"
            >
              /approvals
            </Link>{' '}
            for review. Full flow in{' '}
            <code className="font-mono">INTEGRATIONS.md</code> §7.
          </p>
        </div>
        <Badge variant={stats.configured ? 'green' : 'amber'}>
          {stats.configured ? 'Graph configured' : 'Graph not configured'}
        </Badge>
      </header>

      {!stats.configured && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-semibold uppercase tracking-wide text-ink-3">
              Setup required
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-ink-2">
            <p>
              Set{' '}
              <code className="font-mono">ENTRA_TENANT_ID</code>,{' '}
              <code className="font-mono">ENTRA_CLIENT_ID</code>, and{' '}
              <code className="font-mono">ENTRA_CLIENT_SECRET</code> in
              the environment, then grant{' '}
              <code className="font-mono">Mail.Read</code> (Application)
              on the Foundry Ops Entra app registration and admin-consent
              for the tenant.
            </p>
            <p className="text-xs text-ink-3">
              Restrict the app to the two intake mailboxes via Exchange
              Online <code className="font-mono">New-ApplicationAccessPolicy</code>{' '}
              before enabling the cron in production — see{' '}
              <code className="font-mono">INTEGRATIONS.md</code> §7 for
              the PowerShell recipe.
            </p>
          </CardContent>
        </Card>
      )}

      {stats.perMailbox.length === 0 && (
        <Card>
          <CardContent className="py-6 text-sm text-ink-3">
            No mailbox cursor rows found. Run{' '}
            <code className="font-mono">pnpm db:seed</code> to create rows
            for <code className="font-mono">finance@foundry.health</code>{' '}
            and <code className="font-mono">trung@foundry.health</code>,
            or add rows manually via Prisma Studio.
          </CardContent>
        </Card>
      )}

      {stats.perMailbox.map((mb) => (
        <MailboxCard key={mb.mailboxUpn} mailbox={mb} />
      ))}
    </div>
  );
}

function MailboxCard({
  mailbox,
}: {
  mailbox: Awaited<ReturnType<typeof getMailIntakeStats>>['perMailbox'][number];
}) {
  const isStale =
    mailbox.enabled &&
    (mailbox.lastPollAt === null ||
      Date.now() - mailbox.lastPollAt.getTime() > 60 * 60 * 1000);
  const badgeVariant = !mailbox.enabled
    ? 'outline'
    : mailbox.lastError
      ? 'amber'
      : isStale
        ? 'amber'
        : 'green';
  const badgeLabel = !mailbox.enabled
    ? 'Disabled'
    : mailbox.lastError
      ? 'Error'
      : isStale
        ? 'Stale'
        : 'Up';

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <CardTitle className="text-sm font-semibold text-ink">
            <span className="font-mono">{mailbox.mailboxUpn}</span>
          </CardTitle>
          <Badge variant={badgeVariant}>{badgeLabel}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <div className="space-y-1">
          <Row
            label="Last poll"
            value={
              mailbox.lastPollAt
                ? formatLocalDateTime(mailbox.lastPollAt)
                : 'Never'
            }
          />
          <Row
            label="Watermark"
            value={
              mailbox.lastReceivedDateTime
                ? formatLocalDateTime(mailbox.lastReceivedDateTime)
                : 'First run pending'
            }
            mono
          />
          {mailbox.lastError && (
            <Row
              label="Last error"
              value={mailbox.lastError}
              danger
            />
          )}
          <Row
            label="Candidates scanned (24h)"
            value={String(mailbox.candidatesScanned24h)}
          />
          <Row
            label="Bills created (24h)"
            value={String(mailbox.billsCreated24h)}
          />
          <Row
            label="Low-confidence (24h)"
            value={String(mailbox.lowConfidenceCount24h)}
          />
          <Row
            label="Failed extracts (24h)"
            value={String(mailbox.failedExtracts24h)}
          />
          {mailbox.toggledByPersonName && (
            <Row
              label="Last toggled by"
              value={mailbox.toggledByPersonName}
            />
          )}
        </div>

        {mailbox.recentFailures.length > 0 && (
          <div>
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-3">
              Recent failures
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-line text-left text-ink-3">
                    <th className="py-1 pr-2 font-normal">When</th>
                    <th className="py-1 pr-2 font-normal">From</th>
                    <th className="py-1 pr-2 font-normal">Subject</th>
                    <th className="py-1 pr-2 font-normal">Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {mailbox.recentFailures.map((f) => (
                    <tr
                      key={`${f.at.toISOString()}-${f.messageId}`}
                      className="border-b border-line"
                    >
                      <td className="py-1 pr-2 text-ink-3 whitespace-nowrap">
                        {formatLocalDateTime(f.at)}
                      </td>
                      <td className="py-1 pr-2 text-ink-2 font-mono">
                        {f.fromAddress ?? '—'}
                      </td>
                      <td className="py-1 pr-2 text-ink-2">
                        {f.subject ?? '(no subject)'}
                      </td>
                      <td className="py-1 pr-2 text-ink-3">{f.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="border-t border-line pt-3">
          <MailboxToggleButton
            mailboxUpn={mailbox.mailboxUpn}
            enabled={mailbox.enabled}
          />
          {mailbox.mailboxUpn === 'trung@foundry.health' && (
            <p className="mt-2 text-xs text-ink-3">
              Transitional mailbox — disable once vendors have migrated
              to <code className="font-mono">finance@foundry.health</code>.
              See <code className="font-mono">INTEGRATIONS.md</code> §7
              migration plan.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function Row({
  label,
  value,
  mono,
  danger,
}: {
  label: string;
  value: string;
  mono?: boolean;
  danger?: boolean;
}) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-ink-3">{label}</span>
      <span
        className={
          'text-right ' +
          (danger ? 'text-red' : 'text-ink-2') +
          (mono ? ' font-mono text-xs' : '')
        }
      >
        {value}
      </span>
    </div>
  );
}
