import { prisma } from '@/server/db';
import { optionalEnv } from '@/server/env';
import { encryptJson, decryptJson } from '@/server/crypto';
import {
  mapFreeFormToCategory,
  type ExpenseCategory,
} from '@/lib/expense-categories';

/**
 * Navan (formerly TripActions) — Foundry's corporate travel + expense
 * platform. The integration:
 *
 *   1. Authenticates with a Navan API key (machine-to-machine OAuth-
 *      client credentials grant) — credentials are stored encrypted in
 *      the Integration row's `config.tokens`, never in plain Postgres.
 *   2. Polls (or receives webhooks for) `/v1/bookings` and
 *      `/v1/expenses` for the firm.
 *   3. Maps each booking / expense into a Foundry Expense row with
 *      receipt URL + canonical category, lands them as `submitted` so
 *      they flow into the regular approval queue. The owner is matched
 *      by Navan's traveller email → Person.email; unmatched travellers
 *      are surfaced as a sync warning rather than silently swallowed.
 *
 * The Navan API itself (https://developer.navan.com) sits behind a
 * partner-program signup; this module is structured so the client can
 * be configured and dry-run today, with the live HTTP calls flipped on
 * once the API key arrives. The connect / disconnect plumbing is
 * already exercised by /admin/integrations.
 */

// Endpoints — overridable via env so a path change on Navan's side
// (or a sandbox vs prod swap) doesn't need a code edit. Defaults match
// Navan's Booking Data Integration (BDI) docs as of 2026-05-11:
//   - OAuth token endpoint is /ta-auth/oauth/token (the `ta-` prefix
//     is left over from TripActions branding before Navan renamed)
//   - Bookings endpoint sits at /v1/bookings with createdFrom /
//     createdTo unix-epoch query params + page/size pagination
//   - Expenses are *not* part of BDI — they live in a separate Navan
//     Expense API with its own credential type. When the operator
//     hasn't pasted an expenses override URL, we skip the expense
//     pull cleanly rather than 404'ing.
const NAVAN_API_BASE =
  optionalEnv('NAVAN_API_BASE') ?? 'https://api.navan.com';
const NAVAN_TOKEN_URL =
  optionalEnv('NAVAN_TOKEN_URL') ?? `${NAVAN_API_BASE}/ta-auth/oauth/token`;
const NAVAN_BOOKINGS_URL =
  optionalEnv('NAVAN_BOOKINGS_URL') ?? `${NAVAN_API_BASE}/v1/bookings`;
// Expenses default left null — operator must paste the expense
// endpoint into the override field when their Navan account has the
// Expense API enabled. Without an override the expense sync skips.
const NAVAN_EXPENSES_URL = optionalEnv('NAVAN_EXPENSES_URL') ?? null;
const BDI_PAGE_SIZE = 100;

export type NavanTokens = {
  accessToken: string;
  /** Milliseconds since epoch when the access token expires. */
  expiresAt: number;
};

export type NavanConfig = {
  /** Encrypted JSON blob — `{ apiKey, apiSecret }`. Never round-tripped
   *  to the client. */
  credentials: string;
  /** Encrypted JSON blob — current `NavanTokens`. Refreshed on demand. */
  tokens?: string;
  connectedAt: string;
  /** Navan org id — surfaced on the connection card. */
  orgId?: string | null;
  /** Per-tenant overrides for the Navan endpoints. Some tenants live
   *  under `api.eu.navan.com` (EU), some use a versioned path that
   *  doesn't match our defaults. The connect form lets admin paste
   *  whatever Navan's developer portal lists for *their* account. */
  tokenUrl?: string | null;
  bookingsUrl?: string | null;
  expensesUrl?: string | null;
  /** Watermark for incremental syncs: anything `updatedAt` after this
   *  ISO timestamp gets pulled. Stamped after a successful sync. */
  lastBookingSyncedAt?: string | null;
  lastExpenseSyncedAt?: string | null;
};

/**
 * True when the env vars or feature flag have made it sensible to expose
 * the Navan card on /admin/integrations. Mirrors `xeroConfigured()`.
 */
export function navanConfigured(): boolean {
  return Boolean(optionalEnv('NAVAN_API_BASE') ?? 'https://api.navan.com');
}

/**
 * Read the Integration row for Navan. Returns null when the row hasn't
 * been created yet (i.e. nobody has connected). Never throws.
 */
export async function getNavanIntegration() {
  return prisma.integration.findUnique({ where: { kind: 'navan' } });
}

export async function clearNavanConnection(): Promise<void> {
  await prisma.integration.update({
    where: { kind: 'navan' },
    data: {
      status: 'disconnected',
      authRef: null,
      config: {},
    },
  });
}

/**
 * Persist the API credentials + flip status to `connected`. Called by
 * the admin "Connect Navan" form on /admin/integrations.
 */
export async function saveNavanConnection(opts: {
  apiKey: string;
  apiSecret: string;
  orgId?: string | null;
  /** Tenant-specific OAuth token URL (from Navan's API docs for your
   *  account). Leave empty to fall back to the env / default. */
  tokenUrl?: string | null;
  bookingsUrl?: string | null;
  expensesUrl?: string | null;
}): Promise<void> {
  const credentials = encryptJson({
    apiKey: opts.apiKey,
    apiSecret: opts.apiSecret,
  });
  const config: NavanConfig = {
    credentials,
    connectedAt: new Date().toISOString(),
    orgId: opts.orgId ?? null,
    tokenUrl: opts.tokenUrl ?? null,
    bookingsUrl: opts.bookingsUrl ?? null,
    expensesUrl: opts.expensesUrl ?? null,
    lastBookingSyncedAt: null,
    lastExpenseSyncedAt: null,
  };
  await prisma.integration.upsert({
    where: { kind: 'navan' },
    create: {
      kind: 'navan',
      status: 'connected',
      // authRef is the vault-key pointer convention used by other
      // integrations; for Navan we store the ciphertext inline in
      // `config.credentials` so this just gets a tag.
      authRef: 'navan:config.credentials',
      config: JSON.parse(JSON.stringify(config)),
    },
    update: {
      status: 'connected',
      authRef: 'navan:config.credentials',
      config: JSON.parse(JSON.stringify(config)),
    },
  });
}

/**
 * Decrypt the stored credentials. Throws when the integration row is
 * missing — callers should `getNavanIntegration()` first.
 */
function readCredentials(integration: {
  config: unknown;
}): { apiKey: string; apiSecret: string } {
  const cfg = (integration.config ?? {}) as NavanConfig;
  if (!cfg.credentials) {
    throw new Error('Navan credentials not set — reconnect from /admin/integrations.');
  }
  return decryptJson<{ apiKey: string; apiSecret: string }>(cfg.credentials);
}

/**
 * Fetch a fresh access token via OAuth client-credentials grant. The
 * token is cached on the Integration row so we don't hit the OAuth
 * endpoint on every API call (Navan rate-limits client_credentials at
 * a few hundred per minute per org).
 */
async function getAccessToken(): Promise<string> {
  const integration = await getNavanIntegration();
  if (!integration || integration.status !== 'connected') {
    throw new Error('Navan integration is not connected.');
  }
  const cfg = (integration.config ?? {}) as NavanConfig;

  // Cached token still valid for >60s? Reuse.
  if (cfg.tokens) {
    const tokens = decryptJson<NavanTokens>(cfg.tokens);
    if (tokens.expiresAt - Date.now() > 60_000) return tokens.accessToken;
  }

  const { apiKey, apiSecret } = readCredentials(integration);
  // Per-tenant override (set on connect) wins over the env / default.
  const tokenUrl = cfg.tokenUrl || NAVAN_TOKEN_URL;
  // No `scope` param — Navan returns whatever scopes the credential
  // was granted in the admin UI. Hard-coding a scope list (the
  // earlier `bookings:read expenses:read` mistake) made Navan return
  // an `invalid_client` error that masquerades as "Bad client
  // credentials" — actually a scope mismatch. Per OAuth2 RFC 6749
  // §4.4.2, scope is optional for client-credentials grants.
  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: apiKey,
      client_secret: apiSecret,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    // Surface what we actually sent so an `invalid_client` mismatch
    // is easy to debug — prints the URL + a masked prefix/suffix of
    // the stored credentials so the operator can compare against the
    // credential page in Navan without dumping the secret in full.
    const mask = (s: string): string =>
      s.length < 8
        ? `(only ${s.length} chars — too short)`
        : `${s.slice(0, 4)}…${s.slice(-4)} (${s.length} chars)`;
    throw new Error(
      `Navan token exchange failed (${res.status}) — called ${tokenUrl}\nstored client_id=${mask(apiKey)} client_secret=${mask(apiSecret)}\n${body}`,
    );
  }
  const json = (await res.json()) as { access_token: string; expires_in: number };
  const tokens: NavanTokens = {
    accessToken: json.access_token,
    expiresAt: Date.now() + json.expires_in * 1000,
  };
  // Persist the cached token + bump status touch so admin sees a
  // recent activity heartbeat.
  await prisma.integration.update({
    where: { kind: 'navan' },
    data: {
      config: JSON.parse(
        JSON.stringify({ ...cfg, tokens: encryptJson(tokens) }),
      ),
    },
  });
  return tokens.accessToken;
}

// ─── Domain types (subset of Navan's payloads we actually use) ─────────

export type NavanBooking = {
  id: string;
  type: 'flight' | 'hotel' | 'rail' | 'car';
  travellerEmail: string;
  startDate: string; // ISO date
  endDate: string;
  vendor: string;
  description: string;
  totalAmount: number; // dollars (Navan returns decimal)
  currency: string;
  receiptUrl: string | null;
  invoiceNumber: string | null;
  updatedAt: string;
};

export type NavanExpense = {
  id: string;
  travellerEmail: string;
  date: string; // ISO date
  merchant: string;
  category: string; // free-form Navan category
  totalAmount: number;
  gstAmount: number | null;
  currency: string;
  receiptUrl: string | null;
  notes: string | null;
  updatedAt: string;
};

/**
 * Pull every booking created since the last sync watermark.
 *
 * Per Navan's BDI docs, `/v1/bookings` requires:
 *   - createdFrom + createdTo as unix epoch SECONDS (not ISO strings)
 *   - page (0-indexed) + size for pagination
 *
 * Loops through pages until we get a partial page (< size results)
 * which Navan uses as the "end of results" marker. Falls back to
 * "ever" (createdFrom=0) on the first sync.
 */
export async function fetchBookingsSinceLastSync(): Promise<NavanBooking[]> {
  const integration = await getNavanIntegration();
  if (!integration || integration.status !== 'connected') return [];
  const cfg = (integration.config ?? {}) as NavanConfig;
  // Watermark stored as ISO; BDI wants epoch seconds. Convert both
  // directions. The default `0` pulls everything ever — fine for the
  // first sync and idempotent on the description prefix.
  const createdFrom = cfg.lastBookingSyncedAt
    ? Math.floor(new Date(cfg.lastBookingSyncedAt).getTime() / 1000)
    : 0;
  const createdTo = Math.floor(Date.now() / 1000);
  const accessToken = await getAccessToken();
  const baseUrl = cfg.bookingsUrl || NAVAN_BOOKINGS_URL;

  const out: NavanBooking[] = [];
  let page = 0;
  // Safety stop — Navan's docs don't specify a max page count, but
  // 10k bookings (100 pages × 100/page) for a single sync window is
  // already a flag-the-admin scenario. Hard cap so a runaway query
  // can't lock up the action.
  const MAX_PAGES = 100;
  while (page < MAX_PAGES) {
    const url = new URL(baseUrl);
    url.searchParams.set('createdFrom', String(createdFrom));
    url.searchParams.set('createdTo', String(createdTo));
    url.searchParams.set('page', String(page));
    url.searchParams.set('size', String(BDI_PAGE_SIZE));
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(
        `Navan bookings fetch failed (${res.status}) — called ${url}\n${body}`,
      );
    }
    // Navan's response shape isn't documented exhaustively — the
    // bookings live either at the top level (array) or under a
    // `data` / `content` / `bookings` key depending on the API
    // version. Accept any of these so we don't break on a docs
    // update; log the keys we DON'T recognise for follow-up.
    const json = (await res.json()) as
      | NavanBooking[]
      | {
          data?: NavanBooking[];
          content?: NavanBooking[];
          bookings?: NavanBooking[];
        };
    const batch: NavanBooking[] = Array.isArray(json)
      ? json
      : (json.data ?? json.content ?? json.bookings ?? []);
    // Diagnostic — on the first page, log how many bookings came
    // through + the top-level keys Navan returned (so an unrecognised
    // envelope key like `results` / `items` shows up immediately
    // instead of silently parsing as []). When we successfully
    // extracted a batch, dump the first row's keys + nested
    // candidate-object keys to pin the email/amount/etc field names.
    if (page === 0) {
      console.info(
        `[navan.bookings] page=0 batch.length=${batch.length} envelope-keys=${
          Array.isArray(json) ? '(top-level array)' : Object.keys(json).join(', ')
        }`,
      );
      if (batch.length === 0 && !Array.isArray(json)) {
        // Empty + non-array envelope = our key guesses missed.
        // Print the full raw response (capped) so the integrator can
        // see what Navan actually sent.
        console.info(
          '[navan.bookings] zero rows parsed — raw response:',
          JSON.stringify(json).slice(0, 2000),
        );
      }
      if (batch[0]) {
        const first = batch[0] as Record<string, unknown>;
        console.info(
          '[navan.bookings] first-row keys:',
          Object.keys(first).join(', '),
        );
        for (const candidateKey of ['traveler', 'traveller', 'user', 'passenger', 'guest']) {
          const nested = first[candidateKey];
          if (nested && typeof nested === 'object') {
            console.info(
              `[navan.bookings] nested "${candidateKey}" keys:`,
              Object.keys(nested as Record<string, unknown>).join(', '),
            );
          }
        }
      }
    }
    out.push(...batch);
    if (batch.length < BDI_PAGE_SIZE) break; // last page
    page += 1;
  }
  return out;
}

/**
 * Pull expenses since the last watermark. Returns [] cleanly when
 * the operator hasn't pasted an expenses URL — Navan's Booking Data
 * Integration credential covers bookings only; Expense API access
 * requires a separate credential type that not every tenant has.
 */
export async function fetchExpensesSinceLastSync(): Promise<NavanExpense[]> {
  const integration = await getNavanIntegration();
  if (!integration || integration.status !== 'connected') return [];
  const cfg = (integration.config ?? {}) as NavanConfig;
  const expensesUrl = cfg.expensesUrl || NAVAN_EXPENSES_URL;
  if (!expensesUrl) return []; // expenses not configured for this tenant
  const since = cfg.lastExpenseSyncedAt ?? '2000-01-01T00:00:00Z';
  const accessToken = await getAccessToken();
  const url = new URL(expensesUrl);
  url.searchParams.set('updatedSince', since);
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `Navan expenses fetch failed (${res.status}) — called ${url}\n${body}`,
    );
  }
  const json = (await res.json()) as { expenses: NavanExpense[] };
  return json.expenses ?? [];
}

/**
 * Bump the integration's sync watermark after a successful pass.
 * Two stamps so a partial sync (bookings ok, expenses errored) doesn't
 * skip the failed half on the next run.
 */
export async function markSynced(opts: {
  bookingsAt?: string;
  expensesAt?: string;
}): Promise<void> {
  const integration = await getNavanIntegration();
  if (!integration) return;
  const cfg = (integration.config ?? {}) as NavanConfig;
  await prisma.integration.update({
    where: { kind: 'navan' },
    data: {
      lastSyncAt: new Date(),
      config: JSON.parse(
        JSON.stringify({
          ...cfg,
          ...(opts.bookingsAt
            ? { lastBookingSyncedAt: opts.bookingsAt }
            : {}),
          ...(opts.expensesAt
            ? { lastExpenseSyncedAt: opts.expensesAt }
            : {}),
        }),
      ),
    },
  });
}

// ─── Mapping helpers ────────────────────────────────────────────────────

/**
 * Map Navan's free-form expense category onto the canonical Foundry
 * category set. Falls back to `mapFreeFormToCategory` (in
 * src/lib/expense-categories.ts) for unknown strings, which already
 * covers the keyword surface area for travel / meals / etc.
 */
export function mapNavanExpenseCategory(raw: string): ExpenseCategory {
  // Navan categories are typically things like "Airfare", "Hotel",
  // "Ground Transport", "Meals & Entertainment", "Car Rental",
  // "Conference", "Other". The free-form mapper handles all of them
  // via its keyword heuristics.
  return mapFreeFormToCategory(raw);
}

/**
 * Bookings always count as travel — Navan is a travel platform, the
 * booking type (flight / hotel / car) is implicitly travel-coded.
 */
export function bookingExpenseCategory(): ExpenseCategory {
  return 'travel';
}
