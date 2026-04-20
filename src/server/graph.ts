import { requireEnv, optionalEnv } from '@/server/env';

/**
 * Microsoft Graph HTTP client using the app-credentials (client_credentials)
 * OAuth flow. Token cached in-memory for the life of the Node process; Graph
 * tokens last ~60 minutes. Safe to call concurrently — losers of the race just
 * stash an equivalent token.
 */

export class GraphError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown,
  ) {
    super(`Graph ${status}: ${typeof body === 'string' ? body : JSON.stringify(body)}`);
    this.name = 'GraphError';
  }
}

type CachedToken = { accessToken: string; expiresAt: number };
let cached: CachedToken | null = null;

async function fetchToken(): Promise<CachedToken> {
  const tenantId = requireEnv('ENTRA_TENANT_ID');
  const body = new URLSearchParams({
    client_id: requireEnv('ENTRA_CLIENT_ID'),
    client_secret: requireEnv('ENTRA_CLIENT_SECRET'),
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials',
  });
  const res = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Graph token fetch failed: ${res.status} ${text}`);
  }
  const json = (await res.json()) as { access_token: string; expires_in: number };
  return {
    accessToken: json.access_token,
    // Refresh one minute early to avoid edge misses.
    expiresAt: Date.now() + Math.max(60, json.expires_in - 60) * 1000,
  };
}

async function getAppToken(): Promise<string> {
  if (cached && cached.expiresAt > Date.now()) return cached.accessToken;
  cached = await fetchToken();
  return cached.accessToken;
}

export async function graph<T>(
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await graphRaw(method, path, body);
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    data = text;
  }
  if (!res.ok) throw new GraphError(res.status, data);
  return data as T;
}

/**
 * Variant that returns the raw Response so callers can read headers (e.g.
 * the Location header returned by /copy for async monitoring). Does NOT throw
 * on non-2xx — the caller decides.
 */
export async function graphRaw(
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<Response> {
  const token = await getAppToken();
  const url = path.startsWith('http') ? path : `https://graph.microsoft.com/v1.0${path}`;
  return fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

/**
 * Whether Graph-dependent features (SharePoint, M365 provisioning, email intake,
 * etc.) are configured and should be live. Gate with this before making any
 * Graph call from product code so the app keeps working when env vars are
 * missing (dev without Graph, or Entra outage).
 */
export function graphConfigured(): boolean {
  return Boolean(
    optionalEnv('ENTRA_TENANT_ID') &&
      optionalEnv('ENTRA_CLIENT_ID') &&
      optionalEnv('ENTRA_CLIENT_SECRET'),
  );
}
