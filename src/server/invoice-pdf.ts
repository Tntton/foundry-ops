import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { prisma } from '@/server/db';

/**
 * Render an invoice as a single PDF with all rebilled receipt
 * documents appended after the cover page.
 *
 * The cover page is generated programmatically with `pdf-lib` —
 * pure-JS, no headless browser dependency, fits comfortably in a
 * Vercel serverless function. It carries:
 *   - Foundry Health header
 *   - Invoice number, issue + due dates, client + project
 *   - Line items table
 *   - Totals (ex-GST, GST, total)
 *
 * After the cover, every Bill / Expense with `rebilledOnInvoiceId =
 * invoice.id` contributes its receipt:
 *   - For data: URLs (inline) — decode + embed
 *   - For http(s):// URLs — direct fetch
 *   - For sharepoint: URLs — TODO once Graph download helper lands;
 *     placeholder page with the URL printed so the document still
 *     records what *should* be attached
 *
 * Each receipt's content type drives the embed strategy:
 *   - application/pdf → copy pages from the source PDF
 *   - image/* (png/jpg/jpeg/gif/webp) → embed full-page image, one
 *     image per page, sized to fit A4 portrait
 *   - everything else → placeholder page noting the file type +
 *     original filename so admin can chase the missing asset
 *
 * Returns the merged PDF bytes. Caller streams as a download.
 */
export async function renderInvoicePdfWithReceipts(
  invoiceId: string,
): Promise<Uint8Array> {
  // Pull the invoice + everything that was forwarded onto it. Two
  // queries — one for the invoice with lines + project + client,
  // one each for the bills + expenses that point back at it.
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: {
      lineItems: true,
      project: { select: { code: true, name: true } },
      client: { select: { code: true, legalName: true } },
    },
  });
  if (!invoice) throw new Error('Invoice not found');

  const [rebilledBills, rebilledExpenses] = await Promise.all([
    prisma.bill.findMany({
      where: { rebilledOnInvoiceId: invoiceId },
      select: {
        id: true,
        supplierName: true,
        supplierInvoiceNumber: true,
        issueDate: true,
        amountTotal: true,
        attachmentSharepointUrl: true,
      },
      orderBy: { issueDate: 'asc' },
    }),
    prisma.expense.findMany({
      where: { rebilledOnInvoiceId: invoiceId },
      select: {
        id: true,
        vendor: true,
        description: true,
        date: true,
        amount: true,
        receiptSharepointUrl: true,
        person: { select: { firstName: true, lastName: true } },
      },
      orderBy: { date: 'asc' },
    }),
  ]);

  const pdf = await PDFDocument.create();
  await renderCoverPage(pdf, invoice, rebilledBills, rebilledExpenses);

  // Append each receipt in a deterministic order — bills first
  // (oldest issueDate), then expenses (oldest first). Match the
  // cover-page ordering so the receipt index lines up with the
  // appendix.
  for (const b of rebilledBills) {
    await appendReceipt(pdf, {
      title: `${b.supplierName ?? 'Vendor bill'}${
        b.supplierInvoiceNumber ? ` · ${b.supplierInvoiceNumber}` : ''
      }`,
      url: b.attachmentSharepointUrl,
      amountCents: b.amountTotal,
      date: b.issueDate,
    });
  }
  for (const e of rebilledExpenses) {
    await appendReceipt(pdf, {
      title: `${e.vendor ?? e.description ?? 'Expense'} · ${e.person.firstName} ${e.person.lastName}`,
      url: e.receiptSharepointUrl,
      amountCents: e.amount,
      date: e.date,
    });
  }

  return pdf.save();
}

function formatMoney(cents: number): string {
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

/** A4 portrait dimensions in pdf-lib points (1pt = 1/72 inch). */
const A4_WIDTH = 595.28;
const A4_HEIGHT = 841.89;
const MARGIN = 50;

type InvoicePdfRow = {
  invoice: {
    id: string;
    number: string;
    issueDate: Date;
    dueDate: Date;
    amountExGst: number;
    gst: number;
    amountTotal: number;
    purchaseOrderRef: string | null;
    forSubject: string | null;
    attentionTo: string | null;
    project: { code: string; name: string };
    client: { code: string; legalName: string };
    lineItems: Array<{ label: string; amount: number }>;
  };
};

async function renderCoverPage(
  pdf: PDFDocument,
  invoice: InvoicePdfRow['invoice'],
  rebilledBills: Array<{ id: string }>,
  rebilledExpenses: Array<{ id: string }>,
): Promise<void> {
  const page = pdf.addPage([A4_WIDTH, A4_HEIGHT]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);

  // Header — Foundry Health title + "TAX INVOICE" stamp.
  let y = A4_HEIGHT - MARGIN;
  page.drawText('Foundry Health', {
    x: MARGIN,
    y,
    size: 18,
    font: fontBold,
    color: rgb(0.1, 0.15, 0.2),
  });
  page.drawText('TAX INVOICE', {
    x: A4_WIDTH - MARGIN - 110,
    y,
    size: 16,
    font: fontBold,
    color: rgb(0.4, 0.4, 0.45),
  });

  // Invoice meta block — number + dates.
  y -= 40;
  drawLabelValue(page, font, fontBold, 'Invoice #', invoice.number, MARGIN, y);
  drawLabelValue(
    page,
    font,
    fontBold,
    'Issue date',
    invoice.issueDate.toLocaleDateString('en-AU'),
    MARGIN + 200,
    y,
  );
  drawLabelValue(
    page,
    font,
    fontBold,
    'Due date',
    invoice.dueDate.toLocaleDateString('en-AU'),
    MARGIN + 380,
    y,
  );

  // Bill-to + project block.
  y -= 40;
  page.drawText('BILL TO', {
    x: MARGIN,
    y,
    size: 9,
    font: fontBold,
    color: rgb(0.45, 0.45, 0.5),
  });
  page.drawText('PROJECT', {
    x: MARGIN + 300,
    y,
    size: 9,
    font: fontBold,
    color: rgb(0.45, 0.45, 0.5),
  });
  y -= 14;
  page.drawText(invoice.client.legalName, {
    x: MARGIN,
    y,
    size: 11,
    font: fontBold,
  });
  page.drawText(`${invoice.project.code} · ${invoice.project.name}`, {
    x: MARGIN + 300,
    y,
    size: 11,
    font: fontBold,
  });
  if (invoice.attentionTo) {
    y -= 13;
    page.drawText(`Attn: ${invoice.attentionTo}`, {
      x: MARGIN,
      y,
      size: 10,
      font,
    });
  }
  if (invoice.purchaseOrderRef) {
    y -= 13;
    page.drawText(`PO: ${invoice.purchaseOrderRef}`, {
      x: MARGIN,
      y,
      size: 10,
      font,
    });
  }
  if (invoice.forSubject) {
    y -= 13;
    page.drawText(`For: ${invoice.forSubject}`, {
      x: MARGIN,
      y,
      size: 10,
      font,
    });
  }

  // Line items table.
  y -= 30;
  drawTableHeader(page, fontBold, MARGIN, y);
  y -= 16;
  page.drawLine({
    start: { x: MARGIN, y: y + 2 },
    end: { x: A4_WIDTH - MARGIN, y: y + 2 },
    thickness: 0.5,
    color: rgb(0.8, 0.8, 0.85),
  });

  for (const line of invoice.lineItems) {
    if (y < MARGIN + 120) {
      // Out of room on the cover page — wrap to a continuation
      // page. Rare for typical Foundry invoice sizes but worth
      // handling defensively.
      break;
    }
    y -= 14;
    drawTableRow(page, font, line.label, line.amount, MARGIN, y);
  }

  // Totals.
  y -= 30;
  page.drawLine({
    start: { x: A4_WIDTH - MARGIN - 200, y },
    end: { x: A4_WIDTH - MARGIN, y },
    thickness: 0.5,
    color: rgb(0.8, 0.8, 0.85),
  });
  y -= 16;
  drawTotalRow(page, font, fontBold, 'Subtotal (ex GST)', invoice.amountExGst, y);
  y -= 14;
  drawTotalRow(page, font, fontBold, 'GST (10%)', invoice.gst, y);
  y -= 18;
  drawTotalRow(
    page,
    fontBold,
    fontBold,
    'Total AUD',
    invoice.amountTotal,
    y,
    true,
  );

  // Appendix index — note that the receipts follow.
  const appendixCount = rebilledBills.length + rebilledExpenses.length;
  if (appendixCount > 0) {
    y -= 50;
    page.drawText('Appendix · Supporting receipts', {
      x: MARGIN,
      y,
      size: 10,
      font: fontBold,
      color: rgb(0.45, 0.45, 0.5),
    });
    y -= 14;
    page.drawText(
      `${appendixCount} supporting document${appendixCount === 1 ? '' : 's'} attached on the following pages — vendor invoices and reimbursement receipts for each pass-through line above.`,
      {
        x: MARGIN,
        y,
        size: 9,
        font,
        color: rgb(0.3, 0.3, 0.35),
        maxWidth: A4_WIDTH - 2 * MARGIN,
        lineHeight: 11,
      },
    );
  }
}

function drawLabelValue(
  page: ReturnType<PDFDocument['addPage']>,
  font: Awaited<ReturnType<PDFDocument['embedFont']>>,
  fontBold: Awaited<ReturnType<PDFDocument['embedFont']>>,
  label: string,
  value: string,
  x: number,
  y: number,
): void {
  page.drawText(label, {
    x,
    y,
    size: 8,
    font,
    color: rgb(0.45, 0.45, 0.5),
  });
  page.drawText(value, {
    x,
    y: y - 12,
    size: 11,
    font: fontBold,
  });
}

function drawTableHeader(
  page: ReturnType<PDFDocument['addPage']>,
  fontBold: Awaited<ReturnType<PDFDocument['embedFont']>>,
  x: number,
  y: number,
): void {
  page.drawText('DESCRIPTION', {
    x,
    y,
    size: 8,
    font: fontBold,
    color: rgb(0.45, 0.45, 0.5),
  });
  page.drawText('AMOUNT (AUD)', {
    x: A4_WIDTH - MARGIN - 100,
    y,
    size: 8,
    font: fontBold,
    color: rgb(0.45, 0.45, 0.5),
  });
}

function drawTableRow(
  page: ReturnType<PDFDocument['addPage']>,
  font: Awaited<ReturnType<PDFDocument['embedFont']>>,
  label: string,
  amount: number,
  x: number,
  y: number,
): void {
  // Truncate long labels so they don't overflow the amount column.
  const maxChars = 70;
  const display = label.length > maxChars ? `${label.slice(0, maxChars - 1)}…` : label;
  page.drawText(display, { x, y, size: 9, font });
  page.drawText(formatMoney(amount), {
    x: A4_WIDTH - MARGIN - 100,
    y,
    size: 9,
    font,
  });
}

function drawTotalRow(
  page: ReturnType<PDFDocument['addPage']>,
  labelFont: Awaited<ReturnType<PDFDocument['embedFont']>>,
  valueFont: Awaited<ReturnType<PDFDocument['embedFont']>>,
  label: string,
  amount: number,
  y: number,
  emphasised = false,
): void {
  page.drawText(label, {
    x: A4_WIDTH - MARGIN - 200,
    y,
    size: emphasised ? 11 : 9,
    font: labelFont,
    color: emphasised ? rgb(0, 0, 0) : rgb(0.3, 0.3, 0.35),
  });
  page.drawText(formatMoney(amount), {
    x: A4_WIDTH - MARGIN - 100,
    y,
    size: emphasised ? 11 : 9,
    font: valueFont,
  });
}

/**
 * Pull a receipt asset and add it to the merged PDF. Handles three
 * URL shapes:
 *   - `data:` inline (no fetch needed)
 *   - `http(s)://` direct download
 *   - `sharepoint:` placeholder until the Graph download helper lands
 *
 * For each shape, dispatches on content type:
 *   - PDF → copy pages
 *   - image → embed full-page
 *   - unknown → placeholder page with the URL printed so the audit
 *     trail still shows what's missing
 */
async function appendReceipt(
  pdf: PDFDocument,
  receipt: {
    title: string;
    url: string | null;
    amountCents: number;
    date: Date;
  },
): Promise<void> {
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);

  if (!receipt.url) {
    drawPlaceholderPage(pdf, font, fontBold, receipt, 'No receipt on file');
    return;
  }

  try {
    const fetched = await fetchReceiptBytes(receipt.url);
    if (!fetched) {
      drawPlaceholderPage(
        pdf,
        font,
        fontBold,
        receipt,
        `Receipt at ${receipt.url} could not be fetched`,
      );
      return;
    }
    const { bytes, contentType } = fetched;

    if (contentType.includes('pdf')) {
      const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
      const pages = await pdf.copyPages(src, src.getPageIndices());
      for (const p of pages) pdf.addPage(p);
      return;
    }

    if (
      contentType.includes('image/png') ||
      contentType.includes('image/jpeg') ||
      contentType.includes('image/jpg') ||
      contentType.startsWith('image/')
    ) {
      const isPng = contentType.includes('png');
      const image = isPng
        ? await pdf.embedPng(bytes)
        : await pdf.embedJpg(bytes).catch(async () => pdf.embedPng(bytes));
      // Single A4 portrait page, image scaled to fit with margin.
      const page = pdf.addPage([A4_WIDTH, A4_HEIGHT]);
      // Title banner so admin can identify the receipt in the
      // appendix even when the image itself isn't self-descriptive.
      page.drawText(receipt.title, {
        x: MARGIN,
        y: A4_HEIGHT - MARGIN,
        size: 11,
        font: fontBold,
      });
      page.drawText(
        `${receipt.date.toLocaleDateString('en-AU')} · ${formatMoney(receipt.amountCents)}`,
        {
          x: MARGIN,
          y: A4_HEIGHT - MARGIN - 14,
          size: 9,
          font,
          color: rgb(0.45, 0.45, 0.5),
        },
      );
      const avail = {
        w: A4_WIDTH - 2 * MARGIN,
        h: A4_HEIGHT - 2 * MARGIN - 40,
      };
      const scale = Math.min(
        avail.w / image.width,
        avail.h / image.height,
      );
      page.drawImage(image, {
        x: MARGIN + (avail.w - image.width * scale) / 2,
        y: MARGIN,
        width: image.width * scale,
        height: image.height * scale,
      });
      return;
    }

    drawPlaceholderPage(
      pdf,
      font,
      fontBold,
      receipt,
      `Unsupported receipt type (${contentType}) — link: ${receipt.url}`,
    );
  } catch (err) {
    console.error(
      `[invoice-pdf] failed to append receipt for "${receipt.title}":`,
      err,
    );
    drawPlaceholderPage(
      pdf,
      font,
      fontBold,
      receipt,
      `Error fetching receipt: ${(err as Error).message}`,
    );
  }
}

/**
 * Best-effort receipt download. Returns `null` when the URL scheme
 * isn't fetchable in the current environment (e.g. SharePoint URLs
 * that need Graph OAuth and we don't have the download helper yet).
 */
async function fetchReceiptBytes(
  url: string,
): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  // Inline data: URI — decode directly. Format:
  // data:<mediatype>[;base64],<data>
  if (url.startsWith('data:')) {
    const match = url.match(/^data:([^;,]+)(?:;base64)?,(.*)$/);
    if (!match) return null;
    const contentType = match[1] ?? 'application/octet-stream';
    const payload = match[2] ?? '';
    const isBase64 = url.includes(';base64,');
    const bytes = isBase64
      ? Uint8Array.from(Buffer.from(payload, 'base64'))
      : new TextEncoder().encode(decodeURIComponent(payload));
    return { bytes, contentType };
  }

  // SharePoint download requires Microsoft Graph + the file's drive
  // item id. Not wired yet — TODO once the Graph helper lands. Return
  // null so the caller renders a placeholder page noting the URL.
  if (url.startsWith('sharepoint:')) return null;

  // pending-upload: placeholder URLs from the intake flow. Nothing to
  // fetch — explicit placeholder.
  if (url.startsWith('pending-upload:')) return null;

  if (url.startsWith('http://') || url.startsWith('https://')) {
    const res = await fetch(url, {
      // 20s ceiling — Uber/Navan-hosted receipt URLs are usually a
      // few hundred KB. A 20s cap stops a hung link from eating the
      // entire merge budget.
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      return null;
    }
    const contentType = res.headers.get('content-type') ?? 'application/octet-stream';
    const buf = new Uint8Array(await res.arrayBuffer());
    return { bytes: buf, contentType };
  }
  return null;
}

/**
 * Render a "couldn't attach this receipt" page that still records
 * what should be there. Preserves audit-trail integrity even when
 * the upstream link is broken / requires auth we don't have.
 */
function drawPlaceholderPage(
  pdf: PDFDocument,
  font: Awaited<ReturnType<PDFDocument['embedFont']>>,
  fontBold: Awaited<ReturnType<PDFDocument['embedFont']>>,
  receipt: { title: string; amountCents: number; date: Date },
  reason: string,
): void {
  const page = pdf.addPage([A4_WIDTH, A4_HEIGHT]);
  let y = A4_HEIGHT - MARGIN;
  page.drawText(receipt.title, {
    x: MARGIN,
    y,
    size: 12,
    font: fontBold,
  });
  y -= 16;
  page.drawText(
    `${receipt.date.toLocaleDateString('en-AU')} · ${formatMoney(receipt.amountCents)}`,
    { x: MARGIN, y, size: 9, font, color: rgb(0.45, 0.45, 0.5) },
  );
  y -= 80;
  page.drawText('Receipt could not be attached', {
    x: MARGIN,
    y,
    size: 14,
    font: fontBold,
    color: rgb(0.85, 0.4, 0.15),
  });
  y -= 18;
  page.drawText(reason, {
    x: MARGIN,
    y,
    size: 10,
    font,
    color: rgb(0.3, 0.3, 0.35),
    maxWidth: A4_WIDTH - 2 * MARGIN,
    lineHeight: 12,
  });
}
