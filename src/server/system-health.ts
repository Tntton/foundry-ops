import { prisma } from '@/server/db';
import { optionalEnv } from '@/server/env';
import { graphConfigured } from '@/server/graph';

/**
 * Unified system-health snapshot. Surfaces:
 *   - Database connectivity (DB up / down)
 *   - LLM API (Anthropic key configured + last successful agent run)
 *   - Each integration (Xero / Navan / Uber / DocuSign / WhatsApp /
 *     M365 / SharePoint) — connection status from Integration row,
 *     plus last sync timestamp
 *   - Last daily-backup completion (from the most recent AuditEvent
 *     of action='data_export_generated')
 *   - Cron heartbeats (last fire per cron, from AuditEvent)
 *
 * Used by `/healthz` (machine-readable) + `/system-status` (human-
 * readable page). Per the contingency design: when an integration
 * is "degraded" or "down", staff need to know which manual
 * fallback applies. The page renders that mapping; this helper just
 * collects the raw signals.
 */

export type HealthState = 'up' | 'degraded' | 'down' | 'not_configured';

export type ComponentHealth = {
  name: string;
  state: HealthState;
  /** One-line human summary. "Last sync 3h ago" / "API key not set" / etc. */
  detail: string;
  /** Optional fallback hint when degraded — what the operator should do. */
  fallback?: string;
};

export type SystemHealth = {
  overall: HealthState;
  generatedAt: Date;
  components: ComponentHealth[];
};

function formatAgo(d: Date): string {
  const ms = Date.now() - d.getTime();
  if (ms < 0) return 'in the future (clock skew)';
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export async function getSystemHealth(): Promise<SystemHealth> {
  const components: ComponentHealth[] = [];
  const generatedAt = new Date();

  // ── 1. Database ──────────────────────────────────────────────
  let dbState: HealthState = 'down';
  let dbDetail = 'Connection failed';
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbState = 'up';
    dbDetail = 'Supabase Postgres reachable';
  } catch (err) {
    dbDetail = `Postgres error: ${(err as Error).message}`;
  }
  components.push({
    name: 'Database',
    state: dbState,
    detail: dbDetail,
    fallback: dbState === 'up' ? undefined : 'Full system outage — staff fall back to Excel templates in SharePoint admin folder. See contingency runbook.',
  });

  // ── 2. Anthropic LLM ─────────────────────────────────────────
  // We don't probe Anthropic live (would cost tokens). Configured
  // vs not is the signal; degraded state surfaces when receipt
  // OCR fails repeatedly (TODO when extraction-failure tracking
  // lands).
  const anthropicKey = optionalEnv('ANTHROPIC_API_KEY');
  components.push({
    name: 'Anthropic LLM',
    state: anthropicKey ? 'up' : 'not_configured',
    detail: anthropicKey
      ? 'API key configured · receipt OCR + AP intake live'
      : 'ANTHROPIC_API_KEY not set — receipt OCR will fall back to manual entry',
    fallback: anthropicKey
      ? 'If Anthropic API outage hits: receipt-upload field extraction degrades to empty placeholders — staff continue uploading + admin fills fields manually. No data loss.'
      : undefined,
  });

  // ── 3. Integrations (from Integration row) ────────────────────
  const integrations = await prisma.integration.findMany({
    select: {
      kind: true,
      status: true,
      lastSyncAt: true,
    },
  });
  // Known integration kinds — render even if not yet in the DB so
  // the page is complete.
  const knownKinds = [
    'xero',
    'navan',
    'uber',
    'docusign',
    'whatsapp',
    'paydotcomau',
    'm365',
  ] as const;
  const integByKind = new Map(integrations.map((i) => [i.kind, i]));
  for (const kind of knownKinds) {
    const row = integByKind.get(kind);
    const label = kindLabel(kind);
    if (!row) {
      components.push({
        name: label,
        state: 'not_configured',
        detail: 'Never connected',
      });
      continue;
    }
    const state: HealthState =
      row.status === 'connected'
        ? 'up'
        : row.status === 'error'
          ? 'down'
          : 'not_configured';
    const detail =
      row.status === 'connected' && row.lastSyncAt
        ? `Connected · last sync ${formatAgo(row.lastSyncAt)}`
        : row.status === 'connected'
          ? 'Connected · no sync yet'
          : `Status: ${row.status}`;
    components.push({
      name: label,
      state,
      detail,
      fallback: fallbackFor(kind, state),
    });
  }

  // ── 4. M365 + SharePoint (env-configured, no Integration row) ──
  const graphOk = graphConfigured();
  components.push({
    name: 'Microsoft 365 (Graph)',
    state: graphOk ? 'up' : 'not_configured',
    detail: graphOk
      ? 'Env-configured · user provisioning + SharePoint folders'
      : 'ENTRA_* env vars not set',
  });

  // ── 5. Last daily backup ─────────────────────────────────────
  const lastBackup = await prisma.auditEvent.findFirst({
    where: { action: 'data_export_generated' },
    orderBy: { at: 'desc' },
    select: { at: true },
  });
  const backupState: HealthState = !lastBackup
    ? 'not_configured'
    : Date.now() - lastBackup.at.getTime() < 48 * 3600 * 1000
      ? 'up'
      : 'degraded';
  components.push({
    name: 'Daily backup (SharePoint)',
    state: backupState,
    detail: lastBackup
      ? `Last export ${formatAgo(lastBackup.at)}`
      : 'No backup recorded yet — first run pending or cron not configured',
    fallback:
      backupState === 'degraded'
        ? 'Backup is >48h stale. Check Vercel cron logs for /api/cron/data-export. Manual export available via /admin/exports.'
        : undefined,
  });

  // ── Overall roll-up ──────────────────────────────────────────
  // 'down' if anything critical (DB) is down. 'degraded' if any
  // configured component is degraded or down (but DB is fine).
  // 'up' otherwise.
  let overall: HealthState = 'up';
  if (dbState === 'down') {
    overall = 'down';
  } else if (
    components.some(
      (c) =>
        c.state === 'down' ||
        (c.state === 'degraded' && c.name !== 'Anthropic LLM'),
    )
  ) {
    overall = 'degraded';
  }

  return { overall, generatedAt, components };
}

function kindLabel(kind: string): string {
  switch (kind) {
    case 'xero':
      return 'Xero';
    case 'navan':
      return 'Navan (travel)';
    case 'uber':
      return 'Uber for Business';
    case 'docusign':
      return 'DocuSign';
    case 'whatsapp':
      return 'WhatsApp Business';
    case 'paydotcomau':
      return 'pay.com.au (ABA)';
    case 'm365':
      return 'Microsoft 365 (legacy)';
    default:
      return kind;
  }
}

function fallbackFor(
  kind: string,
  state: HealthState,
): string | undefined {
  if (state === 'up') return undefined;
  switch (kind) {
    case 'xero':
      return 'If down: invoices + bills still tracked in Foundry. Xero push will retry on reconnect.';
    case 'navan':
    case 'uber':
      return 'If down: CSV manual import path still available via /admin/integrations/{navan,uber}.';
    case 'docusign':
      return 'If down: contracts revert to email-based signature (DocuSign separately, attach signed PDF to project).';
    case 'whatsapp':
      return 'If down: receipts and approvals routed through the web app only.';
    default:
      return undefined;
  }
}
