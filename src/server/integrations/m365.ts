import { graph, GraphError, graphConfigured } from '@/server/graph';

type ProvisionInput = {
  firstName: string;
  lastName: string;
  email: string; // userPrincipalName / email — must be @foundry.health
  jobTitle?: string;
};

export type ProvisionResult = {
  entraUserId: string;
  created: boolean; // true if newly created, false if already existed
  temporaryPassword: string | null; // only set when created
};

/**
 * Provision a Microsoft 365 user via Graph. Idempotent — if a user with the
 * given UPN already exists, returns their existing id with created=false and
 * no temporary password.
 *
 * Returns null when Graph isn't configured (feature-flag off).
 */
export async function provisionM365User(input: ProvisionInput): Promise<ProvisionResult | null> {
  if (!graphConfigured()) return null;

  const existing = await findUserByUpn(input.email);
  if (existing) {
    return { entraUserId: existing.id, created: false, temporaryPassword: null };
  }

  const localPart = input.email.split('@')[0];
  if (!localPart) {
    throw new Error(`Invalid email, no local part: ${input.email}`);
  }
  const mailNickname = localPart.slice(0, 64);
  const displayName = `${input.firstName} ${input.lastName}`.trim() || input.email;
  const temporaryPassword = generateTemporaryPassword();

  const created = await graph<{ id: string }>('POST', '/users', {
    accountEnabled: true,
    displayName,
    givenName: input.firstName,
    surname: input.lastName,
    mailNickname,
    userPrincipalName: input.email,
    ...(input.jobTitle ? { jobTitle: input.jobTitle } : {}),
    usageLocation: 'AU',
    passwordProfile: {
      forceChangePasswordNextSignIn: true,
      forceChangePasswordNextSignInWithMfa: false,
      password: temporaryPassword,
    },
  });

  return { entraUserId: created.id, created: true, temporaryPassword };
}

async function findUserByUpn(upn: string): Promise<{ id: string } | null> {
  try {
    const res = await graph<{ value: Array<{ id: string }> }>(
      'GET',
      `/users?$filter=userPrincipalName eq '${encodeURIComponent(upn)}'&$select=id`,
    );
    return res.value[0] ?? null;
  } catch (err) {
    if (err instanceof GraphError && err.status === 404) return null;
    throw err;
  }
}

function generateTemporaryPassword(): string {
  // 20-char mix: enough entropy + satisfies Microsoft's complexity policy
  // (lower / upper / digit / symbol required).
  const lowers = 'abcdefghijkmnopqrstuvwxyz';
  const uppers = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const digits = '23456789';
  const symbols = '!#$%&*+-?';
  const pool = lowers + uppers + digits + symbols;
  let pw = '';
  // Ensure at least one of each class.
  pw += pick(uppers);
  pw += pick(lowers);
  pw += pick(digits);
  pw += pick(symbols);
  while (pw.length < 20) pw += pick(pool);
  // Shuffle so the classes don't always appear at the start.
  return pw
    .split('')
    .sort(() => Math.random() - 0.5)
    .join('');
}

function pick(from: string): string {
  const i = Math.floor(Math.random() * from.length);
  return from.charAt(i);
}

/**
 * Flip Entra account on/off. Used on Person archive/reactivate.
 * Returns true if the change was applied, false if Graph isn't configured.
 * Throws GraphError on API failures so callers can surface the reason.
 *
 * When disabling, also revokes active sign-in sessions so any open
 * Microsoft/Outlook/Teams sessions get booted immediately instead of
 * waiting for the access token to expire.
 */
export async function setM365UserEnabled(
  entraUserId: string,
  enabled: boolean,
): Promise<boolean> {
  if (!graphConfigured()) return false;
  await graph('PATCH', `/users/${entraUserId}`, { accountEnabled: enabled });
  if (!enabled) {
    try {
      await graph('POST', `/users/${entraUserId}/revokeSignInSessions`, {});
    } catch (err) {
      console.error('[m365.revokeSignInSessions] failed:', err);
    }
  }
  return true;
}
