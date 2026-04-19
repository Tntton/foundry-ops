import { NextResponse } from 'next/server';
import { prisma } from '@/server/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VERSION = process.env['npm_package_version'] ?? '0.0.0';
const COMMIT = process.env['VERCEL_GIT_COMMIT_SHA'] ?? process.env['GIT_COMMIT_SHA'] ?? null;

export async function GET() {
  let db: 'up' | 'down' = 'down';
  try {
    await prisma.$queryRaw`SELECT 1`;
    db = 'up';
  } catch (err) {
    console.error('[healthz] DB check failed:', err);
  }

  const ok = db === 'up';
  return NextResponse.json(
    {
      ok,
      db,
      version: VERSION,
      commit: COMMIT,
      at: new Date().toISOString(),
    },
    { status: ok ? 200 : 503 },
  );
}
