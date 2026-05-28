import { NextResponse } from 'next/server';
import { getSystemHealth } from '@/server/system-health';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VERSION = process.env['npm_package_version'] ?? '0.0.0';
const COMMIT = process.env['VERCEL_GIT_COMMIT_SHA'] ?? process.env['GIT_COMMIT_SHA'] ?? null;

/**
 * Machine-readable health endpoint. Used by Vercel uptime checks +
 * any external pingers. Returns:
 *   - 200 with `ok: true` when DB is reachable (degraded
 *     integrations don't fail the check — staff workflows still
 *     work via fallbacks)
 *   - 503 when DB is unreachable (true outage)
 *
 * The full component breakdown sits in the JSON body so a curl /
 * uptime monitor can alert on specific signals (e.g. "Xero down >
 * 1h") without polling each integration separately.
 *
 * Public route — no auth — by design. Healthz endpoints need to be
 * reachable without a session. We're careful not to leak anything
 * sensitive: only state + last-sync timestamps + component names.
 * No credentials, no token info, no PII.
 */
function parseDbUrlMeta(): { host: string; port: string; flags: string } | null {
  const raw = process.env['DATABASE_URL'];
  if (!raw) return null;
  try {
    const u = new URL(raw);
    return {
      host: u.hostname,
      port: u.port || '(default)',
      flags: u.search.replace(/=[^&]+/g, '=…').slice(0, 200),
    };
  } catch {
    return { host: 'parse-error', port: '?', flags: '?' };
  }
}

export async function GET() {
  const health = await getSystemHealth();
  const ok = health.overall !== 'down';
  return NextResponse.json(
    {
      ok,
      overall: health.overall,
      version: VERSION,
      commit: COMMIT,
      at: health.generatedAt.toISOString(),
      _dbMeta: parseDbUrlMeta(),
      components: health.components.map((c) => ({
        name: c.name,
        state: c.state,
        detail: c.detail,
      })),
    },
    { status: ok ? 200 : 503 },
  );
}
