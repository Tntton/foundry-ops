import { notFound } from 'next/navigation';
import { getSession } from '@/server/session';
import { hasCapability } from '@/server/capabilities';
import { prisma } from '@/server/db';
import { optionalEnv } from '@/server/env';
import { graphConfigured } from '@/server/graph';
import { resolveBackupsRoot } from '@/server/exports/sharepoint-backup';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { RunExportNowButton } from './run-export-button';

/**
 * Admin business-continuity exports page. Shows:
 *   - What the export covers (tables, redactions, size estimate)
 *   - "Run export now" trigger
 *   - History of recent exports from the audit log
 *   - Schedule + env-prereq status (so admin can tell at a glance
 *     why an upload skipped, if it did)
 */

export default async function ExportsPage() {
  const session = await getSession();
  if (!session || !hasCapability(session, 'integration.manage')) notFound();

  // Recent export runs from the audit log — both successful runs
  // (data_export_generated) and upload failures (data_export_upload_failed)
  // so the operator can see the full trail in one place.
  const recent = await prisma.auditEvent.findMany({
    where: {
      entityType: 'integration',
      entityId: 'sharepoint-backup',
      action: {
        in: ['data_export_generated', 'data_export_upload_failed'],
      },
    },
    orderBy: { at: 'desc' },
    take: 30,
    include: {
      actor: {
        select: { firstName: true, lastName: true, initials: true },
      },
    },
  });

  const siteUrl = optionalEnv('SHAREPOINT_SITE_URL');
  const adminRoot = optionalEnv('SHAREPOINT_ADMIN_ROOT');
  const backupsRoot = resolveBackupsRoot();
  const backupsRootExplicit = Boolean(optionalEnv('SHAREPOINT_BACKUPS_ROOT'));
  const graphOk = graphConfigured();
  const uploadReady = graphOk && Boolean(siteUrl) && Boolean(backupsRoot);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-ink">
          Business-continuity exports
        </h1>
        <p className="text-sm text-ink-3">
          Snapshot exports of the critical operating tables, uploaded
          to a secure SharePoint admin folder. Designed so the team
          can keep working manually in Excel during a platform outage
          and reconcile back when the system is online again.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Where backups land</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="rounded-md border border-status-blue bg-status-blue-soft/30 px-3 py-2">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-status-blue">
              SharePoint folder
            </div>
            <code className="mt-1 block break-all font-mono text-xs text-ink">
              {siteUrl ?? '<SHAREPOINT_SITE_URL>'} /{' '}
              {backupsRoot ?? '<SHAREPOINT_BACKUPS_ROOT>'} /{' '}
              &lt;YYYY-MM-DD&gt; / foundry-ops-export-*.zip
            </code>
            <div className="mt-1 text-[11px] text-ink-3">
              {backupsRootExplicit
                ? '(Resolved via SHAREPOINT_BACKUPS_ROOT — dedicated backups folder.)'
                : adminRoot
                  ? '(Resolved via fallback: SHAREPOINT_ADMIN_ROOT/00 Backups. Set SHAREPOINT_BACKUPS_ROOT to point at a dedicated folder if you want backups isolated from per-project admin paperwork.)'
                  : '(Backups root unresolved — set SHAREPOINT_BACKUPS_ROOT or SHAREPOINT_ADMIN_ROOT.)'}
            </div>
            <div className="mt-1 text-[11px] text-ink-3">
              <strong>Access control</strong> is enforced on the
              SharePoint side — the folder must be restricted to the
              admin / super_admin M365 group. This service writes to
              the path the admin has already locked down; it does not
              manage ACLs.
            </div>
          </div>
          <p className="text-ink-2">
            Each run bundles the following as CSVs inside one ZIP:
          </p>
          <ul className="list-disc space-y-0.5 pl-5 text-ink-3">
            <li>
              <span className="text-ink-2">People</span> — directory
              roster (PII redacted: no bank, super, TFN, emergency
              contact)
            </li>
            <li>
              <span className="text-ink-2">Projects</span> — active
              engagements (kickoff / delivery / closing / standing)
              with primary partner + manager + SharePoint links
            </li>
            <li>
              <span className="text-ink-2">Clients</span> — all client
              orgs with contact details + ABN
            </li>
            <li>
              <span className="text-ink-2">Bills (open)</span> —
              pending review / approved / scheduled-for-payment AP
            </li>
            <li>
              <span className="text-ink-2">Invoices (open)</span> —
              draft / sent / partial / overdue AR
            </li>
            <li>
              <span className="text-ink-2">Expenses (last 90d)</span>{' '}
              — submitted + approved receipts with project + vendor
            </li>
            <li>
              <span className="text-ink-2">Timesheets (last 90d)</span>
              {' '}— submitted + approved hours
            </li>
            <li>
              <span className="text-ink-2">Rate card</span> — all
              effective rows (cost + bill-low + bill-high per role
              code)
            </li>
            <li>
              <span className="text-ink-2">Approvals (pending)</span>{' '}
              — open decision queue
            </li>
            <li>
              <span className="text-ink-2">Audit log (last 180d)</span>
              {' '}— recent mutations + actors
            </li>
            <li>
              <span className="text-ink-2">README</span> — recovery
              workflow notes
            </li>
          </ul>
          <p className="mt-2 rounded-md border border-status-amber bg-status-amber-soft/30 px-3 py-2 text-xs text-status-amber">
            <strong>Redacted by design</strong> — Person bank details,
            super fund id, TFN, and emergency contacts are never
            included. They&apos;re encrypted at rest and stay in the DB
            even on admin-tier exports per A6 (deny-by-default PII).
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Run an export now</CardTitle>
          <p className="text-xs text-ink-3">
            Same pipeline as the nightly cron — useful right before
            stepping into a planned maintenance window or when you
            want a fresh copy on demand.
          </p>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {!uploadReady && (
            <div className="rounded-md border border-status-amber bg-status-amber-soft/30 px-3 py-2 text-xs text-status-amber">
              <strong>Upload not ready</strong> — exports will still
              generate locally but the SharePoint upload step will
              skip until you set:
              <ul className="ml-4 mt-1 list-disc">
                {!graphOk && (
                  <li>
                    <code className="font-mono text-xs">ENTRA_*</code>{' '}
                    (Graph auth)
                  </li>
                )}
                {!siteUrl && (
                  <li>
                    <code className="font-mono text-xs">
                      SHAREPOINT_SITE_URL
                    </code>
                  </li>
                )}
                {!backupsRoot && (
                  <li>
                    <code className="font-mono text-xs">
                      SHAREPOINT_BACKUPS_ROOT
                    </code>{' '}
                    (or{' '}
                    <code className="font-mono text-xs">
                      SHAREPOINT_ADMIN_ROOT
                    </code>{' '}
                    as fallback)
                  </li>
                )}
              </ul>
            </div>
          )}
          <RunExportNowButton />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Schedule + status</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          <Row label="Cron">
            <span>
              <code className="font-mono text-xs">0 16 * * *</code>{' '}
              UTC · <strong>daily</strong> at 02:00 AEST / 03:00 AEDT
            </span>
          </Row>
          <Row label="Endpoint">
            <code className="font-mono text-xs">
              /api/cron/data-export
            </code>
          </Row>
          <Row label="SharePoint site">
            {siteUrl ? (
              <span className="font-mono break-all text-xs text-ink-2">
                {siteUrl}
              </span>
            ) : (
              <span className="text-status-amber">not configured</span>
            )}
          </Row>
          <Row label="Backups root">
            {backupsRoot ? (
              <span className="font-mono text-xs text-ink-2">
                /{backupsRoot}
              </span>
            ) : (
              <span className="text-status-amber">not configured</span>
            )}
          </Row>
          <Row label="Source">
            <Badge
              variant={backupsRootExplicit ? 'green' : 'blue'}
              className="text-[10px]"
            >
              {backupsRootExplicit
                ? 'SHAREPOINT_BACKUPS_ROOT'
                : 'SHAREPOINT_ADMIN_ROOT (fallback)'}
            </Badge>
          </Row>
          <Row label="Graph">
            <Badge variant={graphOk ? 'green' : 'amber'}>
              {graphOk ? 'connected' : 'not configured'}
            </Badge>
          </Row>
          <Row label="Manual push">
            <span className="text-ink-2">
              Use the &ldquo;Run export now&rdquo; button above —
              fires the same pipeline on demand.
            </span>
          </Row>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            Recent exports{' '}
            <span className="text-xs font-normal text-ink-3">
              (last 30 runs)
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {recent.length === 0 ? (
            <p className="p-6 text-center text-sm text-ink-3">
              No exports recorded yet. Run one now or wait for the
              next cron slot.
            </p>
          ) : (
            <table className="w-full text-xs">
              <thead className="bg-surface-subtle text-ink-3">
                <tr>
                  <th className="px-3 py-2 text-left">When</th>
                  <th className="px-3 py-2 text-left">Trigger</th>
                  <th className="px-3 py-2 text-left">File</th>
                  <th className="px-3 py-2 text-right">Size</th>
                  <th className="px-3 py-2 text-left">Outcome</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((r) => {
                  const delta =
                    (r.entityDelta as Record<string, unknown> | null)
                      ?.after ?? r.entityDelta;
                  const after = delta as
                    | {
                        filename?: string;
                        sizeBytes?: number;
                        webUrl?: string;
                        uploadSkipped?: boolean;
                        via?: string;
                        error?: string;
                      }
                    | null;
                  const isFailure = r.action === 'data_export_upload_failed';
                  const actorLabel =
                    r.actor
                      ? `${r.actor.firstName} ${r.actor.lastName}`
                      : r.actorType === 'system'
                        ? 'cron'
                        : '—';
                  return (
                    <tr key={r.id} className="border-t border-line">
                      <td className="px-3 py-2 tabular-nums text-ink-2">
                        {r.at.toLocaleString('en-AU')}
                      </td>
                      <td className="px-3 py-2">
                        <Badge
                          variant={
                            after?.via === 'manual' ? 'blue' : 'outline'
                          }
                          className="text-[10px]"
                        >
                          {after?.via === 'manual' ? 'manual' : 'cron'}
                        </Badge>
                        <span className="ml-1 text-ink-3">
                          {actorLabel}
                        </span>
                      </td>
                      <td className="px-3 py-2 font-mono text-[11px] text-ink-2">
                        {after?.filename ?? '—'}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-ink-3">
                        {after?.sizeBytes
                          ? `${(after.sizeBytes / 1024).toFixed(1)} KB`
                          : '—'}
                      </td>
                      <td className="px-3 py-2">
                        {isFailure ? (
                          <span className="text-status-red">
                            ✗ upload failed
                            {after?.error && (
                              <span className="ml-1 text-[10px] text-ink-3">
                                — {after.error.slice(0, 80)}
                              </span>
                            )}
                          </span>
                        ) : after?.uploadSkipped ? (
                          <span className="text-status-amber">
                            ⚠ upload skipped (Graph not configured)
                          </span>
                        ) : after?.webUrl ? (
                          <a
                            href={after.webUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-status-green underline-offset-2 hover:underline"
                          >
                            ✓ uploaded · open →
                          </a>
                        ) : (
                          <span className="text-status-green">✓ ok</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recovery workflow</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-ink-2">
          <p>
            <strong>During an outage</strong>: download the most
            recent ZIP from SharePoint, open the relevant CSV in
            Excel, keep working. Save dated copies of any file you
            edit so you have a clear delta record.
          </p>
          <p>
            <strong>When the platform comes back online</strong>:
            admin uploads the working copies via the (planned){' '}
            <em>Apply outage deltas</em> surface, which validates +
            applies the changes back to the DB with audit events
            stamped{' '}
            <code className="font-mono text-xs">
              outage_recovery_import
            </code>
            . That reverse-sync surface is on the build backlog —
            until it ships, manual reconciliation is the recovery
            path.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3 py-0.5">
      <span className="text-ink-3">{label}</span>
      <span className="text-right text-ink-2">{children}</span>
    </div>
  );
}
