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
  const paidCents = invoice.paymentReceivedAmount ?? 0;
  const outstandingCents = invoice.amountTotal - paidCents;
  const canMarkSent = canSend && invoice.status === 'approved';
  const canRecordPayment =
    canSend &&
    ['approved', 'sent', 'partial', 'overdue'].includes(invoice.status) &&
    outstandingCents > 0;

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
          {canDeleteDraft && (
            <DeleteDraftInvoiceButton invoiceId={invoice.id} invoiceNumber={invoice.number} />
          )}
        </div>
      </header>

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
    </div>
  );
}
