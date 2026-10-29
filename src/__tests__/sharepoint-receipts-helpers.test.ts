import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  deriveAustralianFY,
  buildReceiptFilename,
  newReceiptUid,
  extensionFromMime,
  receiptFolderPath,
  buildInvoiceFilename,
  invoiceFolderPath,
  encodeSharingToken,
} from '@/server/integrations/sharepoint-receipts';

/**
 * TASK-042b / 046b · pure-function tests for the SharePoint receipt
 * uploader. Covers FY derivation across year rollovers, filename
 * sanitisation, MIME → extension mapping, and folder-path assembly
 * against SHAREPOINT_RECEIPTS_ROOT (default + override).
 */

const ORIGINAL_ROOT = process.env['SHAREPOINT_RECEIPTS_ROOT'];

beforeEach(() => {
  delete process.env['SHAREPOINT_RECEIPTS_ROOT'];
});

afterEach(() => {
  if (ORIGINAL_ROOT === undefined) {
    delete process.env['SHAREPOINT_RECEIPTS_ROOT'];
  } else {
    process.env['SHAREPOINT_RECEIPTS_ROOT'] = ORIGINAL_ROOT;
  }
});

describe('deriveAustralianFY', () => {
  it('early-July 2026 → FY 26 - 27', () => {
    expect(deriveAustralianFY(new Date('2026-07-01T00:00:00Z'))).toBe('FY 26 - 27');
  });
  it('mid-FY (Nov 2026) → FY 26 - 27', () => {
    expect(deriveAustralianFY(new Date('2026-11-15T12:00:00Z'))).toBe('FY 26 - 27');
  });
  it('June 30 rollover boundary → still FY 26 - 27 for a 30-Jun-2027 date', () => {
    // Jun 2027 (month=5, zero-indexed) is the LAST day of FY 26 - 27.
    expect(deriveAustralianFY(new Date('2027-06-30T23:59:59Z'))).toBe('FY 26 - 27');
  });
  it('July 1 rollover → FY 27 - 28 for a 1-Jul-2027 date', () => {
    expect(deriveAustralianFY(new Date('2027-07-01T00:00:00Z'))).toBe('FY 27 - 28');
  });
  it('January of the FY (Jan 2027) → FY 26 - 27 (still second half of FY)', () => {
    expect(deriveAustralianFY(new Date('2027-01-15T00:00:00Z'))).toBe('FY 26 - 27');
  });
  it('handles the century wrap (Dec 1999 → FY 99 - 00)', () => {
    expect(deriveAustralianFY(new Date('1999-12-01T00:00:00Z'))).toBe('FY 99 - 00');
  });
});

describe('extensionFromMime', () => {
  it('maps known types', () => {
    expect(extensionFromMime('application/pdf')).toBe('pdf');
    expect(extensionFromMime('image/jpeg')).toBe('jpg');
    expect(extensionFromMime('image/png')).toBe('png');
    expect(extensionFromMime('image/heic')).toBe('heic');
    expect(extensionFromMime('image/webp')).toBe('webp');
  });
  it('is case-insensitive', () => {
    expect(extensionFromMime('APPLICATION/PDF')).toBe('pdf');
    expect(extensionFromMime('Image/JPEG')).toBe('jpg');
  });
  it('falls back to bin for unknown mime', () => {
    expect(extensionFromMime('application/x-arcade-token')).toBe('bin');
    expect(extensionFromMime('')).toBe('bin');
  });
});

describe('buildReceiptFilename', () => {
  const base = {
    date: new Date('2026-07-08T00:00:00Z'),
    projectCode: 'IFM001',
    vendor: 'Amazon Web Services',
    category: 'subscriptions',
    amountCents: 8912,
    ownerInitials: 'TT',
    uid: 'EXP-A1B2C3D4',
    extension: 'pdf',
  };

  it('names who, what, which project and when, plus the uid', () => {
    expect(buildReceiptFilename(base)).toBe(
      '2026-07-08 - IFM001 - Amazon Web Services - subscriptions - $89 - TT - EXP-A1B2C3D4.pdf',
    );
  });
  it('upper-cases the project code and lower-cases the category', () => {
    const name = buildReceiptFilename({
      ...base,
      projectCode: 'ifm001',
      category: 'Subscriptions',
    });
    expect(name).toContain(' - IFM001 - ');
    expect(name).toContain(' - subscriptions - ');
  });
  it('falls back to NOPROJECT when the cost is untagged overhead', () => {
    expect(buildReceiptFilename({ ...base, projectCode: null })).toBe(
      '2026-07-08 - NOPROJECT - Amazon Web Services - subscriptions - $89 - TT - EXP-A1B2C3D4.pdf',
    );
  });
  it('falls back to uncategorised when the category is unknown', () => {
    expect(buildReceiptFilename({ ...base, category: null })).toContain(
      ' - uncategorised - ',
    );
  });
  it('keeps the seven-segment shape when everything is missing', () => {
    const name = buildReceiptFilename({
      ...base,
      projectCode: null,
      vendor: null,
      category: '  ',
    });
    expect(name.split(' - ')).toHaveLength(7);
    expect(name).toBe(
      '2026-07-08 - NOPROJECT - no-vendor - uncategorised - $89 - TT - EXP-A1B2C3D4.pdf',
    );
  });
  it('sanitises invalid SharePoint chars in the vendor', () => {
    const name = buildReceiptFilename({
      ...base,
      vendor: 'Rip/off*Vendor?LLC<>',
      ownerInitials: 'JN',
      uid: 'EXP-XYZ12345',
    });
    // Each of / * ? < > replaced with '-' → "Rip-off-Vendor-LLC--".
    expect(name).toBe(
      '2026-07-08 - IFM001 - Rip-off-Vendor-LLC-- - subscriptions - $89 - JN - EXP-XYZ12345.pdf',
    );
    expect(name).not.toMatch(/[/\\?%*:|"<>]/u);
  });
  it('collapses a " - " inside a vendor so it cannot fake a segment', () => {
    const name = buildReceiptFilename({ ...base, vendor: 'Kee - Lee Catering' });
    expect(name.split(' - ')).toHaveLength(7);
    expect(name).toContain(' - Kee-Lee Catering - ');
  });
  it('truncates absurdly long vendor names to 60 chars', () => {
    const name = buildReceiptFilename({ ...base, vendor: 'X'.repeat(200) });
    expect(name.split(' - ')[2]?.length).toBe(60);
  });
  it('truncates an absurdly long project code to 24 chars', () => {
    const name = buildReceiptFilename({ ...base, projectCode: 'P'.repeat(80) });
    expect(name.split(' - ')[1]?.length).toBe(24);
  });
  it('rounds amount to whole dollars', () => {
    // 550 cents = $5.50; expected $6 via Math.round
    expect(buildReceiptFilename({ ...base, amountCents: 550 })).toContain(' - $6 - ');
  });
  it('normalises the extension case', () => {
    expect(buildReceiptFilename({ ...base, extension: '.PDF' }).endsWith('.pdf')).toBe(
      true,
    );
  });
});

describe('newReceiptUid', () => {
  it('prefixes by kind and uses uppercase hex', () => {
    expect(newReceiptUid('expense')).toMatch(/^EXP-[0-9A-F]{8}$/u);
    expect(newReceiptUid('bill')).toMatch(/^BILL-[0-9A-F]{8}$/u);
  });
  it('is unique across calls', () => {
    const uids = new Set(Array.from({ length: 200 }, () => newReceiptUid('expense')));
    expect(uids.size).toBe(200);
  });
  it('survives the filename builder unchanged', () => {
    const uid = newReceiptUid('bill');
    const name = buildReceiptFilename({
      date: new Date('2026-07-08T00:00:00Z'),
      projectCode: 'IFM001',
      vendor: 'Qantas',
      category: 'travel',
      amountCents: 42000,
      ownerInitials: 'TT',
      uid,
      extension: 'pdf',
    });
    expect(name.endsWith(`${uid}.pdf`)).toBe(true);
  });
});

describe('receiptFolderPath', () => {
  it('assembles the default path for an expense in Aug 2026', () => {
    expect(receiptFolderPath('expense', new Date('2026-08-15T00:00:00Z'))).toBe(
      'CORPORATE/ADMIN ACCESS/00 Administration/03 Financial/01 Company Administration/FY 26 - 27/Expenses/2026-08',
    );
  });
  it('uses "Bills" for the bill kind', () => {
    expect(receiptFolderPath('bill', new Date('2026-08-15T00:00:00Z'))).toBe(
      'CORPORATE/ADMIN ACCESS/00 Administration/03 Financial/01 Company Administration/FY 26 - 27/Bills/2026-08',
    );
  });
  it('honours SHAREPOINT_RECEIPTS_ROOT override', () => {
    process.env['SHAREPOINT_RECEIPTS_ROOT'] = 'CUSTOM/ROOT';
    expect(receiptFolderPath('expense', new Date('2026-08-15T00:00:00Z'))).toBe(
      'CUSTOM/ROOT/FY 26 - 27/Expenses/2026-08',
    );
  });
  it('crosses the FY boundary correctly (Jul 2027 → FY 27 - 28)', () => {
    expect(receiptFolderPath('expense', new Date('2027-07-01T00:00:00Z'))).toBe(
      'CORPORATE/ADMIN ACCESS/00 Administration/03 Financial/01 Company Administration/FY 27 - 28/Expenses/2027-07',
    );
  });
});

// ─── TASK-068 · invoice PDF archival helpers ────────────────────────

describe('invoiceFolderPath', () => {
  it('files an invoice under the Invoices bucket by issue date', () => {
    expect(invoiceFolderPath(new Date('2026-08-15T00:00:00Z'))).toBe(
      'CORPORATE/ADMIN ACCESS/00 Administration/03 Financial/01 Company Administration/FY 26 - 27/Invoices/2026-08',
    );
  });
  it('honours SHAREPOINT_RECEIPTS_ROOT override', () => {
    process.env['SHAREPOINT_RECEIPTS_ROOT'] = 'CUSTOM/ROOT';
    expect(invoiceFolderPath(new Date('2026-08-15T00:00:00Z'))).toBe(
      'CUSTOM/ROOT/FY 26 - 27/Invoices/2026-08',
    );
  });
  it('crosses the FY boundary (Jul 2027 → FY 27 - 28)', () => {
    expect(invoiceFolderPath(new Date('2027-07-01T00:00:00Z'))).toBe(
      'CORPORATE/ADMIN ACCESS/00 Administration/03 Financial/01 Company Administration/FY 27 - 28/Invoices/2027-07',
    );
  });
});

describe('buildInvoiceFilename', () => {
  it('produces the canonical shape with number, dollars and issuer', () => {
    const name = buildInvoiceFilename({
      issueDate: new Date('2026-07-08T00:00:00Z'),
      invoiceNumber: 'IFM001-INV-12',
      amountTotalCents: 1_870_000,
      ownerInitials: 'TT',
      id: 'inv_a1b2c3d4e5',
    });
    expect(name).toBe('2026-07-08 - IFM001-INV-12 - $18700 - TT - b2c3d4e5.pdf');
  });
  it('sanitises invalid SharePoint chars in the invoice number', () => {
    const name = buildInvoiceFilename({
      issueDate: new Date('2026-07-08T00:00:00Z'),
      invoiceNumber: 'INV/01*x?',
      amountTotalCents: 5000,
      ownerInitials: 'JN',
      id: 'inv_xyz98765',
    });
    // "INV/01*x?" → each of / * ? replaced with '-' → "INV-01-x-";
    // shortId is the last 8 chars of the id → "xyz98765".
    expect(name).toBe('2026-07-08 - INV-01-x- - $50 - JN - xyz98765.pdf');
    expect(name).not.toMatch(/[/\\?%*:|"<>]/u);
  });
  it('always ends in .pdf', () => {
    const name = buildInvoiceFilename({
      issueDate: new Date('2026-07-08T00:00:00Z'),
      invoiceNumber: 'X-1',
      amountTotalCents: 100,
      ownerInitials: 'AA',
      id: 'inv_1',
    });
    expect(name.endsWith('.pdf')).toBe(true);
  });
  it('falls back to "no-number" when the number is empty', () => {
    const name = buildInvoiceFilename({
      issueDate: new Date('2026-07-08T00:00:00Z'),
      invoiceNumber: '',
      amountTotalCents: 100,
      ownerInitials: 'TT',
      id: 'inv_1',
    });
    expect(name).toContain(' - no-number - ');
  });
});

// ─── TASK-068b · admin-folder webUrl → sharing token ────────────────

describe('encodeSharingToken', () => {
  it('produces a u!-prefixed URL-safe token that round-trips the webUrl', () => {
    const url =
      'https://foundry.sharepoint.com/sites/Foundry/Shared Documents/Admin/IFM001?x=1';
    const tok = encodeSharingToken(url);
    expect(tok.startsWith('u!')).toBe(true);
    // URL-safe: no +, /, or = in the encoded portion.
    expect(tok.slice(2)).not.toMatch(/[+/=]/u);
    // Reverse the transforms → original bytes.
    const b64 = tok.slice(2).replace(/-/gu, '+').replace(/_/gu, '/');
    expect(Buffer.from(b64, 'base64').toString('utf8')).toBe(url);
  });
});
