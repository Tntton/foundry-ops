import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

/**
 * Append a hard connection_limit to the Supabase pooler URL so Prisma's
 * internal pool never overshoots Supabase's session-mode cap of 15. We
 * still rely on `pgbouncer=true` already in DATABASE_URL to keep prepared
 * statements off (otherwise transaction-mode pooler 503s us). 5 in dev is
 * plenty: peak fan-out per request is ~3 after the helper sequentialisation
 * landed — anything higher just lets HMR-leaked connections accumulate
 * faster.
 */
function buildDatasourceUrl(): string | undefined {
  const raw = process.env['DATABASE_URL'];
  if (!raw) return undefined;
  if (/[?&]connection_limit=/.test(raw)) return raw;
  const sep = raw.includes('?') ? '&' : '?';
  const limit = process.env['NODE_ENV'] === 'production' ? 10 : 5;
  return `${raw}${sep}connection_limit=${limit}`;
}

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    ...(buildDatasourceUrl()
      ? { datasourceUrl: buildDatasourceUrl()! }
      : {}),
    log:
      process.env['NODE_ENV'] === 'development'
        ? ['query', 'error', 'warn']
        : ['error'],
  });

if (process.env['NODE_ENV'] !== 'production') globalForPrisma.prisma = prisma;
