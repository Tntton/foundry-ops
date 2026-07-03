import { execSync } from 'node:child_process';

/**
 * Vercel build entrypoint. Auto-applies pending Prisma migrations on
 * PRODUCTION deploys before building, so a merged schema change can't
 * silently miss prod (the trap that broke TASK-128 — migrations were
 * manual and easy to forget).
 *
 * Guards:
 *   - Production only (`VERCEL_ENV === 'production'`). Preview/dev deploys
 *     never migrate — otherwise a preview of an unmerged branch would
 *     mutate the shared prod DB ahead of merge.
 *   - Requires DIRECT_URL (Supabase direct, port 5432 — NOT the pgbouncer
 *     pooler, which can't run DDL). If it's absent we SKIP with a loud
 *     warning rather than fail the build; migrations stay manual until
 *     DIRECT_URL is set in the Vercel project.
 *
 * `migrate deploy` runs before `next build`, so a failed migration aborts
 * the deploy (fail-safe: prod code isn't promoted against a DB that
 * didn't migrate). Migrations are roll-forward-only — recover a bad one
 * via Supabase point-in-time restore (see DEPLOY.md).
 */
const env = process.env.VERCEL_ENV ?? 'unset';
const hasDirectUrl =
  typeof process.env.DIRECT_URL === 'string' &&
  process.env.DIRECT_URL.trim() !== '';

if (env === 'production' && hasDirectUrl) {
  console.log('[vercel-build] production + DIRECT_URL set → prisma migrate deploy');
  execSync('prisma migrate deploy', { stdio: 'inherit' });
} else if (env === 'production') {
  console.warn(
    '[vercel-build] PRODUCTION build but DIRECT_URL is not set — SKIPPING ' +
      'migrate deploy. Set DIRECT_URL (Supabase direct connection, port 5432) ' +
      'in the Vercel project to enable auto-migrations. Migrations remain ' +
      'MANUAL until then (`pnpm prisma migrate deploy`).',
  );
} else {
  console.log(`[vercel-build] VERCEL_ENV=${env} → skipping migrate deploy (non-production).`);
}

execSync('next build', { stdio: 'inherit' });
