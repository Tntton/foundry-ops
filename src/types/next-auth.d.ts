import type { DefaultSession } from 'next-auth';
import type { Role } from '@prisma/client';

declare module 'next-auth' {
  interface Session {
    user: {
      personId: string;
      initials: string;
      roles: Role[];
    } & DefaultSession['user'];
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    personId?: string;
    initials?: string;
    roles?: Role[];
  }
}

export {};
