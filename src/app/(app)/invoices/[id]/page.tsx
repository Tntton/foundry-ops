import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSession } from '@/server/session';
import { prisma } from '@/server/db';
import { hasAnyRole } from '@/server/roles';
import { hasCapability } from '@/server/capabilities';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { XeroPushInvoiceButton } from './xero-push-button';
import { DeleteDraftInvoiceButton } from './delete-button';
import { MarkSentButton, RecordPaymentForm } from './status-forms';
import { SubmitForApprovalButton, RecallFromApprovalButton } from './approval-forms';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

function formatMoney(cents: number): string {
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

const STATUS_VARIANT: Record<string, 'outline' | 'amber' | 'green' | 'blue' | 'red'> = {
  draft: 'outline',
  pending_approval: 'amber',
  approved: 'blue',
  sent: 'blue',
  partial: 'amber',
  paid: 'green',
  overdue: 'red',
  written_off: 'outline',
};

export default async function InvoiceDetailPage({ params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) notFound();

  const invoice = await prisma.invoice.findUnique({
    where: { id: params.id },
    include: {
      lineItems: true,
      client: { select: { id: true, code: true, legalName: true } },
      project: { select: { id: true, code: true, name: true } },
    },
  });
  if (!invoice) notFound();

  const canPushToXero = hasAnyRole(session, ['super_admin', 'admin', 'partner']);
  const canDeleteDraft =
    hasCapability(session, 'invoice.delete_draft') &&
    (invoice.status === 'draft' || invoice.status === 'pending_approval');
  const canSend = hasCapability(session, 'invoice.send');
  const canCreate = hasCapability(session, 'invoice.create');
  const paidCents = invoice.paymentReceivedAmount ?? 0;
  const outstandingCents = invoice.amountTotal - paidCents;
  const canMarkSent = canSend && invoice.status === 'approved';
  const canRecordPayment =
    canSend &&
    ['approved', 'sent', 'partial', 'overdue'].includes(invoice.status) &&
    outstandingCents > 0;

  // Pending approval row + any contractor bills auto-generated from this invoice.
  // Also pull every Bill / Expense that was forwarded onto this invoice as a
  // pass-through line — drives the "Pass-through receipts" section + the
  // bundled-PDF download button.
  const [
    pendingApproval,
    autoBills,
    contractorTimesheetEntries,
    rebilledBills,
    rebilledExpenses,
  ] = await Promise.all([
    invoice.status === 'pending_approval'
      ? prisma.approval.findFirst({
          where: { subjectType: 'invoice', subjectId: invoice.id, status: 'pending' },
          select: { id: true, requiredRole: true, createdAt: true },
        })
      : Promise.resolve(null),
    prisma.bill.findMany({
      where: {
        receivedVia: 'auto_from_approved_invoice',
        // Cheap join via supplierPersonId set + projectId match wouldn't be precise;
        // use audit events instead (sourceInvoiceId is stamped there).
      },
      select: {
        id: true,
        supplierName: true,
        amountTotal: true,
        gst: true,
        status: true,
        projectId: true,
        issueDate: true,
        dueDate: true,
        abaBatchId: true,
        supplierPersonId: true,
      },
    }),
    prisma.timesheetEntry.findMany({
      where: {
        billedInvoiceId: invoice.id,
        person: { employment: 'contractor' },
      },
      select: {
        personId: true,
        person: { select: { firstName: true, lastName: true } },
        projectId: true,
      },
    }),
    prisma.bill.findMany({
      where: { rebilledOnInvoiceId: invoice.id },
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
      where: { rebilledOnInvoiceId: invoice.id },
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
  const rebilledCount = rebilledBills.length + rebilledExpenses.length;

  // Filter the auto-bill list to ones that belong to this invoice. We don't
  // store sourceInvoiceId on Bill (audit-only), so we cross-check via timesheet
  // links: any contractor on this invoice gets matched to bills with the same
  // (personId, projectId).
  const expectedKeys = new Set(
    contractorTimesheetEntries.map((e) => `${e.personId}:${e.projectId}`),
  );
  const linkedAutoBills = autoBills.filter(
    (b) =>
      b.supplierPersonId !== null &&
      expectedKeys.has(`${b.supplierPersonId}:${b.projectId}`),
  );

  return (
    <div className="space-y-6">
      <div className="text-sm">
        <Link href="/invoices" className="text-ink-3 hover:text-ink">
          ← Back to Invoices
        </Link>
      </div>

      <header className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="font-mono">
              {invoice.number}
            </Badge>
            <h1 className="text-xl font-semibold text-ink">{invoice.client.legalName}</h1>
            <Badge
              variant={STATUS_VARIANT[invoice.status] ?? 'outline'}
              className="capitalize"
            >
              {invoice.status.replace('_', ' ')}
            </Badge>
          </div>
          <p className="mt-1 text-sm text-ink-3">
            Project:{' '}
            <Link href={`/projects/${invoice.project.code}`} className="hover:underline">
              {invoice.project.code} {invoice.project.name}
            </Link>
          </p>
        </div>
        <div className="flex flex-col items-end gap-2 text-sm">
          <div className="text-right">
            <div className="text-ink-3">Amount due</div>
            <div className="text-2xl font-semibold tabular-nums text-ink">
              {formatMoney(invoice.amountTotal)}
            </div>
          </div>
          <Link
            href={`/invoices/${invoice.id}/preview`}
            className={`rounded-md px-3 py-1.5 text-xs ${
              invoice.status === 'approved' && !invoice.taxInvoiceFinalisedAt
                ? 'bg-status-amber text-white hover:bg-status-amber/90'
                : 'border border-line bg-card text-ink hover:bg-surface-hover'
            }`}
          >
            {invoice.status === 'approved' && !invoice.taxInvoiceFinalisedAt
              ? 'Finalise & download PDF →'
              : 'Preview & PDF →'}
          </Link>
          {rebilledCount > 0 && (
            <a
              href={`/api/invoices/${invoice.id}/pdf-with-receipts`}
              className="rounded-md border border-brand bg-brand/10 px-3 py-1.5 text-xs text-brand hover:bg-brand/20"
            >
              Download with {rebilledCount} receipt
              {rebilledCount === 1 ? '' : 's'} →
            </a>
          )}
          {canCreate && invoice.status === 'draft' && (
            <SubmitForApprovalButton invoiceId={invoice.id} />
          )}
          {canCreate && invoice.status === 'pending_approval' && (
            <RecallFromApprovalButton invoiceId={invoice.id} />
          )}
          {canDeleteDraft && (
            <DeleteDraftInvoiceButton invoiceId={invoice.id} invoiceNumber={invoice.number} />
          )}
        </div>
      </header>

      {invoice.status === 'pending_approval' && pendingApproval && (
        <div className="rounded-md border border-status-amber bg-status-amber-soft px-3 py-2 text-sm text-status-amber">
          Awaiting{' '}
          <span className="font-medium capitalize">
            {pendingApproval.requiredRole.replace('_', ' ')}
          </span>{' '}
          approval — submitted{' '}
          {pendingApproval.createdAt.toLocaleDateString('en-AU')}.{' '}
          <Link href="/approvals" className="underline">
            Approval queue →
          </Link>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Issued</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-ink">
            {invoice.issueDate.toLocaleDateString('en-AU')}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Due</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-ink">
            {invoice.dueDate.toLocaleDateString('en-AU')}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Xero</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col items-start gap-2 text-sm text-ink-3">
            {invoice.xeroInvoiceId ? (
              <span className="font-mono text-xs">{invoice.xeroInvoiceId}</span>
            ) : (
              <span>Not yet pushed.</span>
            )}
            {canPushToXero && invoice.status !== 'draft' && invoice.status !== 'pending_approval' && (
              <XeroPushInvoiceButton
                invoiceId={invoice.id}
                alreadyPushed={Boolean(invoice.xeroInvoiceId)}
              />
            )}
          </CardContent>
        </Card>
      </div>

      {(canMarkSent || canRecordPayment || paidCents > 0) && (
        <Card>
          <CardHeader>
            <CardTitle>Lifecycle</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="grid grid-cols-[140px_1fr] gap-2">
              <div className="text-ink-3">Sent</div>
              <div className="text-ink">
                {invoice.sentAt
                  ? invoice.sentAt.toLocaleDateString('en-AU')
                  : canMarkSent
                    ? <MarkSentButton invoiceId={invoice.id} />
                    : <span className="text-ink-3">—</span>}
              </div>
              <div className="text-ink-3">Received</div>
              <div className="text-ink">
                {formatMoney(paidCents)}{' '}
                <span className="text-xs text-ink-3">
                  ({formatMoney(outstandingCents)} outstanding)
                </span>
                {invoice.paidAt && (
                  <span className="ml-2 text-xs text-ink-3">
                    · paid in full {invoice.paidAt.toLocaleDateString('en-AU')}
                  </span>
                )}
              </div>
            </div>
            {canRecordPayment && (
              <div>
                <RecordPaymentForm
                  invoiceId={invoice.id}
                  outstandingDollars={outstandingCents / 100}
                />
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Line</TableHead>
              <TableHead className="text-right">Amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {invoice.lineItems.map((l) => (
              <TableRow key={l.id}>
                <TableCell className="text-ink">{l.label}</TableCell>
                <TableCell className="text-right tabular-nums text-ink-2">
                  {formatMoney(l.amount)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <div className="ml-auto grid max-w-xs grid-cols-2 gap-y-1 text-sm">
        <span className="text-ink-3">Subtotal</span>
        <span className="text-right tabular-nums text-ink-2">
          {formatMoney(invoice.amountExGst)}
        </span>
        <span className="text-ink-3">GST (10%)</span>
        <span className="text-right tabular-nums text-ink-2">{formatMoney(invoice.gst)}</span>
        <span className="text-base font-semibold text-ink">Total</span>
        <span className="text-right text-base font-semibold tabular-nums text-ink">
          {formatMoney(invoice.amountTotal)}
        </span>
      </div>

      {rebilledCount > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>
              Pass-through receipts ·{' '}
              <span className="text-sm font-normal text-ink-3">
                attached to the bundled PDF
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p className="mb-1 text-xs text-ink-3">
              Vendor invoices + staff receipts forwarded onto this
              invoice as pass-through lines. Each appears as an
              appendix page in the &quot;Download with receipts&quot;
              PDF — clients see the source documentation alongside
              the headline charge.
            </p>
            <ul className="space-y-1">
              {rebilledBills.map((b) => (
                <li
                  key={b.id}
                  className="flex flex-wrap items-center gap-2 rounded-md border border-line bg-surface-subtle/40 px-2 py-1.5 text-xs"
                >
                  <Badge variant="amber">bill</Badge>
                  <Link
                    href={`/bills/${b.id}`}
                    className="font-medium text-ink hover:underline"
                  >
                    {b.supplierName ?? 'Vendor'}
                  </Link>
                  {b.supplierInvoiceNumber && (
                    <span className="font-mono text-[10px] text-ink-3">
                      {b.supplierInvoiceNumber}
                    </span>
                  )}
                  <span className="text-ink-3">
                    {b.issueDate.toLocaleDateString('en-AU')}
                  </span>
                  <span className="ml-auto tabular-nums text-ink">
                    {formatMoney(b.amountTotal)}
                  </span>
                  <span
                    className={`rounded-full px-1.5 py-0.5 text-[9px] uppercase tracking-wide ${
                      b.attachmentSharepointUrl
                        ? 'bg-status-green-soft text-status-green'
                        : 'bg-status-amber-soft text-status-amber'
                    }`}
                  >
                    {b.attachmentSharepointUrl ? '✓ receipt' : '⚠ no file'}
                  </span>
                </li>
              ))}
              {rebilledExpenses.map((e) => (
                <li
                  key={e.id}
                  className="flex flex-wrap items-center gap-2 rounded-md border border-line bg-surface-subtle/40 px-2 py-1.5 text-xs"
                >
                  <Badge variant="blue">expense</Badge>
                  <Link
                    href={`/expenses/${e.id}`}
                    className="font-medium text-ink hover:underline"
                  >
                    {e.vendor ?? e.description ?? 'Expense'}
                  </Link>
                  <span className="text-ink-3">
                    {e.person.firstName} {e.person.lastName} ·{' '}
                    {e.date.toLocaleDateString('en-AU')}
                  </span>
                  <span className="ml-auto tabular-nums text-ink">
                    {formatMoney(e.amount)}
                  </span>
                  <span
                    className={`rounded-full px-1.5 py-0.5 text-[9px] uppercase tracking-wide ${
                      e.receiptSharepointUrl
                        ? 'bg-status-green-soft text-status-green'
                        : 'bg-status-amber-soft text-status-amber'
                    }`}
                  >
                    {e.receiptSharepointUrl ? '✓ receipt' : '⚠ no file'}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {linkedAutoBills.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Contractor bills generated from this invoice</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-3 text-xs text-ink-3">
              Auto-created on invoice approval at each contractor&apos;s cost rate.
              Once each bill is approved in the AP queue and added to a pay run,
              contractors get paid for their hours on this invoice.
            </p>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Contractor</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Pay run</TableHead>
                  <TableHead className="text-right">Total inc GST</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {linkedAutoBills.map((b) => (
                  <TableRow key={b.id}>
                    <TableCell>
                      <Link href={`/bills/${b.id}`} className="hover:underline">
                        {b.supplierName}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          b.status === 'approved'
                            ? 'green'
                            : b.status === 'paid'
                              ? 'blue'
                              : b.status === 'rejected'
                                ? 'red'
                                : 'amber'
                        }
                        className="capitalize"
                      >
                        {b.status.replace(/_/g, ' ')}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs">
                      {b.abaBatchId ? (
                        <Link
                          href={`/payroll/${b.abaBatchId}`}
                          className="text-brand hover:underline"
                        >
                          On pay run →
                        </Link>
                      ) : b.status === 'approved' ? (
                        <Link
                          href="/payroll/new"
                          className="text-brand hover:underline"
                        >
                          Add to next pay run →
                        </Link>
                      ) : (
                        <span className="text-ink-4">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-ink">
                      {formatMoney(b.amountTotal)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
