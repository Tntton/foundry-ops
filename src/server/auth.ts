import NextAuth from 'next-auth';
import MicrosoftEntraID from 'next-auth/providers/microsoft-entra-id';
import type { Role } from '@prisma/client';
import { prisma } from '@/server/db';
import { requireEnv } from '@/server/env';

const REQUIRED_EMAIL_SUFFIX = '@foundry.health';
const SESSION_MAX_AGE_SECONDS = 12 * 60 * 60; // 12 hours

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
      issuer: `https://login.microsoftonline.com/${requireEnv('ENTRA_TENANT_ID')}/v2.0`,
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
  callbacks: {
    async signIn({ profile, account }) {
      const email = (profile?.email ?? '').toLowerCase();
      if (!email.endsWith(REQUIRED_EMAIL_SUFFIX)) return false;

      const firstName =
        (profile && typeof profile['given_name'] === 'string'
          ? profile['given_name']
          : undefined) ?? 'Unknown';
      const lastName =
        (profile && typeof profile['family_name'] === 'string'
          ? profile['family_name']
          : undefined) ?? 'User';
      const entraUserId = account?.providerAccountId ?? null;

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
    },

    async jwt({ token, profile }) {
      const email =
        typeof profile?.email === 'string' ? profile.email.toLowerCase() : undefined;
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
