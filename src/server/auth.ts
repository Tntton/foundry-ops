import NextAuth from 'next-auth';
import MicrosoftEntraID from 'next-auth/providers/microsoft-entra-id';
import Credentials from 'next-auth/providers/credentials';
import type { Role } from '@prisma/client';
import { prisma } from '@/server/db';
import { requireEnv } from '@/server/env';
import { verifyMagicLink } from '@/server/magic-link';
import { writeAudit } from '@/server/audit';

const REQUIRED_EMAIL_SUFFIX = '@foundry.health';
const SESSION_MAX_AGE_SECONDS = 12 * 60 * 60; // 12 hours

function extractEmail(profile: unknown): string | undefined {
  if (!profile || typeof profile !== 'object') return undefined;
  const p = profile as Record<string, unknown>;
  // Microsoft work accounts often put the email-shaped UPN in preferred_username,
  // not email. Check both + upn (legacy claim).
  for (const key of ['email', 'preferred_username', 'upn'] as const) {
    const v = p[key];
    if (typeof v === 'string' && v.includes('@')) return v.toLowerCase();
  }
  return undefined;
}

function extractName(profile: unknown): { firstName: string; lastName: string } {
  const p = (profile ?? {}) as Record<string, unknown>;
  const first = typeof p['given_name'] === 'string' ? p['given_name'] : undefined;
  const last = typeof p['family_name'] === 'string' ? p['family_name'] : undefined;
  if (first && last) return { firstName: first, lastName: last };
  // Fallback: parse combined "name" claim
  const name = typeof p['name'] === 'string' ? p['name'] : '';
  const parts = name.trim().split(/\s+/);
  return {
    firstName: first ?? parts[0] ?? 'Unknown',
    lastName: last ?? (parts.slice(1).join(' ') || 'User'),
  };
}

function deriveInitials(firstName: string, lastName: string): string {
  const first = firstName[0]?.toUpperCase() ?? 'X';
  const last = lastName[0]?.toUpperCase() ?? 'X';
  return `${first}${last}`;
}

async function ensureUniqueInitials(base: string): Promise<string> {
  let candidate = base;
  let suffix = 1;
  while (await prisma.person.findUnique({ where: { initials: candidate } })) {
    suffix += 1;
    candidate = `${base}${suffix}`;
    if (suffix > 99) throw new Error('Could not generate unique initials');
  }
  return candidate;
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    MicrosoftEntraID({
      clientId: requireEnv('ENTRA_CLIENT_ID'),
      clientSecret: requireEnv('ENTRA_CLIENT_SECRET'),
      // Single-tenant: point OIDC discovery at the tenant-specific issuer so
      // Auth.js hits .../<tenantId>/v2.0/.well-known/... rather than /common/
      // which is rejected with AADSTS50194 for apps not configured as multi-tenant.
      issuer: `https://login.microsoftonline.com/${requireEnv('ENTRA_TENANT_ID')}/v2.0`,
    }),
    Credentials({
      id: 'magic-link',
      name: 'Magic Link',
      credentials: {
        token: { label: 'Magic-link token', type: 'text' },
      },
      async authorize(credentials) {
        const token =
          typeof credentials?.['token'] === 'string' ? credentials['token'] : '';
        if (!token) return null;
        try {
          const identity = await verifyMagicLink(token);
          // Auth.js's User shape — the signIn/jwt callbacks handle the Foundry-specific fields.
          return {
            id: identity.personId,
            email: identity.email,
            name: `${identity.firstName} ${identity.lastName}`,
          };
        } catch (err) {
          console.error('[auth/magic-link] verify failed:', err);
          return null;
        }
      },
    }),
  ],
  session: {
    strategy: 'jwt',
    maxAge: SESSION_MAX_AGE_SECONDS,
  },
  cookies: {
    sessionToken: {
      name: 'foundry-ops.session-token',
      options: {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: process.env['NODE_ENV'] === 'production',
      },
    },
  },
  events: {
    async signIn({ user }) {
      // Audit every successful sign-in. Non-blocking — errors logged but don't
      // break the sign-in flow.
      try {
        if (!user?.email) return;
        const person = await prisma.person.findUnique({
          where: { email: user.email.toLowerCase() },
          select: { id: true },
        });
        if (!person) return;
        await prisma.$transaction(async (tx) => {
          await writeAudit(tx, {
            actor: { type: 'person', id: person.id },
            action: 'signed_in',
            entity: { type: 'person', id: person.id },
            source: 'web',
          });
        });
      } catch (err) {
        console.error('[auth/events/signIn] audit failed:', err);
      }
    },
  },
  callbacks: {
    async signIn({ profile, account, user }) {
      // Magic-link sign-in already verified through authorize() — allow through.
      // signIn callback still runs; no need to re-check email suffix since
      // contractors can legitimately have non-@foundry.health addresses.
      if (account?.provider === 'magic-link') {
        if (!user?.email) return false;
        return true;
      }

      const email = extractEmail(profile);
      if (!email) {
        console.error(
          '[auth/signIn] reject: no email claim (email, preferred_username, upn all absent)',
        );
        return false;
      }
      if (!email.endsWith(REQUIRED_EMAIL_SUFFIX)) {
        console.error(
          `[auth/signIn] reject: "${email}" does not end with ${REQUIRED_EMAIL_SUFFIX}`,
        );
        return false;
      }

      const { firstName, lastName } = extractName(profile);
      const entraUserId = account?.providerAccountId ?? null;

      try {
        const existing = await prisma.person.findUnique({ where: { email } });
        if (existing) {
          if (entraUserId && existing.entraUserId !== entraUserId) {
            await prisma.person.update({ where: { email }, data: { entraUserId } });
          }
          return true;
        }

        // First-time sign-in — create a minimal Person row. Admin refines via
        // Directory wizard (TASK-021/022/023); roles populated by TASK-005 from
        // Entra group membership.
        const initials = await ensureUniqueInitials(deriveInitials(firstName, lastName));
        await prisma.person.create({
          data: {
            email,
            firstName,
            lastName,
            initials,
            band: 'Consultant',
            level: 'T1',
            employment: 'ft',
            fte: 1.0,
            region: 'AU',
            rateUnit: 'day',
            rate: 0,
            roles: [],
            startDate: new Date(),
            entraUserId,
          },
        });
        return true;
      } catch (err) {
        console.error('[auth/signIn] DB error during Person upsert:', err);
        return false;
      }
    },

    async jwt({ token, profile, user }) {
      // Resolve email from either OIDC profile (Entra) or the authorize() user (magic-link).
      const email = extractEmail(profile) ?? (user?.email ? user.email.toLowerCase() : undefined);
      if (email) {
        const person = await prisma.person.findUnique({
          where: { email },
          select: {
            id: true,
            initials: true,
            firstName: true,
            lastName: true,
            roles: true,
          },
        });
        if (person) {
          token['personId'] = person.id;
          token['initials'] = person.initials;
          token.name = `${person.firstName} ${person.lastName}`;
          token['roles'] = person.roles;
        }
      }
      return token;
    },

    async session({ session, token }) {
      if (token['personId'] && session.user) {
        session.user.personId = token['personId'] as string;
        session.user.initials = token['initials'] as string;
        session.user.roles = (token['roles'] as Role[]) ?? [];
      }
      return session;
    },
  },
  trustHost: true,
});
