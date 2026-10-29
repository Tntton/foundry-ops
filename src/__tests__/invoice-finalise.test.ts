import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * TASK-068 · finaliseInvoice archival behaviour.
 *
 * Covers the three branches that matter for "persist finalised invoice
 * PDF to SharePoint":
 *   1. Graph configured → PDF uploaded, pointer persisted, audit via
 *      `tax_invoice_archived` carries the SharePoint URL.
 *   2. Graph unreachable (upload returns null) → finalisation still
 *      recorded, no pointer written, audit via `tax_invoice_finalised`
 *      flags `archiveSkipped` so a later call retries.
 *   3. Already finalised AND archived → short-circuits without
 *      re-rendering or re-uploading.
 *
 * All I/O deps are mocked; the test asserts the exact `invoice.update`
 * data and the audit payload the action builds.
 */

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  findUnique: vi.fn(),
  update: vi.fn(),
  transaction: vi.fn(),
  writeAudit: vi.fn(),
  render: vi.fn(),
  upload: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('@/server/session', () => ({ getSession: mocks.getSession }));
vi.mock('@/server/db', () => ({
  prisma: {
    invoice: { findUnique: mocks.findUnique },
    $transaction: mocks.transaction,
  },
}));
vi.mock('@/server/audit', () => ({ writeAudit: mocks.writeAudit }));
vi.mock('@/server/invoice-pdf', () => ({
  renderInvoicePdfWithReceipts: mocks.render,
}));
vi.mock('@/server/integrations/sharepoint-receipts', () => ({
  archiveInvoicePdf: mocks.upload,
}));

import { finaliseInvoice } from '@/app/(app)/invoices/[id]/preview/actions';

const SESSION = {
  person: { id: 'p_tt', initials: 'TT' },
};

const BASE_INVOICE = {
  number: 'IFM001-INV-12',
  status: 'approved' as const,
  issueDate: new Date('2026-07-08T00:00:00Z'),
  amountTotal: 1_870_000,
  taxInvoiceFinalisedAt: null as Date | null,
  taxInvoiceSharepointUrl: null as string | null,
  project: { sharepointAdminFolderUrl: null as string | null },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSession.mockResolvedValue(SESSION);
  mocks.render.mockResolvedValue(new Uint8Array([1, 2, 3]));
  // Run the interactive transaction callback against a tx whose
  // invoice.update we can inspect.
  mocks.transaction.mockImplementation(async (cb: (tx: unknown) => unknown) =>
    cb({ invoice: { update: mocks.update } }),
  );
});

describe('finaliseInvoice · archival', () => {
  it('uploads the PDF and persists the SharePoint pointer + archived audit', async () => {
    mocks.findUnique.mockResolvedValue({ ...BASE_INVOICE });
    mocks.upload.mockResolvedValue({
      webUrl: 'https://foundry.sharepoint.com/inv/IFM001-INV-12.pdf',
      driveItemId: 'drv_123',
      folderPath: 'x',
      filename: 'y.pdf',
    });

    const res = await finaliseInvoice('inv_1');
    expect(res.status).toBe('success');

    // PDF rendered once, uploaded once with the invoice's own fields.
    expect(mocks.render).toHaveBeenCalledWith('inv_1');
    expect(mocks.upload).toHaveBeenCalledWith(
      expect.objectContaining({
        invoiceNumber: 'IFM001-INV-12',
        amountTotalCents: 1_870_000,
        ownerInitials: 'TT',
        id: 'inv_1',
      }),
    );

    // Pointer persisted on the invoice.
    expect(mocks.update).toHaveBeenCalledTimes(1);
    const updateArg = mocks.update.mock.calls[0]![0] as {
      data: Record<string, unknown>;
    };
    expect(updateArg.data.taxInvoiceSharepointUrl).toBe(
      'https://foundry.sharepoint.com/inv/IFM001-INV-12.pdf',
    );
    expect(updateArg.data.taxInvoiceDriveItemId).toBe('drv_123');
    expect(updateArg.data.taxInvoiceFinalisedAt).toBeInstanceOf(Date);

    // Audit records the archive with the URL in the delta.
    const auditArg = mocks.writeAudit.mock.calls[0]![1] as {
      entity: { after: Record<string, unknown> };
    };
    expect(auditArg.entity.after.via).toBe('tax_invoice_archived');
    expect(auditArg.entity.after.sharepointUrl).toBe(
      'https://foundry.sharepoint.com/inv/IFM001-INV-12.pdf',
    );
  });

  it('passes the project admin folder through to the archiver when set', async () => {
    mocks.findUnique.mockResolvedValue({
      ...BASE_INVOICE,
      project: { sharepointAdminFolderUrl: 'https://foundry.sharepoint.com/admin/IFM001' },
    });
    mocks.upload.mockResolvedValue({
      webUrl: 'https://foundry.sharepoint.com/admin/IFM001/inv.pdf',
      driveItemId: 'drv_admin',
      folderPath: 'x',
      filename: 'y.pdf',
    });

    await finaliseInvoice('inv_1');
    expect(mocks.upload).toHaveBeenCalledWith(
      expect.objectContaining({
        adminFolderWebUrl: 'https://foundry.sharepoint.com/admin/IFM001',
        invoiceNumber: 'IFM001-INV-12',
      }),
    );
  });

  it('still finalises (no pointer) when Graph is unreachable', async () => {
    mocks.findUnique.mockResolvedValue({ ...BASE_INVOICE });
    mocks.upload.mockResolvedValue(null); // Graph not configured

    const res = await finaliseInvoice('inv_1');
    expect(res.status).toBe('success');

    const updateArg = mocks.update.mock.calls[0]![0] as {
      data: Record<string, unknown>;
    };
    expect(updateArg.data.taxInvoiceFinalisedAt).toBeInstanceOf(Date);
    expect('taxInvoiceSharepointUrl' in updateArg.data).toBe(false);
    expect('taxInvoiceDriveItemId' in updateArg.data).toBe(false);

    const auditArg = mocks.writeAudit.mock.calls[0]![1] as {
      entity: { after: Record<string, unknown> };
    };
    expect(auditArg.entity.after.via).toBe('tax_invoice_finalised');
    expect(auditArg.entity.after.archiveSkipped).toBe(true);
  });

  it('retries archival when finalised earlier but pointer is still null', async () => {
    const earlier = new Date('2026-07-09T02:00:00Z');
    mocks.findUnique.mockResolvedValue({
      ...BASE_INVOICE,
      taxInvoiceFinalisedAt: earlier,
      taxInvoiceSharepointUrl: null,
    });
    mocks.upload.mockResolvedValue({
      webUrl: 'https://foundry.sharepoint.com/inv/late.pdf',
      driveItemId: 'drv_late',
      folderPath: 'x',
      filename: 'y.pdf',
    });

    const res = await finaliseInvoice('inv_1');
    expect(res.status).toBe('success');
    if (res.status === 'success') {
      // Original issuance time preserved, not overwritten.
      expect(res.finalisedAt).toBe(earlier.toISOString());
    }
    expect(mocks.render).toHaveBeenCalledTimes(1);
    const updateArg = mocks.update.mock.calls[0]![0] as {
      data: Record<string, unknown>;
    };
    expect(updateArg.data.taxInvoiceSharepointUrl).toBe(
      'https://foundry.sharepoint.com/inv/late.pdf',
    );
    expect(updateArg.data.taxInvoiceFinalisedAt).toEqual(earlier);
  });

  it('short-circuits when already finalised AND archived', async () => {
    const when = new Date('2026-07-08T05:00:00Z');
    mocks.findUnique.mockResolvedValue({
      ...BASE_INVOICE,
      taxInvoiceFinalisedAt: when,
      taxInvoiceSharepointUrl: 'https://foundry.sharepoint.com/inv/done.pdf',
    });

    const res = await finaliseInvoice('inv_1');
    expect(res.status).toBe('success');
    // No re-render, no re-upload, no write.
    expect(mocks.render).not.toHaveBeenCalled();
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
