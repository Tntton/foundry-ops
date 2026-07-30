import { describe, expect, it } from 'vitest';
import {
  looksLikeInvoice,
  type GraphMessage,
} from '@/server/integrations/m365-mail-intake';

/**
 * TASK-093 · looksLikeInvoice heuristic tests. Golden-file style — each
 * `mk*` factory produces a fixture that exercises one rule of the
 * heuristic. Kept in a single suite so the ordering of rules is
 * comparable side-by-side (invoice keyword → attachment types → sender
 * domain → M365 personal category).
 */

function base(overrides: Partial<GraphMessage> = {}): GraphMessage {
  return {
    id: 'AAMkAExample',
    subject: 'Invoice #INV-2026-042',
    from: {
      emailAddress: {
        address: 'billing@xero-supplier.com',
        name: 'Xero Supplier Pty Ltd',
      },
    },
    receivedDateTime: '2026-05-29T04:00:00Z',
    hasAttachments: true,
    categories: [],
    attachments: [
      {
        id: 'AAMkAtt1',
        name: 'INV-2026-042.pdf',
        contentType: 'application/pdf',
        size: 123456,
        isInline: false,
      },
    ],
    ...overrides,
  };
}

describe('looksLikeInvoice', () => {
  it('accepts a standard vendor invoice email', () => {
    expect(looksLikeInvoice(base())).toEqual({ ok: true });
  });

  it('accepts a forwarded invoice (Re: Fwd:)', () => {
    // Forwarders often prepend Re:/Fwd:; the subject still contains the
    // invoice keyword so the regex catches it.
    const msg = base({
      subject: 'Re: Fwd: Invoice from Xero Supplier — payment due 15 Jun',
      from: {
        emailAddress: {
          address: 'chris@foundry.health',
          name: 'Chris Partner',
        },
      },
    });
    expect(looksLikeInvoice(msg)).toEqual({ ok: true });
  });

  it('accepts an internal forward from a staff member', () => {
    // Spec edge case: staff drag a vendor PDF into finance@ — sender
    // domain is @foundry.health but the attachment is the real vendor
    // PDF. Should pass heuristic; OCR handles the content.
    const msg = base({
      subject: 'FW: Statement from Amazon Web Services — May 2026',
      from: {
        emailAddress: {
          address: 'jas.navarro@foundry.health',
          name: 'Jas Navarro',
        },
      },
    });
    expect(looksLikeInvoice(msg)).toEqual({ ok: true });
  });

  it('accepts an email with multiple attachments (invoice + footer logo)', () => {
    // Multi-attachment invoices are the norm — supplier signature
    // block, decorative logos, etc. Heuristic only needs one PDF/image
    // to trigger; the extraction step picks the highest-confidence
    // attachment.
    const msg = base({
      attachments: [
        {
          id: 'att-logo',
          name: 'signature-logo.png',
          contentType: 'image/png',
          size: 12000,
          isInline: true, // often inline, still counts for the mime check
        },
        {
          id: 'att-inv',
          name: 'INV-2026-042.pdf',
          contentType: 'application/pdf',
          size: 456789,
          isInline: false,
        },
      ],
    });
    expect(looksLikeInvoice(msg)).toEqual({ ok: true });
  });

  it('accepts a follow-up reminder (same invoice, second arrival)', () => {
    // "Reminder: invoice #INV-2026-042 payment due" — heuristic passes;
    // dedupe in processMessage blocks the second Bill row via the
    // (supplierName + invoiceNumber) key.
    const msg = base({
      subject: 'Reminder: invoice #INV-2026-042 payment due 15 Jun',
    });
    expect(looksLikeInvoice(msg)).toEqual({ ok: true });
  });

  it('accepts an image-only receipt (JPEG scan)', () => {
    const msg = base({
      subject: 'Receipt for your July payment',
      attachments: [
        {
          id: 'att-scan',
          name: 'receipt-scan.jpg',
          contentType: 'image/jpeg',
          size: 234567,
          isInline: false,
        },
      ],
    });
    expect(looksLikeInvoice(msg)).toEqual({ ok: true });
  });

  it('rejects a message with no attachments', () => {
    const msg = base({
      hasAttachments: false,
      attachments: [],
    });
    expect(looksLikeInvoice(msg)).toEqual({
      ok: false,
      reason: 'no attachments',
    });
  });

  it('rejects an attachment that is not PDF/image (calendar invite .ics)', () => {
    const msg = base({
      subject: 'Invoice discussion — please accept meeting',
      attachments: [
        {
          id: 'att-ics',
          name: 'invite.ics',
          contentType: 'text/calendar',
          size: 1024,
          isInline: false,
        },
      ],
    });
    expect(looksLikeInvoice(msg).ok).toBe(false);
  });

  it('rejects a subject that does not match the invoice regex', () => {
    // Personal-looking mail with a PDF attached (e.g. a signed doc,
    // a shipping notification, an event flyer). Rejected on subject.
    const msg = base({
      subject: 'Photos from the team offsite',
    });
    expect(looksLikeInvoice(msg)).toEqual({
      ok: false,
      reason: 'subject regex mismatch',
    });
  });

  it('rejects a message tagged with a personal M365 category', () => {
    const msg = base({
      subject: 'Invoice — personal fitness membership',
      categories: ['Personal'],
    });
    expect(looksLikeInvoice(msg)).toEqual({
      ok: false,
      reason: 'personal M365 category',
    });
  });

  it('subject regex matches "bill", "statement", "receipt", "payable", "payment", "due", "remittance"', () => {
    const keywords = [
      'Your monthly bill from Telstra',
      'April statement · Australian Ethical Super',
      'Your payment receipt for AWS',
      'Payable notification — Company X',
      'Payment confirmation from Rippling',
      'Amount due — Xero subscription',
      'Remittance advice: BNP Paribas',
    ];
    for (const s of keywords) {
      expect(looksLikeInvoice(base({ subject: s })).ok).toBe(true);
    }
  });

  it('subject regex is case-insensitive', () => {
    expect(looksLikeInvoice(base({ subject: 'INVOICE #99' })).ok).toBe(true);
    expect(looksLikeInvoice(base({ subject: 'invoice #99' })).ok).toBe(true);
    expect(looksLikeInvoice(base({ subject: 'InVoIcE #99' })).ok).toBe(true);
  });
});
