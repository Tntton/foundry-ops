import { NextResponse } from 'next/server';
import { getSession } from '@/server/session';
import { hasCapability } from '@/server/capabilities';
import { prisma } from '@/server/db';
import { downloadDriveItem } from '@/server/integrations/sharepoint-receipts';
import { GraphError } from '@/server/graph';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Proxied inline receipt / attachment preview (TASK-042b / 046b).
 *
 * The `<ReceiptPreview>` in /expenses/[id] and /invoices/[id] hits this
 * route with the entity id; we look up the Graph DriveItem id on the
 * Bill / Expense row, auth-check the requester, and stream the file's
 * raw bytes back with the SharePoint Content-Type. Approvers see the
 * receipt inline without leaving Foundry Ops.
 *
 * Why proxy vs redirect to the SharePoint webUrl:
 *   - SharePoint's webUrl opens the file inside SPO's own viewer with
 *     its own auth flow; a signed-in Foundry Ops user without SPO
 *     access to the site gets bounced.
 *   - The Foundry app already knows who's allowed to see which
 *     attachment (owner + approver capability); proxying keeps the
 *     access rule in one place.
 *
 * Access rules:
 *   - kind='expense' → owner (personId matches session) OR anyone with
 *     `expense.approve.under_2k` (or higher).
 *   - kind='bill' → anyone with `bill.approve` or `bill.create`.
 *   - No public / anonymous access. Session required.
 *
 * Non-existent driveItemId → 404, not 500 (legacy rows pre-042b store a
 * base64 data URL inline on receiptSharepointUrl and no drive-item;
 * those still render via the inline data-URL path in ReceiptPreview
 * and never call this route).
 */
export async function GET(
  _req: Request,
  ctx: { params: { kind: string; id: string } },
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const kind = ctx.params.kind;
  const id = ctx.params.id;

  let driveItemId: string | null = null;
  let filename: string | null = null;

  if (kind === 'expense') {
    const expense = await prisma.expense.findUnique({
      where: { id },
      select: {
        personId: true,
        receiptDriveItemId: true,
        vendor: true,
        date: true,
      },
    });
    if (!expense) {
      return NextResponse.json({ error: 'not found' }, { status: 404 });
    }
    const isOwner = expense.personId === session.person.id;
    const canApprove = hasCapability(session, 'expense.approve.under_2k');
    if (!isOwner && !canApprove) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }
    driveItemId = expense.receiptDriveItemId;
    filename = `expense-${id}-${expense.vendor ?? 'receipt'}`;
  } else if (kind === 'bill') {
    const bill = await prisma.bill.findUnique({
      where: { id },
      select: {
        attachmentDriveItemId: true,
        supplierName: true,
      },
    });
    if (!bill) {
      return NextResponse.json({ error: 'not found' }, { status: 404 });
    }
    const canView =
      hasCapability(session, 'bill.approve') ||
      hasCapability(session, 'bill.create');
    if (!canView) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }
    driveItemId = bill.attachmentDriveItemId;
    filename = `bill-${id}-${bill.supplierName ?? 'attachment'}`;
  } else {
    return NextResponse.json({ error: 'unknown kind' }, { status: 400 });
  }

  if (!driveItemId) {
    return NextResponse.json(
      { error: 'no drive item — this record predates SharePoint archiving' },
      { status: 404 },
    );
  }

  try {
    const { buffer, contentType } = await downloadDriveItem(driveItemId);
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': contentType,
        // inline so the browser tries to preview PDF/images rather than
        // download; if the user wants to save, they use the SharePoint
        // link in the parent record.
        'Content-Disposition': `inline; filename="${sanitiseHeader(filename ?? 'attachment')}"`,
        'Cache-Control': 'private, max-age=60',
      },
    });
  } catch (err) {
    if (err instanceof GraphError && err.status === 404) {
      return NextResponse.json(
        { error: 'drive item missing on SharePoint' },
        { status: 404 },
      );
    }
    console.error('[api/attachments] Graph fetch failed:', err);
    return NextResponse.json(
      { error: (err as Error).message.slice(0, 200) },
      { status: 502 },
    );
  }
}

// Strip characters not safe inside a Content-Disposition filename.
function sanitiseHeader(s: string): string {
  return s.replace(/["\\\r\n]/gu, '').slice(0, 120);
}
