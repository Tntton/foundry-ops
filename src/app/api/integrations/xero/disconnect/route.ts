import { NextResponse } from 'next/server';
import { prisma } from '@/server/db';
import { getSession } from '@/server/session';
import { requireCapability } from '@/server/capabilities';
import { writeAudit } from '@/server/audit';
import { decryptJson } from '@/server/crypto';
import {
  clearXeroConnection,
  getXeroIntegration,
  revokeRefreshToken,
  type XeroConfig,
  type XeroTokens,
} from '@/server/integrations/xero';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const session = await getSession();
  try {
    requireCapability(session, 'integration.manage');
  } catch {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const existing = await getXeroIntegration();
  if (!existing || existing.status !== 'connected') {
    return NextResponse.redirect(
      new URL('/admin/integrations/xero?error=not_connected', req.url),
    );
  }

  // Best-effort revoke on Xero's side before we clear local state.
  const cfg = existing.config as XeroConfig;
  if (cfg.tokens) {
    try {
      const tokens = decryptJson<XeroTokens>(cfg.tokens);
      await revokeRefreshToken(tokens.refreshToken);
    } catch (err) {
      console.error('[xero/disconnect] revoke failed:', err);
    }
  }

  await clearXeroConnection();
  await prisma.$transaction(async (tx) => {
    await writeAudit(tx, {
      actor: { type: 'person', id: session.person.id },
      action: 'disconnected',
      entity: { type: 'integration', id: 'xero' },
      source: 'web',
    });
  });

  return NextResponse.redirect(new URL('/admin/integrations/xero?disconnected=1', req.url));
}
