import { prisma } from '@/server/db';
import { requireEnv, optionalEnv } from '@/server/env';
import { encryptJson, decryptJson } from '@/server/crypto';

const AUTHORIZE_URL = 'https://login.xero.com/identity/connect/authorize';
const TOKEN_URL = 'https://identity.xero.com/connect/token';
const REVOCATION_URL = 'https://identity.xero.com/connect/revocation';
const CONNECTIONS_URL = 'https://api.xero.com/connections';

// Absolute minimum scope set while debugging. No OIDC scopes. Add them back
// once the baseline works.
const SCOPES = ['offline_access', 'accounting.transactions'];

export type XeroTokens = {
  accessToken: string;
  refreshToken: string;
  /** Milliseconds since epoch when the access token expires */
  expiresAt: number;
  scopes: string[];
};

export type XeroTenant = {
  tenantId: string;
  tenantName: string;
  tenantType: string;
  xeroConnectionId: string;
};

export type XeroConfig = {
  tokens: string; // encrypted JSON blob (XeroTokens)
  tenants: XeroTenant[];
  connectedAt: string;
  connectedById?: string;
};

export function xeroConfigured(): boolean {
  return Boolean(optionalEnv('XERO_CLIENT_ID') && optionalEnv('XERO_CLIENT_SECRET'));
}

export function buildAuthorizeUrl(state: string, redirectUri: string): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: requireEnv('XERO_CLIENT_ID'),
    redirect_uri: redirectUri,
    scope: SCOPES.join(' '),
    state,
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

export function defaultRedirectUri(): string {
  const base = optionalEnv('NEXT_PUBLIC_APP_URL') ?? 'http://localhost:3000';
  return `${base}/api/integrations/xero/callback`;
}

function basicAuthHeader(): string {
  const id = requireEnv('XERO_CLIENT_ID');
  const secret = requireEnv('XERO_CLIENT_SECRET');
  return 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64');
}

type RawTokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope: string;
  token_type: string;
};

export async function exchangeCodeForTokens(
  code: string,
  redirectUri: string,
): Promise<XeroTokens> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
  });
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: basicAuthHeader(),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Xero token exchange failed: ${res.status} ${text}`);
  }
  const json = (await res.json()) as RawTokenResponse;
  return rawToTokens(json);
}

export async function refreshTokens(refreshToken: string): Promise<XeroTokens> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: basicAuthHeader(),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Xero token refresh failed: ${res.status} ${text}`);
  }
  const json = (await res.json()) as RawTokenResponse;
  return rawToTokens(json);
}

function rawToTokens(json: RawTokenResponse): XeroTokens {
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    // Refresh 60s early to avoid window races.
    expiresAt: Date.now() + Math.max(60, json.expires_in - 60) * 1000,
    scopes: json.scope.split(' '),
  };
}

export async function listTenants(accessToken: string): Promise<XeroTenant[]> {
  const res = await fetch(CONNECTIONS_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Xero /connections failed: ${res.status} ${text}`);
  }
  const json = (await res.json()) as Array<{
    id: string;
    tenantId: string;
    tenantName: string;
    tenantType: string;
  }>;
  return json.map((t) => ({
    tenantId: t.tenantId,
    tenantName: t.tenantName,
    tenantType: t.tenantType,
    xeroConnectionId: t.id,
  }));
}

export async function revokeRefreshToken(refreshToken: string): Promise<void> {
  const body = new URLSearchParams({ token: refreshToken });
  const res = await fetch(REVOCATION_URL, {
    method: 'POST',
    headers: {
      Authorization: basicAuthHeader(),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });
  // Xero returns 200 even for already-revoked tokens; log non-2xx but don't throw
  if (!res.ok) {
    console.error('[xero.revoke] non-2xx:', res.status, await res.text());
  }
}

// ============================================================================
// Persistence helpers — Integration row
// ============================================================================

export async function saveXeroConnection(
  tokens: XeroTokens,
  tenants: XeroTenant[],
  connectedById: string,
): Promise<void> {
  const config: XeroConfig = {
    tokens: encryptJson(tokens),
    tenants,
    connectedAt: new Date().toISOString(),
    connectedById,
  };

  await prisma.integration.upsert({
    where: { kind: 'xero' },
    update: {
      status: 'connected',
      config: config as unknown as object,
      lastSyncAt: new Date(),
    },
    create: {
      kind: 'xero',
      status: 'connected',
      config: config as unknown as object,
      lastSyncAt: new Date(),
    },
  });
}

export async function getXeroIntegration() {
  return prisma.integration.findUnique({ where: { kind: 'xero' } });
}

export async function clearXeroConnection(): Promise<void> {
  await prisma.integration.update({
    where: { kind: 'xero' },
    data: {
      status: 'disconnected',
      config: {} as object,
      lastSyncAt: null,
    },
  });
}

/**
 * Fetch the current Xero access token, refreshing if within 60s of expiry.
 * Persists rotated refresh tokens back to the DB.
 * Returns null when Xero isn't connected.
 */
export async function getActiveAccessToken(): Promise<string | null> {
  const row = await getXeroIntegration();
  if (!row || row.status !== 'connected') return null;
  const cfg = row.config as XeroConfig;
  if (!cfg.tokens) return null;
  let tokens = decryptJson<XeroTokens>(cfg.tokens);
  if (tokens.expiresAt <= Date.now()) {
    const refreshed = await refreshTokens(tokens.refreshToken);
    tokens = refreshed;
    await prisma.integration.update({
      where: { kind: 'xero' },
      data: {
        config: {
          ...cfg,
          tokens: encryptJson(refreshed),
        } as unknown as object,
      },
    });
  }
  return tokens.accessToken;
}

/**
 * Return the default Xero tenant (first tenant the user connected). For MVP
 * we assume Foundry has exactly one Xero org. Multi-tenant picker lands if /
 * when Foundry operates across multiple Xero entities.
 */
export async function getDefaultTenantId(): Promise<string | null> {
  const row = await getXeroIntegration();
  if (!row || row.status !== 'connected') return null;
  const cfg = row.config as XeroConfig;
  return cfg.tenants[0]?.tenantId ?? null;
}

export class XeroApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown,
  ) {
    super(`Xero ${status}: ${typeof body === 'string' ? body : JSON.stringify(body)}`);
    this.name = 'XeroApiError';
  }
}

/**
 * Authenticated Xero API call. Auto-refreshes tokens, injects the tenant
 * header, parses JSON. Throws XeroApiError on 4xx/5xx so callers can inspect
 * the status.
 */
export async function xeroRequest<T>(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<T> {
  const accessToken = await getActiveAccessToken();
  if (!accessToken) throw new Error('Xero not connected');
  const tenantId = await getDefaultTenantId();
  if (!tenantId) throw new Error('Xero connected but no tenant selected');

  const url = path.startsWith('http') ? path : `https://api.xero.com${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Xero-tenant-id': tenantId,
      Accept: 'application/json',
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    data = text;
  }
  if (!res.ok) throw new XeroApiError(res.status, data);
  return data as T;
}
