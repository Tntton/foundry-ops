import { auth } from '@/server/auth';
import { prisma } from '@/server/db';
import type { Session } from '@/server/roles';

export { hasRole, hasAnyRole, requireSession, requireRole, requireAnyRole, UnauthorizedError } from '@/server/roles';
export type { Session, SessionPerson } from '@/server/roles';

export async function getSession(): Promise<Session | null> {
  const authSession = await auth();
  const personId = authSession?.user?.personId;
  if (!personId) return null;

  const person = await prisma.person.findUnique({
    where: { id: personId },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      initials: true,
      roles: true,
    },
  });
  if (!person) return null;

  return { person };
}
