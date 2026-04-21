import { NextResponse } from 'next/server';
import { getSession } from '@/server/session';
import { hasCapability } from '@/server/capabilities';
import { prisma } from '@/server/db';
import { writeAudit } from '@/server/audit';
import { buildAbaForPayRun } from '@/server/payroll';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Generate + download the ABA file for a PayRun.
 *
 * Requires capability payrun.approve (super_admin) so the ABA file doesn't
 * leak bank details to unauthorised staff. Writes an audit event so there's
 * a record of who exported what.
 *
 * The endpoint returns text/plain content with a filename attachment
 * Content-Disposition. Caller can redirect from a page button or fetch and
 * hand off to Blob storage.
 */
export async function GET(
  req: Request,
  { params }: { params: { id: string } },
) {
  const session = await getSession();
  if (!session || !hasCapability(session, 'payrun.approve')) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  try {
    const { filename, content, totalCents, lineCount } = await buildAbaForPayRun(params.id);
    await prisma.$transaction(async (tx) => {
      await writeAudit(tx, {
        actor: { type: 'person', id: session.person.id },
        action: 'aba_exported',
        entity: {
          type: 'pay_run',
          id: params.id,
          after: {
            filename,
            totalCents,
            lineCount,
            exportedAt: new Date().toISOString(),
          },
        },
        source: 'web',
      });
    });
    return new NextResponse(content, {
      headers: {
        'Content-Type': 'text/plain; charset=ascii',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (err) {
    console.error('[payroll.aba] export failed:', err);
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 400 },
    );
  }
}
