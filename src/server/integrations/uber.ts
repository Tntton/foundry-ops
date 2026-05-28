import { prisma } from '@/server/db';
import { optionalEnv } from '@/server/env';
import { encryptJson, decryptJson } from '@/server/crypto';

/**
 * Uber for Business — Foundry's corporate Uber account (rides today,
 * Eats orders to follow). Trips are paid by the firm's AMEX directly
 * on the Uber platform, so they land on the AP side as **Bill** rows
 * with `attributedToPersonId` set to the rider — cost attribution,
 * not reimbursement. Same shape as the Navan integration.
 *
 * The integration:
 *   1. Authenticates with Uber via OAuth2 client-credentials grant.
 *      Credentials are stored encrypted in the Integration row's
 *      `config.credentials` blob (AES-GCM via @/server/crypto).
 *   2. Polls the Uber for Business Trips API for trips since our
 *      last watermark.
 *   3. Maps each trip → Bill row (supplier: "Uber",
 *      category: 'travel') routed by rider email →
 *      Person.email. Project auto-tag fires when the trip's
 *      expense_code or note carries a Foundry project code.
 *
 * The CSV export from the Uber Business portal is supported as a
 * backfill path in `uber-csv.ts` — same shape and idempotency.
 */

// Endpoints — overridable via env / per-tenant config so a path
// change on Uber's side or a regional swap (api.eu.uber.com) doesn't
// need a code edit. Defaults match Uber's published API docs as of
// 2026-05-11:
//   - Token: https://login.uber.com/oauth/v2/token
//   - Trips: https://api.uber.com/v1/business/trips
const UBER_API_BASE =
  optionalEnv('UBER_API_BASE') ?? 'https://api.uber.com';
const UBER_TOKEN_URL =
  optionalEnv('UBER_TOKEN_URL') ?? 'https://login.uber.com/oauth/v2/token';
const UBER_TRIPS_URL =
  optionalEnv('UBER_TRIPS_URL') ?? `${UBER_API_BASE}/v1/business/trips`;
// Uber's client_credentials grant requires an explicit scope (unlike
// Navan, which infers scopes from the credential). `business.trips:read`
// is sufficient for the rides pull. When Eats lands we'll add
// `business.orders:read` here.
const UBER_DEFAULT_SCOPE = 'business.trips:read';
const TRIPS_PAGE_LIMIT = 50;

export type UberTokens = {
  accessToken: string;
  expiresAt: number; // ms since epoch
};

export type UberConfig = {
  /** Encrypted JSON blob — `{ clientId, clientSecret }`. Never
   *  round-tripped to the client. Optional because some Uber for
   *  Business accounts only expose the SFTP feed (no REST API). */
  credentials?: string;
  /** Encrypted JSON blob — current `UberTokens`. Refreshed on demand. */
  tokens?: string;
  connectedAt: string;
  /** Uber Business Org id (optional, surfaced on the connection card). */
  orgId?: string | null;
  /** Per-tenant endpoint overrides. Uber occasionally rotates paths
   *  (e.g. the v1.2 trips endpoint exists alongside v1) — operator
   *  can paste the correct URL without a code edit. */
  tokenUrl?: string | null;
  tripsUrl?: string | null;
  /** Explicit scope override. Default is `business.trips:read`. When
   *  Eats support lands, set this to
   *  `business.trips:read business.orders:read` on connect. */
  scope?: string | null;
  /** Watermark for incremental syncs — ISO timestamp of the most
   *  recent trip `request_time` we've imported. */
  lastTripSyncedAt?: string | null;
  /** SFTP delivery channel. Uber for Business' standard "Employee
   *  SFTP" integration drops daily trip-activity CSVs to an SFTP
   *  endpoint — either Uber-hosted (we pull) or customer-hosted (Uber
   *  pushes). For Foundry we configure the pull side: connection
   *  details + ssh key live here, encrypted at rest. */
  sftp?: UberSftpConfig | null;
};

export type UberSftpConfig = {
  /** SFTP host as provisioned by Uber (e.g.
   *  `sftp.foundry.uberforbusiness.com` or the address listed in
   *  their setup email). */
  host: string;
  port: number; // typically 22
  username: string;
  /** Encrypted PEM-formatted SSH private key. Stored via `encryptJson`
   *  so it never round-trips to the client and can't be read from a
   *  DB snapshot. Uber sets up key-based auth; password auth is not
   *  supported on their SFTP service. */
  privateKey: string;
  /** Optional passphrase for the private key. Encrypted with the
   *  same envelope as `privateKey`. */
  passphrase?: string | null;
  /** Remote directory to list, e.g. `/outbound/trips/` or `/`. */
  remoteDir: string;
  /** Glob-ish substring matched against filenames (case-insensitive).
   *  Defaults to `.csv`. Use `trips` to filter only trip-activity
   *  files when Uber also drops employee-roster reports to the same
   *  directory. */
  filePattern?: string | null;
  /** Filenames we've already imported. Used for per-file idempotency
   *  on top of the per-trip dedupe inside the CSV parser. Capped at
   *  the most recent 200 entries to keep the JSON blob bounded —
   *  Uber's daily drops mean ~7 months of memory in 200 slots, more
   *  than enough to spot the latest file as new. */
  importedFiles?: string[];
  /** Last successful SFTP pull — ISO timestamp. */
  lastPullAt?: string | null;
};

export function uberConfigured(): boolean {
  // The integration is always considered "configured" — a fresh deploy
  // can click Connect with credentials directly, no env var prereq.
  return true;
}

export async function getUberIntegration() {
  return prisma.integration.findUnique({ where: { kind: 'uber' } });
}

export async function clearUberConnection(): Promise<void> {
  await prisma.integration.update({
    where: { kind: 'uber' },
    data: { status: 'disconnected', authRef: null, config: {} },
  });
}

/**
 * Persist the API credentials + flip status to `connected`. Called
 * by the admin "Connect Uber for Business" form.
 */
export async function saveUberConnection(opts: {
  clientId: string;
  clientSecret: string;
  orgId?: string | null;
  tokenUrl?: string | null;
  tripsUrl?: string | null;
  scope?: string | null;
}): Promise<void> {
  const credentials = encryptJson({
    clientId: opts.clientId,
    clientSecret: opts.clientSecret,
  });
  const config: UberConfig = {
    credentials,
    connectedAt: new Date().toISOString(),
    orgId: opts.orgId ?? null,
    tokenUrl: opts.tokenUrl ?? null,
    tripsUrl: opts.tripsUrl ?? null,
    scope: opts.scope ?? null,
    lastTripSyncedAt: null,
  };
  await prisma.integration.upsert({
    where: { kind: 'uber' },
    create: {
      kind: 'uber',
      status: 'connected',
      authRef: 'uber:config.credentials',
      config: JSON.parse(JSON.stringify(config)),
    },
    update: {
      status: 'connected',
      authRef: 'uber:config.credentials',
      config: JSON.parse(JSON.stringify(config)),
    },
  });
}

function readCredentials(integration: { config: unknown }): {
  clientId: string;
  clientSecret: string;
} {
  const cfg = (integration.config ?? {}) as UberConfig;
  if (!cfg.credentials) {
    throw new Error(
      'Uber REST credentials not set — only the SFTP feed is configured.',
    );
  }
  return decryptJson<{ clientId: string; clientSecret: string }>(
    cfg.credentials,
  );
}

/**
 * Persist SFTP delivery credentials. Either standalone (no REST API
 * configured) or alongside an existing OAuth connection — they're
 * independent feeds. Flips status to `connected` if nothing else is
 * set, otherwise leaves it as-is.
 *
 * The private key is encrypted with the same AES-GCM envelope as
 * other secrets in the codebase. We round-trip it as a string so
 * `ssh2-sftp-client` can pass it directly to ssh2.
 */
export async function saveUberSftpConnection(opts: {
  host: string;
  port: number;
  username: string;
  privateKey: string;
  passphrase?: string | null;
  remoteDir: string;
  filePattern?: string | null;
}): Promise<void> {
  const existing = await getUberIntegration();
  const existingCfg = (existing?.config ?? {}) as UberConfig;
  const sftp: UberSftpConfig = {
    host: opts.host,
    port: opts.port,
    username: opts.username,
    privateKey: encryptJson({
      key: opts.privateKey,
      passphrase: opts.passphrase ?? null,
    }),
    remoteDir: opts.remoteDir,
    filePattern: opts.filePattern ?? null,
    // Preserve any previously-imported file list across re-saves so
    // re-entering the SFTP form doesn't trigger a full reimport.
    importedFiles: existingCfg.sftp?.importedFiles ?? [],
    lastPullAt: existingCfg.sftp?.lastPullAt ?? null,
  };
  const config: UberConfig = {
    ...existingCfg,
    connectedAt: existingCfg.connectedAt ?? new Date().toISOString(),
    sftp,
  };
  await prisma.integration.upsert({
    where: { kind: 'uber' },
    create: {
      kind: 'uber',
      status: 'connected',
      authRef: 'uber:config.sftp',
      config: JSON.parse(JSON.stringify(config)),
    },
    update: {
      // Only flip to 'connected' if not already. The OAuth disconnect
      // flow may have set it to 'disconnected'; saving SFTP creds
      // brings the integration back to life via the SFTP feed alone.
      status: 'connected',
      authRef: existing?.authRef ?? 'uber:config.sftp',
      config: JSON.parse(JSON.stringify(config)),
    },
  });
}

/**
 * Wipe just the SFTP block, leaving any REST credentials in place.
 * Used when admin wants to rotate SSH keys or migrate the SFTP
 * endpoint without losing the OAuth connection.
 */
export async function clearUberSftpConnection(): Promise<void> {
  const existing = await getUberIntegration();
  if (!existing) return;
  const cfg = (existing.config ?? {}) as UberConfig;
  const next: UberConfig = { ...cfg, sftp: null };
  await prisma.integration.update({
    where: { kind: 'uber' },
    data: {
      // Keep status 'connected' iff REST creds remain.
      status: cfg.credentials ? 'connected' : 'disconnected',
      config: JSON.parse(JSON.stringify(next)),
    },
  });
}

/**
 * Decrypt + return the stored SFTP credentials. Throws when the
 * SFTP block isn't configured — callers should `getUberIntegration`
 * and inspect `cfg.sftp` first when they want a soft skip.
 */
export function readSftpCredentials(integration: { config: unknown }): {
  host: string;
  port: number;
  username: string;
  privateKey: string;
  passphrase: string | null;
  remoteDir: string;
  filePattern: string;
  importedFiles: string[];
} {
  const cfg = (integration.config ?? {}) as UberConfig;
  if (!cfg.sftp) {
    throw new Error(
      'Uber SFTP not configured — set it up in /admin/integrations/uber.',
    );
  }
  const decoded = decryptJson<{ key: string; passphrase: string | null }>(
    cfg.sftp.privateKey,
  );
  return {
    host: cfg.sftp.host,
    port: cfg.sftp.port,
    username: cfg.sftp.username,
    privateKey: decoded.key,
    passphrase: decoded.passphrase,
    remoteDir: cfg.sftp.remoteDir,
    filePattern: cfg.sftp.filePattern || '.csv',
    importedFiles: cfg.sftp.importedFiles ?? [],
  };
}

/**
 * Append a filename to the imported-files list and stamp `lastPullAt`.
 * Capped at the most recent 200 entries to keep the JSON blob bounded
 * — Uber's daily drops + Foundry's volume means we're nowhere near
 * that limit, but a runaway pull (e.g. backfill misuse) could bloat
 * the row without the cap.
 */
export async function recordSftpFileImported(filename: string): Promise<void> {
  const existing = await getUberIntegration();
  if (!existing) return;
  const cfg = (existing.config ?? {}) as UberConfig;
  if (!cfg.sftp) return;
  const dedup = new Set(cfg.sftp.importedFiles ?? []);
  dedup.add(filename);
  const trimmed = Array.from(dedup).slice(-200);
  const nextSftp: UberSftpConfig = {
    ...cfg.sftp,
    importedFiles: trimmed,
    lastPullAt: new Date().toISOString(),
  };
  await prisma.integration.update({
    where: { kind: 'uber' },
    data: {
      lastSyncAt: new Date(),
      config: JSON.parse(JSON.stringify({ ...cfg, sftp: nextSftp })),
    },
  });
}

/**
 * Fetch (and cache) an Uber OAuth access token. Tokens are cached on
 * the Integration row so we don't hit the OAuth endpoint on every API
 * call — Uber rate-limits client_credentials grants at ~60 req/min.
 */
async function getAccessToken(): Promise<string> {
  const integration = await getUberIntegration();
  if (!integration || integration.status !== 'connected') {
    throw new Error('Uber integration is not connected.');
  }
  const cfg = (integration.config ?? {}) as UberConfig;
  if (cfg.tokens) {
    const tokens = decryptJson<UberTokens>(cfg.tokens);
    if (tokens.expiresAt - Date.now() > 60_000) return tokens.accessToken;
  }
  const { clientId, clientSecret } = readCredentials(integration);
  const tokenUrl = cfg.tokenUrl || UBER_TOKEN_URL;
  const scope = cfg.scope || UBER_DEFAULT_SCOPE;
  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'client_credentials',
      scope,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    // Surface a masked credential prefix/suffix so an `invalid_client`
    // is debuggable without dumping the secret. Same diagnostic
    // shape as the Navan integration.
    const mask = (s: string): string =>
      s.length < 8
        ? `(only ${s.length} chars — too short)`
        : `${s.slice(0, 4)}…${s.slice(-4)} (${s.length} chars)`;
    throw new Error(
      `Uber token exchange failed (${res.status}) — called ${tokenUrl}\nstored client_id=${mask(clientId)} client_secret=${mask(clientSecret)} scope=${scope}\n${body}`,
    );
  }
  const json = (await res.json()) as {
    access_token: string;
    expires_in: number;
  };
  const tokens: UberTokens = {
    accessToken: json.access_token,
    expiresAt: Date.now() + json.expires_in * 1000,
  };
  await prisma.integration.update({
    where: { kind: 'uber' },
    data: {
      config: JSON.parse(
        JSON.stringify({ ...cfg, tokens: encryptJson(tokens) }),
      ),
    },
  });
  return tokens.accessToken;
}

// ─── Domain type (subset of Uber's trip payload we use) ──────────────
//
// Field names mirror Uber's published v1.2 trips response. The
// sync's defensive field extractors (in uber-sync.ts) handle camel
// vs snake case variants, since the docs and the actual response
// have diverged in the past.
export type UberTrip = {
  trip_id: string;
  status: string; // 'completed' / 'canceled' / 'in_progress' / 'rider_canceled'
  request_time: string; // ISO
  begin_trip_time?: string;
  dropoff_time?: string;
  // Employee carried via nested object on most responses.
  employee?: {
    email?: string;
    first_name?: string;
    last_name?: string;
  };
  rider?: {
    email?: string;
    first_name?: string;
    last_name?: string;
  };
  // Fare lives under `fare` or as top-level numbers depending on API
  // version. Extracted defensively in landTrip.
  fare?: {
    value?: number; // dollars
    currency_code?: string;
  };
  total_charged?: number; // dollars
  currency_code?: string;
  // Expense code is what Uber Business uses for org-level cost
  // routing. Foundry will populate this with the project code when
  // the rider sets a billing code at booking time.
  expense_code?: string | null;
  expense_memo?: string | null;
  start_address?: { display_name?: string };
  end_address?: { display_name?: string };
  invoice_url?: string | null;
};

/**
 * Pull every trip with `request_time` after our watermark. Uber's
 * trips endpoint is cursor-paginated (`offset` + `limit`); we walk
 * until the response returns fewer than `limit` rows.
 *
 * Falls back to "ever" (no `from_time`) on the first sync. Idempotent
 * downstream — re-imports skip already-landed trips via the
 * `uber:trip:<id>` prefix on `supplierInvoiceNumber`.
 */
export async function fetchTripsSinceLastSync(): Promise<UberTrip[]> {
  const integration = await getUberIntegration();
  if (!integration || integration.status !== 'connected') return [];
  const cfg = (integration.config ?? {}) as UberConfig;
  // Uber accepts unix epoch SECONDS for from_time/to_time.
  const fromTime = cfg.lastTripSyncedAt
    ? Math.floor(new Date(cfg.lastTripSyncedAt).getTime() / 1000)
    : 0;
  const toTime = Math.floor(Date.now() / 1000);
  const accessToken = await getAccessToken();
  const baseUrl = cfg.tripsUrl || UBER_TRIPS_URL;

  const out: UberTrip[] = [];
  let offset = 0;
  const MAX_PAGES = 100; // safety cap
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const url = new URL(baseUrl);
    url.searchParams.set('from_time', String(fromTime));
    url.searchParams.set('to_time', String(toTime));
    url.searchParams.set('offset', String(offset));
    url.searchParams.set('limit', String(TRIPS_PAGE_LIMIT));
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(
        `Uber trips fetch failed (${res.status}) — called ${url}\n${body}`,
      );
    }
    // Uber responses sit under `trips`/`data`/`history` depending on
    // version. Defensive: try all three, log the envelope keys for
    // unrecognised shapes.
    const json = (await res.json()) as
      | UberTrip[]
      | { trips?: UberTrip[]; data?: UberTrip[]; history?: UberTrip[]; count?: number };
    const batch: UberTrip[] = Array.isArray(json)
      ? json
      : (json.trips ?? json.data ?? json.history ?? []);
    if (page === 0) {
      console.info(
        `[uber.trips] page=0 batch.length=${batch.length} envelope-keys=${
          Array.isArray(json) ? '(top-level array)' : Object.keys(json).join(', ')
        }`,
      );
      if (batch.length === 0 && !Array.isArray(json)) {
        console.info(
          '[uber.trips] zero rows parsed — raw response:',
          JSON.stringify(json).slice(0, 2000),
        );
      }
      if (batch[0]) {
        console.info(
          '[uber.trips] first-row keys:',
          Object.keys(batch[0] as Record<string, unknown>).join(', '),
        );
      }
    }
    out.push(...batch);
    if (batch.length < TRIPS_PAGE_LIMIT) break;
    offset += TRIPS_PAGE_LIMIT;
  }
  return out;
}

/**
 * Bump the integration's sync watermark after a successful pass.
 */
export async function markSynced(opts: {
  tripsAt?: string;
}): Promise<void> {
  const integration = await getUberIntegration();
  if (!integration) return;
  const cfg = (integration.config ?? {}) as UberConfig;
  await prisma.integration.update({
    where: { kind: 'uber' },
    data: {
      lastSyncAt: new Date(),
      config: JSON.parse(
        JSON.stringify({
          ...cfg,
          ...(opts.tripsAt ? { lastTripSyncedAt: opts.tripsAt } : {}),
        }),
      ),
    },
  });
}
