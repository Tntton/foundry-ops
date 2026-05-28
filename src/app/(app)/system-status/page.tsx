import { notFound } from 'next/navigation';
import { getSession } from '@/server/session';
import { hasAnyRole } from '@/server/roles';
import {
  getSystemHealth,
  type ComponentHealth,
  type HealthState,
} from '@/server/system-health';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * System status page — at-a-glance view of every integration +
 * core service. Shows degraded states inline with the manual-
 * fallback procedure for each, so staff seeing a yellow dot
 * know what to do next.
 *
 * Access: super_admin + admin only (sensitive — exposes which
 * external services we depend on). Read-only.
 */
export default async function SystemStatusPage() {
  const session = await getSession();
  if (!hasAnyRole(session, ['super_admin', 'admin'])) notFound();

  const health = await getSystemHealth();

  return (
    <div className="space-y-6">
      <header>
        <div className="flex flex-wrap items-baseline gap-3">
          <h1 className="text-xl font-semibold text-ink">System status</h1>
          <StateBadge state={health.overall} size="lg" />
        </div>
        <p className="mt-1 text-sm text-ink-3">
          Snapshot generated{' '}
          {health.generatedAt.toLocaleString('en-AU', {
            day: 'numeric',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit',
          })}
          . Reload to refresh.
        </p>
      </header>

      {health.overall !== 'up' && (
        <div
          className={`rounded-md border px-3 py-2 text-sm ${
            health.overall === 'down'
              ? 'border-status-red bg-status-red-soft text-status-red'
              : 'border-status-amber bg-status-amber-soft text-status-amber'
          }`}
        >
          <strong>
            {health.overall === 'down'
              ? 'Major outage'
              : 'Partial degradation'}
          </strong>{' '}
          —{' '}
          {health.overall === 'down'
            ? 'Core services are unreachable. See contingency runbook in SharePoint admin folder.'
            : 'One or more integrations are degraded. Staff workflows have manual fallbacks (see per-row notes). Foundry Ops itself remains operational.'}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Components</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {health.components.map((c) => (
            <ComponentRow key={c.name} c={c} />
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Contingency procedures</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-ink-2">
          <p>
            <strong>If the system is down for &gt; 1h:</strong> staff
            switch to Excel templates in the SharePoint admin folder
            (<code className="font-mono text-xs">/00 Backups/</code>).
            Continue logging timesheets, receipts, and bills offline
            — batch-import via CSV when the system comes back.
          </p>
          <p>
            <strong>If Anthropic is down:</strong> receipt OCR
            degrades gracefully — uploads still queue, fields just
            don&apos;t auto-fill. Staff and admin fill manually
            until restored. No data loss.
          </p>
          <p>
            <strong>If Xero is down:</strong> invoices + bills stay
            in Foundry. Xero push retries on the next sync cycle.
            For urgent payments, partners pay direct from Xero web
            and back-link the Foundry rows.
          </p>
          <p>
            <strong>If a specific integration is down</strong>{' '}
            (Navan / Uber / DocuSign / WhatsApp): the per-row
            fallback above tells you the manual workaround. Most
            have a CSV / email-based path that works while the API
            is offline.
          </p>
          <p className="pt-2 text-xs text-ink-3">
            Last daily backup ZIP is in the SharePoint admin
            <code className="font-mono">/00 Backups/</code>{' '}
            folder. Open the most recent and import into Excel for
            read-only ops continuity.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function ComponentRow({ c }: { c: ComponentHealth }) {
  return (
    <div
      className={`rounded-md border bg-surface-elev px-3 py-2 ${
        c.state === 'down'
          ? 'border-status-red'
          : c.state === 'degraded'
            ? 'border-status-amber'
            : 'border-line'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-ink">{c.name}</span>
        <StateBadge state={c.state} />
      </div>
      <div className="mt-0.5 text-xs text-ink-3">{c.detail}</div>
      {c.fallback && (
        <div className="mt-1 rounded-sm border-l-2 border-status-amber bg-status-amber-soft/30 px-2 py-1 text-[11px] text-ink-2">
          <span className="font-medium text-status-amber">Fallback:</span>{' '}
          {c.fallback}
        </div>
      )}
    </div>
  );
}

function StateBadge({
  state,
  size = 'sm',
}: {
  state: HealthState;
  size?: 'sm' | 'lg';
}) {
  const variant: 'green' | 'amber' | 'red' | 'outline' =
    state === 'up'
      ? 'green'
      : state === 'degraded'
        ? 'amber'
        : state === 'down'
          ? 'red'
          : 'outline';
  const label =
    state === 'up'
      ? 'Up'
      : state === 'degraded'
        ? 'Degraded'
        : state === 'down'
          ? 'Down'
          : 'Not configured';
  return (
    <Badge
      variant={variant}
      className={size === 'lg' ? 'text-xs' : 'text-[10px]'}
    >
      {label}
    </Badge>
  );
}
