'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/server/db';
import { getSession } from '@/server/session';
import { requireCapability } from '@/server/capabilities';
import { writeAudit } from '@/server/audit';
import { getXeroIntegration } from '@/server/integrations/xero';
import { pushInvoiceToXero } from '@/server/integrations/xero-invoices';

export type InvoiceXeroPushState =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | { status: 'success'; message: string };

export async function pushInvoiceXero(
  invoiceId: string,
  _prev: InvoiceXeroPushState,
  _formData: FormData,
): Promise<InvoiceXeroPushState> {
  const session = await getSession();
  try {
    requireCapability(session, 'invoice.send');
  } catch {
    return { status: 'error', message: 'Not authorized' };
  }

  const xeroRow = await getXeroIntegration();
  if (!xeroRow || xeroRow.status !== 'connected') {
    return {
      status: 'error',
      message: 'Xero not connected. Connect at /admin/integrations/xero first.',
    };
  }

  try {
    const xeroInvoiceId = await pushInvoiceToXero(invoiceId);
    await prisma.$transaction(async (tx) => {
      await writeAudit(tx, {
        actor: { type: 'person', id: session.person.id },
        action: 'xero_pushed',
        entity: {
          type: 'invoice',
          id: invoiceId,
          after: { xeroInvoiceId },
        },
        source: 'web',
      });
    });
    revalidatePath(`/invoices/${invoiceId}`);
    return {
      status: 'success',
      message: `Pushed to Xero (${xeroInvoiceId.slice(0, 8)}…).`,
    };
  } catch (err) {
    console.error('[invoice.xero-push] failed:', err);
    return {
      status: 'error',
      message: `Push failed: ${(err as Error).message}`,
    };
  }
}
