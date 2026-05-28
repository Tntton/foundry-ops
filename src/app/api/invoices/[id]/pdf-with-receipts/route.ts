import { NextResponse } from 'next/server';
import { prisma } from '@/server/db';
import { getSession } from '@/server/session';
import { hasAnyRole } from '@/server/roles';
import { renderInvoicePdfWithReceipts } from '@/server/invoice-pdf';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// PDF merge can take a few seconds when there are many receipts +
// HTTP fetches for each. Generous timeout; typical Foundry invoices
// have <20 receipts and finish in under 10s.
export const maxDuration = 60;

/**
 * Stream a tax invoice as a single PDF with every rebilled receipt
 * appended as supporting documentation.
 *
 * Auth gate: same as the invoice detail page — `invoice.read` is
 * granted to super_admin / admin / partner / manager. Staff don't
 * have it, so they can't pull a client's invoice PDF.
 *
 * Returns `application/pdf` with a `Content-Disposition: attachment`
 * header so the browser downloads rather than rendering inline (we
 * want the partner to save the file, not preview it).
 */
export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
) {
  const session = await getSession();
  if (
    !session ||
    !hasAnyRole(session, ['super_admin', 'admin', 'partner', 'manager'])
  ) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const invoice = await prisma.invoice.findUnique({
    where: { id: params.id },
    select: { id: true, number: true },
  });
  if (!invoice) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  try {
    const bytes = await renderInvoicePdfWithReceipts(invoice.id);
    // Filename: sanitised invoice number (no slashes) + suffix so
    // the file is obviously the bundled version vs. a plain
    // invoice export.
    const filename = `${invoice.number.replace(/[^A-Za-z0-9._-]/g, '_')}-with-receipts.pdf`;
    // Buffer copy — Next.js' Response wants a plain ArrayBuffer or
    // Buffer, not the Uint8Array view pdf-lib returns directly.
    const body = Buffer.from(bytes);
    return new NextResponse(body, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': String(body.length),
        // No-cache: the PDF reflects DB state at fetch time, and
        // rebilled receipts can be re-tagged or added between calls.
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    console.error('[invoice-pdf] render failed:', err);
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}
