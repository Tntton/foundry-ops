import { createSign, createHmac, timingSafeEqual } from 'node:crypto';
import { prisma } from '@/server/db';
import { optionalEnv } from '@/server/env';
import { encryptJson, decryptJson } from '@/server/crypto';

/**
 * DocuSign — e-signature integration.
 *
 * Auth model: JWT Grant (server-to-server).
 *   1. Admin creates an "Integration Key" + RSA keypair in
 *      DocuSign Admin → Apps and Keys.
 *   2. Public key gets pasted into the DocuSign app config there.
 *   3. Private key gets pasted into Foundry's connect form (this
 *      module stores it AES-GCM encrypted via `encryptJson`).
 *   4. Admin grants user-consent via DocuSign's consent URL ONCE
 *      (one-time per environment + integration key). Subsequent
 *      token exchanges require no human in the loop.
 *   5. Per call: we sign a JWT with the private key, POST to
 *      /oauth/token, get back a 1h access token, cache it on the
 *      Integration row.
 *
 * Webhook model: DocuSign Connect (push). Foundry configures a URL
 *   in DocuSign Admin → Connect; DocuSign POSTs envelope status
 *   updates to that URL with an HMAC signature in the
 *   `X-DocuSign-Signature-1` header. The webhook secret lives on
 *   the Integration row (encrypted).
 *
 * Demo vs production: DocuSign maintains two parallel platforms.
 *   - Demo: account-d.docusign.com / demo.docusign.net — sandbox
 *     for development, ALL of dev / staging / first-prod-test runs
 *     should hit demo.
 *   - Prod: account.docusign.com / na2.docusign.net (or eu1, etc.
 *     depending on the customer's region; DocuSign returns the
 *     correct base from the JWT response in `accounts[].base_uri`).
 *   The `environment` field on the connection row gates which set
 *   of base URLs we hit.
 */

const DOCUSIGN_DEMO_AUTH = 'https://account-d.docusign.com';
const DOCUSIGN_PROD_AUTH = 'https://account.docusign.com';

export type DocuSignTokens = {
  accessToken: string;
  /** ms-since-epoch when the access token expires. */
  expiresAt: number;
  /** Per-account REST base URI from the DocuSign userinfo
   *  response. Different per data centre (na2, eu1, au, etc.) —
   *  we never assume it. */
  accountBaseUri: string;
};

export type DocuSignConfig = {
  /** Integration Key from DocuSign Admin → Apps and Keys. Public
   *  identifier; pairs with the encrypted private key below. */
  integrationKey: string;
  /** API User GUID — the DocuSign user account whose mailbox sends
   *  the envelopes. Encoded as the `sub` claim in the JWT. Must
   *  have completed user-consent for the integration key. */
  apiUserId: string;
  /** Account ID — the DocuSign account this integration acts in.
   *  Different from `apiUserId`: an API user can belong to multiple
   *  accounts; we pick one here for the REST calls. */
  accountId: string;
  /** Encrypted JSON blob — `{ privateKeyPem, hmacSecret }`. Never
   *  round-tripped to the client. */
  credentials: string;
  /** Encrypted cached `DocuSignTokens`. Refreshed on demand. */
  tokens?: string;
  /** Which DocuSign environment to talk to. */
  environment: 'demo' | 'prod';
  connectedAt: string;
  /** Last time the user-consent flow was completed for the
   *  integration key. Surface on the admin card as a sanity-check —
   *  re-consent is needed after rotating the private key or
   *  changing the JWT scopes. */
  consentedAt?: string | null;
};

export function docusignConfigured(): boolean {
  // Configured iff the operator has either the env-var stub or
  // hasn't connected yet. We always show the integration card —
  // the connect form gates the rest.
  return true;
}

export async function getDocuSignIntegration() {
  return prisma.integration.findUnique({ where: { kind: 'docusign' } });
}

export async function clearDocuSignConnection(): Promise<void> {
  await prisma.integration.update({
    where: { kind: 'docusign' },
    data: { status: 'disconnected', authRef: null, config: {} },
  });
}

/**
 * Persist connection details. The private key + HMAC secret are
 * encrypted together; everything else is plain JSON.
 */
export async function saveDocuSignConnection(opts: {
  integrationKey: string;
  apiUserId: string;
  accountId: string;
  privateKeyPem: string;
  hmacSecret: string;
  environment: 'demo' | 'prod';
}): Promise<void> {
  const credentials = encryptJson({
    privateKeyPem: opts.privateKeyPem,
    hmacSecret: opts.hmacSecret,
  });
  const config: DocuSignConfig = {
    integrationKey: opts.integrationKey,
    apiUserId: opts.apiUserId,
    accountId: opts.accountId,
    credentials,
    environment: opts.environment,
    connectedAt: new Date().toISOString(),
    consentedAt: null,
  };
  await prisma.integration.upsert({
    where: { kind: 'docusign' },
    create: {
      kind: 'docusign',
      status: 'connected',
      authRef: 'docusign:config.credentials',
      config: JSON.parse(JSON.stringify(config)),
    },
    update: {
      status: 'connected',
      authRef: 'docusign:config.credentials',
      config: JSON.parse(JSON.stringify(config)),
    },
  });
}

/**
 * Stamp consent — admin clicks the "Grant consent" link on the
 * integration page, completes the DocuSign consent flow in their
 * browser, comes back and clicks "I granted consent" which fires
 * this. We can't verify it programmatically; the next JWT exchange
 * will fail loudly if consent wasn't actually granted, which is the
 * canonical check.
 */
export async function stampDocuSignConsent(): Promise<void> {
  const integration = await getDocuSignIntegration();
  if (!integration) return;
  const cfg = (integration.config ?? {}) as DocuSignConfig;
  const next: DocuSignConfig = { ...cfg, consentedAt: new Date().toISOString() };
  await prisma.integration.update({
    where: { kind: 'docusign' },
    data: { config: JSON.parse(JSON.stringify(next)) },
  });
}

function readCredentials(integration: { config: unknown }): {
  privateKeyPem: string;
  hmacSecret: string;
} {
  const cfg = (integration.config ?? {}) as DocuSignConfig;
  if (!cfg.credentials) {
    throw new Error(
      'DocuSign credentials not set — reconnect from /admin/integrations.',
    );
  }
  return decryptJson<{ privateKeyPem: string; hmacSecret: string }>(
    cfg.credentials,
  );
}

function authBase(env: 'demo' | 'prod'): string {
  return env === 'prod' ? DOCUSIGN_PROD_AUTH : DOCUSIGN_DEMO_AUTH;
}

/**
 * Build the consent URL the operator must visit ONCE per
 * (integration key, environment) to grant the JWT app permission
 * to act on their behalf. The page shows the consent UI; after
 * accepting they're redirected to a static "Allow Access"
 * confirmation page. We can't intercept the callback (no redirect
 * URI required for JWT grant) so the operator manually clicks
 * "I granted consent" on the Foundry side after seeing the
 * confirmation.
 */
export function consentUrl(env: 'demo' | 'prod', integrationKey: string): string {
  const base = authBase(env);
  const params = new URLSearchParams({
    response_type: 'code',
    scope: 'signature impersonation',
    client_id: integrationKey,
    // DocuSign requires a redirect_uri even though we don't use the
    // returned code (JWT grant doesn't need it). Their "default"
    // page works fine.
    redirect_uri: `${base}/oauth/access_consent_landing`,
  });
  return `${base}/oauth/auth?${params.toString()}`;
}

/**
 * Build + sign the JWT assertion for the token exchange.
 *
 * Claims per DocuSign JWT spec:
 *   iss   = integration key
 *   sub   = API user GUID
 *   aud   = the auth host (account-d / account)
 *   iat   = now
 *   exp   = now + 1h (max — DocuSign rejects longer)
 *   scope = "signature impersonation"
 *
 * Signature: RS256 over base64url(header).base64url(claims) using
 * the private key the operator pasted on connect.
 */
function buildJwtAssertion(cfg: DocuSignConfig, privateKeyPem: string): string {
  const audience = cfg.environment === 'prod'
    ? 'account.docusign.com'
    : 'account-d.docusign.com';
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = {
    iss: cfg.integrationKey,
    sub: cfg.apiUserId,
    aud: audience,
    iat: now,
    exp: now + 3600,
    scope: 'signature impersonation',
  };
  const b64url = (obj: object): string =>
    Buffer.from(JSON.stringify(obj))
      .toString('base64')
      .replace(/=+$/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
  const signingInput = `${b64url(header)}.${b64url(claims)}`;
  const signer = createSign('RSA-SHA256');
  signer.update(signingInput);
  const sig = signer
    .sign(privateKeyPem)
    .toString('base64')
    .replace(/=+$/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  return `${signingInput}.${sig}`;
}

/**
 * Fetch a fresh access token via JWT grant. Cached on the
 * Integration row so we don't sign + exchange on every API call.
 * DocuSign rate-limits the token endpoint at "low hundreds" per
 * hour per integration key; caching avoids ever bumping that.
 */
async function getAccessToken(): Promise<{
  accessToken: string;
  accountBaseUri: string;
  accountId: string;
}> {
  const integration = await getDocuSignIntegration();
  if (!integration || integration.status !== 'connected') {
    throw new Error('DocuSign integration is not connected.');
  }
  const cfg = (integration.config ?? {}) as DocuSignConfig;

  if (cfg.tokens) {
    const cached = decryptJson<DocuSignTokens>(cfg.tokens);
    if (cached.expiresAt - Date.now() > 60_000) {
      return {
        accessToken: cached.accessToken,
        accountBaseUri: cached.accountBaseUri,
        accountId: cfg.accountId,
      };
    }
  }

  const { privateKeyPem } = readCredentials(integration);
  const jwt = buildJwtAssertion(cfg, privateKeyPem);
  const tokenUrl = `${authBase(cfg.environment)}/oauth/token`;
  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    // The classic JWT-grant failure is `consent_required` — surface
    // it loudly because the fix (visit consent URL) is a one-time
    // human action the operator needs to do.
    if (body.includes('consent_required')) {
      throw new Error(
        'DocuSign JWT grant failed — admin must grant user-consent first. Visit the consent URL on /admin/integrations/docusign and click "I granted consent".',
      );
    }
    throw new Error(
      `DocuSign token exchange failed (${res.status}) — called ${tokenUrl}\n${body}`,
    );
  }
  const json = (await res.json()) as {
    access_token: string;
    expires_in: number;
  };

  // Pull the per-account base URI from /oauth/userinfo — DocuSign
  // doesn't return it in the token response.
  const userinfoRes = await fetch(`${authBase(cfg.environment)}/oauth/userinfo`, {
    headers: { Authorization: `Bearer ${json.access_token}` },
  });
  if (!userinfoRes.ok) {
    const body = await userinfoRes.text();
    throw new Error(`DocuSign userinfo failed (${userinfoRes.status})\n${body}`);
  }
  const userinfo = (await userinfoRes.json()) as {
    accounts: Array<{ account_id: string; base_uri: string }>;
  };
  const account = userinfo.accounts.find((a) => a.account_id === cfg.accountId);
  if (!account) {
    throw new Error(
      `DocuSign account ${cfg.accountId} not visible to the JWT user. Check the Account ID on /admin/integrations/docusign.`,
    );
  }

  const tokens: DocuSignTokens = {
    accessToken: json.access_token,
    expiresAt: Date.now() + json.expires_in * 1000,
    accountBaseUri: account.base_uri,
  };
  await prisma.integration.update({
    where: { kind: 'docusign' },
    data: {
      config: JSON.parse(
        JSON.stringify({ ...cfg, tokens: encryptJson(tokens) }),
      ),
    },
  });
  return {
    accessToken: tokens.accessToken,
    accountBaseUri: tokens.accountBaseUri,
    accountId: cfg.accountId,
  };
}

// ─── Envelope creation ──────────────────────────────────────────────

export type EnvelopeRecipient = {
  /** Recipient's full name as it'll appear on the envelope email
   *  and the audit trail. */
  name: string;
  email: string;
  /** Signing order — 1 fires first. DocuSign won't email later
   *  signers until earlier orders complete. Default 1 for parallel
   *  signing (everyone gets the email immediately). */
  routingOrder?: number;
  /** Optional role name. When using a DocuSign Template instead of
   *  a one-off document, the role name maps to the template slot. */
  roleName?: string;
};

export type EnvelopeDocument = {
  /** Filename shown in DocuSign + the email. */
  name: string;
  /** Document ID — any string unique within the envelope. */
  documentId: string;
  /** Base64-encoded document body. The caller is responsible for
   *  reading + encoding the PDF (e.g. from SharePoint). */
  documentBase64: string;
  /** File extension — DocuSign uses this to set the correct MIME.
   *  PDF is the default + recommended. */
  fileExtension?: 'pdf' | 'docx';
};

export type CreateEnvelopeOpts = {
  emailSubject: string;
  emailMessage?: string;
  documents: EnvelopeDocument[];
  recipients: EnvelopeRecipient[];
  /** Foundry-side reference — which domain entity owns this
   *  ceremony. Stored on the DocuSignEnvelope row. */
  subjectType: string;
  subjectId: string;
  senderId: string;
};

/**
 * Create + send an envelope. Writes a DocuSignEnvelope row first
 * (`status='created'`), then posts to DocuSign. On success, flips
 * to `status='sent'` + stamps `sentAt` + records the
 * externalEnvelopeId. On failure, deletes the placeholder row to
 * keep the DB clean.
 */
export async function createAndSendEnvelope(
  opts: CreateEnvelopeOpts,
): Promise<{ envelopeId: string; externalId: string }> {
  if (opts.recipients.length === 0) {
    throw new Error('At least one recipient required.');
  }
  if (opts.documents.length === 0) {
    throw new Error('At least one document required.');
  }

  // Pre-create the local row in 'created' state so a failed send
  // doesn't lose the audit trail of "we tried".
  const local = await prisma.docuSignEnvelope.create({
    data: {
      // Placeholder externalEnvelopeId — uniqueness constraint
      // satisfied by the row id; updated after DocuSign responds.
      externalEnvelopeId: `pending:${Date.now()}:${Math.random().toString(36).slice(2)}`,
      subjectType: opts.subjectType,
      subjectId: opts.subjectId,
      status: 'created',
      emailSubject: opts.emailSubject,
      recipients: opts.recipients.map((r, i) => ({
        name: r.name,
        email: r.email,
        routingOrder: r.routingOrder ?? i + 1,
        roleName: r.roleName ?? null,
        status: 'created',
        signedAt: null,
      })),
      senderId: opts.senderId,
      message: opts.emailMessage ?? null,
    },
  });

  try {
    const { accessToken, accountBaseUri, accountId } = await getAccessToken();
    const url = `${accountBaseUri}/restapi/v2.1/accounts/${accountId}/envelopes`;
    const payload = {
      emailSubject: opts.emailSubject,
      ...(opts.emailMessage ? { emailBlurb: opts.emailMessage } : {}),
      status: 'sent',
      documents: opts.documents.map((d) => ({
        documentId: d.documentId,
        name: d.name,
        fileExtension: d.fileExtension ?? 'pdf',
        documentBase64: d.documentBase64,
      })),
      recipients: {
        signers: opts.recipients.map((r, i) => ({
          recipientId: String(i + 1),
          name: r.name,
          email: r.email,
          routingOrder: String(r.routingOrder ?? i + 1),
          ...(r.roleName ? { roleName: r.roleName } : {}),
        })),
      },
    };
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(
        `DocuSign envelope create failed (${res.status})\n${body}`,
      );
    }
    const json = (await res.json()) as { envelopeId: string };
    await prisma.docuSignEnvelope.update({
      where: { id: local.id },
      data: {
        externalEnvelopeId: json.envelopeId,
        status: 'sent',
        sentAt: new Date(),
      },
    });
    return { envelopeId: local.id, externalId: json.envelopeId };
  } catch (err) {
    // Roll back the placeholder so the DB stays clean.
    await prisma.docuSignEnvelope.delete({ where: { id: local.id } }).catch(() => {});
    throw err;
  }
}

// ─── Webhook signature verification ─────────────────────────────────

/**
 * Verify DocuSign Connect's HMAC signature on an incoming webhook
 * payload. DocuSign signs the raw request body with HMAC-SHA256
 * and the secret configured in Connect settings; the signature
 * arrives in the `X-DocuSign-Signature-1` header (multiple are
 * supported for rotation — `-1`, `-2`, etc.).
 *
 * Constant-time compare prevents timing-attack leakage.
 */
export function verifyDocuSignWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  hmacSecret: string,
): boolean {
  if (!signatureHeader) return false;
  const expected = createHmac('sha256', hmacSecret).update(rawBody).digest();
  // The header is base64-encoded; decode + compare bytes.
  let provided: Buffer;
  try {
    provided = Buffer.from(signatureHeader, 'base64');
  } catch {
    return false;
  }
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}

/**
 * Read the HMAC secret from the stored credentials. Used by the
 * webhook route to verify incoming requests.
 */
export async function getDocuSignHmacSecret(): Promise<string | null> {
  const integration = await getDocuSignIntegration();
  if (!integration || integration.status !== 'connected') return null;
  try {
    const { hmacSecret } = readCredentials(integration);
    return hmacSecret;
  } catch {
    return null;
  }
}

// ─── Env-var shims (deferred config — JWT key paste is the canonical
//                   path; these are read only if no DB row exists yet) ──

export function envIntegrationKey(): string | null {
  return optionalEnv('DOCUSIGN_INTEGRATION_KEY') ?? null;
}
export function envSecret(): string | null {
  return optionalEnv('DOCUSIGN_SECRET') ?? null;
}
