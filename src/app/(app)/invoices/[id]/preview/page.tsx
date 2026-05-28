import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSession } from '@/server/session';
import { prisma } from '@/server/db';
import { hasCapability } from '@/server/capabilities';
import { InvoicePreviewEditor } from './editor';
import { PrintButtonClient } from './print-button';

/**
 * Invoice preview & PDF — populates the Foundry Health Tax Invoice
 * template (FY26 letterhead) with the invoice's data and renders it in
 * a print-styled card. Editable template fields (PO ref, "FOR" subject,
 * Attention name, primary line description) sit in a sidebar; saving
 * persists and the preview re-renders.
 *
 * "Download as PDF" triggers `window.print()` so the user can use the
 * browser's native PDF export, which preserves the print stylesheet
 * (no app chrome, A4 page, real fonts). Saving directly to SharePoint
 * is a follow-up — the user can drag the downloaded PDF into the
 * project's admin folder until then.
 */
export default async function InvoicePreviewPage({
  params,
}: {
  params: { id: string };
}) {
  const session = await getSession();
  if (!session) notFound();

  const invoice = await prisma.invoice.findUnique({
    where: { id: params.id },
    include: {
      lineItems: { orderBy: { id: 'asc' } },
      client: {
        select: {
          id: true,
          legalName: true,
          tradingName: true,
          abn: true,
          acn: true,
          contactName: true,
          billingAddress: true,
          streetAddress: true,
          suburb: true,
          state: true,
          postcode: true,
          country: true,
        },
      },
      project: { select: { id: true, code: true, name: true } },
    },
  });
  if (!invoice) notFound();

  const canEdit =
    hasCapability(session, 'invoice.create') &&
    (invoice.status === 'draft' || invoice.status === 'pending_approval');

  // Compose client address from structured fields, falling back to the
  // legacy single-line `billingAddress` for migrated rows.
  const clientAddressLines: string[] = [];
  if (invoice.client.streetAddress) {
    clientAddressLines.push(invoice.client.streetAddress);
    const cityLine = [
      invoice.client.suburb,
      invoice.client.state,
      invoice.client.postcode,
    ]
      .filter(Boolean)
      .join(' ');
    if (cityLine) clientAddressLines.push(cityLine);
    if (invoice.client.country && invoice.client.country !== 'AU') {
      clientAddressLines.push(invoice.client.country);
    }
  } else if (invoice.client.billingAddress) {
    clientAddressLines.push(invoice.client.billingAddress);
  }

  // Render-time defaults that the editor can override.
  const attentionTo =
    invoice.attentionTo?.trim() ||
    invoice.client.contactName ||
    null;
  const forSubject = invoice.forSubject?.trim() || 'Advisory services';

  const subtotal = invoice.amountExGst;
  const gst = invoice.gst;
  const total = invoice.amountTotal;

  return (
    <div className="space-y-4 print:space-y-0">
      {/* ── Toolbar (hidden in print) ─────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <div className="text-sm">
          <Link
            href={`/invoices/${invoice.id}`}
            className="text-ink-3 hover:text-ink"
          >
            ← Back to invoice
          </Link>
        </div>
        <PrintButtonClient
          invoiceId={invoice.id}
          alreadyFinalised={invoice.taxInvoiceFinalisedAt !== null}
        />
      </div>

      {/* Approval / finalisation banner — surfaces ONLY when an
           approved invoice hasn't been issued yet (download not
           recorded) so partners know which approved invoices are
           waiting on them. */}
      {invoice.status === 'approved' &&
        !invoice.taxInvoiceFinalisedAt && (
          <div className="rounded-md border border-status-amber bg-status-amber-soft px-4 py-3 text-sm text-status-amber print:hidden">
            <strong>Awaiting finalisation</strong> — invoice approved but
            the tax-invoice PDF hasn&apos;t been generated yet. Click{' '}
            <span className="font-medium">Finalise &amp; download PDF</span>{' '}
            to issue.
          </div>
        )}
      {invoice.taxInvoiceFinalisedAt && (
        <div className="rounded-md border border-status-green/40 bg-status-green-soft/30 px-4 py-2 text-xs text-status-green print:hidden">
          Tax invoice finalised on{' '}
          {invoice.taxInvoiceFinalisedAt.toLocaleDateString('en-AU', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
          })}{' '}
          at{' '}
          {invoice.taxInvoiceFinalisedAt.toLocaleTimeString('en-AU', {
            hour: '2-digit',
            minute: '2-digit',
          })}
          . Re-downloading is fine — the original timestamp is preserved.
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 print:block lg:grid-cols-[minmax(0,1fr)_320px]">
        {/* ── Print-styled invoice ─────────────────────────────── */}
        <div className="invoice-print-area mx-auto w-full max-w-[210mm] rounded-md border border-line bg-white p-10 text-[13px] leading-relaxed text-ink shadow-sm print:max-w-none print:border-0 print:p-0 print:shadow-none">
          <div className="flex items-start justify-between gap-6">
            <div>
              <div className="text-2xl font-semibold tracking-tight text-ink">
                Tax Invoice
              </div>
            </div>
            {/* Foundry Health lockup — sits in the corner of every
                generated invoice PDF. Kept as a simple <img> so the
                browser's "Save as PDF" reliably embeds it. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/brand/fh-lockup-black.png"
              alt="Foundry Health"
              className="h-7 w-auto select-none"
            />
          </div>

          <div className="mt-6 grid grid-cols-2 gap-6">
            <section>
              <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-ink-3">
                From
              </h3>
              <div className="font-semibold text-ink">Foundry Health PTY LTD</div>
              <div className="text-[12px] text-ink-2">ABN 85 644 198 461</div>
              <div className="text-[12px] text-ink-2">
                Level 21, 8 Chifley Square
              </div>
              <div className="text-[12px] text-ink-2">Sydney, NSW, 2000</div>
              <div className="text-[12px] text-ink-2">Australia</div>
            </section>
            <section className="text-right">
              <table className="ml-auto text-[12px]">
                <tbody>
                  <tr>
                    <td className="pr-3 text-ink-3">Invoice #</td>
                    <td className="font-mono font-semibold text-ink">
                      {invoice.number}
                    </td>
                  </tr>
                  <tr>
                    <td className="pr-3 text-ink-3">Date</td>
                    <td className="tabular-nums text-ink">
                      {invoice.issueDate.toLocaleDateString('en-AU')}
                    </td>
                  </tr>
                  <tr>
                    <td className="pr-3 text-ink-3">Due</td>
                    <td className="tabular-nums text-ink">
                      {invoice.dueDate.toLocaleDateString('en-AU')}
                    </td>
                  </tr>
                  {invoice.purchaseOrderRef && (
                    <tr>
                      <td className="pr-3 text-ink-3">PO reference</td>
                      <td className="text-ink">
                        {invoice.purchaseOrderRef}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </section>
          </div>

          <div className="mt-6 grid grid-cols-2 gap-6">
            <section>
              <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-ink-3">
                To
              </h3>
              {attentionTo && (
                <div className="text-[12px] text-ink-2">
                  Attention: {attentionTo}
                </div>
              )}
              <div className="font-semibold text-ink">
                {invoice.client.legalName}
              </div>
              {invoice.client.abn && (
                <div className="text-[12px] text-ink-2">
                  ABN {invoice.client.abn}
                </div>
              )}
              {invoice.client.acn && (
                <div className="text-[12px] text-ink-2">
                  ACN {invoice.client.acn}
                </div>
              )}
              {clientAddressLines.map((l, i) => (
                <div key={i} className="text-[12px] text-ink-2">
                  {l}
                </div>
              ))}
            </section>
            <section>
              <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-ink-3">
                For
              </h3>
              <div className="text-[12px] text-ink-2">{forSubject}</div>
              {invoice.project && (
                <div className="mt-1 text-[11px] text-ink-3">
                  Project{' '}
                  <span className="font-mono">{invoice.project.code}</span>{' '}
                  · {invoice.project.name}
                </div>
              )}
            </section>
          </div>

          {/* ── Line items ─────────────────────────────────────── */}
          <table className="mt-8 w-full border-collapse">
            <thead>
              <tr className="border-y border-ink">
                <th className="py-2 pr-3 text-left text-[11px] font-semibold uppercase tracking-wide text-ink">
                  Description
                </th>
                <th className="py-2 pl-3 text-right text-[11px] font-semibold uppercase tracking-wide text-ink">
                  Amount
                </th>
              </tr>
            </thead>
            <tbody>
              {invoice.lineItems.map((l) => (
                <tr key={l.id} className="border-b border-line align-top">
                  <td className="py-3 pr-3">
                    <div className="whitespace-pre-wrap text-[12.5px] text-ink">
                      {l.label}
                    </div>
                    {l.hours !== null && l.rate !== null && (
                      <div className="mt-0.5 text-[11px] text-ink-3">
                        {Number(l.hours).toFixed(2)} hrs ×{' '}
                        {(l.rate / 100).toLocaleString('en-AU', {
                          style: 'currency',
                          currency: 'AUD',
                          maximumFractionDigits: 2,
                        })}
                      </div>
                    )}
                  </td>
                  <td className="py-3 pl-3 text-right tabular-nums text-ink">
                    {(l.amount / 100).toLocaleString('en-AU', {
                      style: 'currency',
                      currency: 'AUD',
                      maximumFractionDigits: 2,
                    })}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td className="py-2 pr-3 text-right text-[12px] text-ink-3">
                  Subtotal
                </td>
                <td className="py-2 pl-3 text-right tabular-nums text-ink">
                  {(subtotal / 100).toLocaleString('en-AU', {
                    style: 'currency',
                    currency: 'AUD',
                    maximumFractionDigits: 2,
                  })}{' '}
                  AUD
                </td>
              </tr>
              <tr>
                <td className="py-1 pr-3 text-right text-[12px] text-ink-3">
                  GST (10%)
                </td>
                <td className="py-1 pl-3 text-right tabular-nums text-ink">
                  {(gst / 100).toLocaleString('en-AU', {
                    style: 'currency',
                    currency: 'AUD',
                    maximumFractionDigits: 2,
                  })}{' '}
                  AUD
                </td>
              </tr>
              <tr className="border-t border-ink">
                <td className="py-2 pr-3 text-right text-[13px] font-semibold uppercase tracking-wide text-ink">
                  Total (incl. GST)
                </td>
                <td className="py-2 pl-3 text-right text-[14px] font-semibold tabular-nums text-ink">
                  {(total / 100).toLocaleString('en-AU', {
                    style: 'currency',
                    currency: 'AUD',
                    maximumFractionDigits: 2,
                  })}{' '}
                  AUD
                </td>
              </tr>
            </tfoot>
          </table>

          <div className="mt-3 text-[11px] italic text-ink-3">
            All amounts in AUD unless stated otherwise.
          </div>

          {/* ── Bank details ──────────────────────────────────── */}
          <div className="mt-8 rounded border border-line bg-surface-subtle/50 p-4 text-[11.5px] text-ink-2">
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-ink-3">
              Please make payment to
            </div>
            <div className="grid grid-cols-2 gap-x-6 gap-y-0.5">
              <div>
                <span className="text-ink-3">Correspondent Bank:</span>{' '}
                Commonwealth Bank
              </div>
              <div>
                <span className="text-ink-3">Account Name:</span>{' '}
                Foundry Health PTY LTD
              </div>
              <div>
                <span className="text-ink-3">Account Number:</span> 1140 0622
              </div>
              <div>
                <span className="text-ink-3">BSB:</span> 062 230
              </div>
              <div>
                <span className="text-ink-3">SWIFT (international):</span>{' '}
                CTBAAU2S
              </div>
              <div>
                <span className="text-ink-3">Reference:</span> {invoice.number}
              </div>
            </div>
            <div className="mt-2 text-[10px] text-ink-3">
              Australian banks do not use IBAN — use SWIFT + Account Number for
              international transfers.
            </div>
          </div>

          <div className="mt-6 text-[11px] text-ink-3">
            Please forward remittance receipts to{' '}
            <span className="text-ink">finance@foundry.health</span> cc{' '}
            <span className="text-ink">jas@foundry.health</span>.
          </div>
          <div className="mt-1 text-[11px] text-ink-3">
            Questions concerning this invoice — contact{' '}
            <span className="text-ink">Trung Ton</span> (Partner) ·{' '}
            <span className="text-ink">trung@foundry.health</span>
          </div>
        </div>

        {/* ── Editable template-only fields (hidden in print) ──── */}
        <aside className="space-y-3 print:hidden">
          <InvoicePreviewEditor
            invoiceId={invoice.id}
            canEdit={canEdit}
            statusLabel={invoice.status}
            initial={{
              purchaseOrderRef: invoice.purchaseOrderRef,
              forSubject: invoice.forSubject,
              attentionTo: invoice.attentionTo,
              primaryLineLabel:
                invoice.lineItems[0]?.label ?? '',
            }}
            primaryLineExists={invoice.lineItems.length > 0}
          />
        </aside>
      </div>

      {/* Print stylesheet — isolate the invoice subtree from the rest
           of the DOM. Targeting individual shell classes is fragile
           because Next/Tailwind shells vary, so we hide everything via
           `visibility: hidden` and then re-show only `.invoice-print-area`
           and its descendants. The print area is reanchored to the top-
           left of the page so it actually fills the A4 sheet. */}
      <style>{`
        @media print {
          html, body { background: white !important; margin: 0 !important; }
          body * { visibility: hidden !important; }
          .invoice-print-area, .invoice-print-area * { visibility: visible !important; }
          .invoice-print-area {
            position: absolute !important;
            inset: 0 !important;
            margin: 0 !important;
            padding: 18mm 16mm !important;
            box-shadow: none !important;
            border: none !important;
            background: white !important;
            max-width: none !important;
            width: 100% !important;
          }
          @page { size: A4; margin: 0; }
        }
      `}</style>
    </div>
  );
}
