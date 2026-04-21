import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { PayRunStatus, PayRunType } from '@prisma/client';
import { getSession } from '@/server/session';
import { hasCapability } from '@/server/capabilities';
import { getPayRun } from '@/server/payruns';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  ApproveButton,
  DeleteDraftButton,
  MarkAbaGeneratedButton,
  MarkPaidButton,
} from './lifecycle';

function formatMoney(cents: number): string {
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

const STATUS_VARIANT: Record<PayRunStatus, 'outline' | 'amber' | 'blue' | 'green'> = {
  draft: 'outline',
  approved: 'amber',
  aba_generated: 'blue',
  uploaded_to_paydotcomau: 'blue',
  paid: 'green',
  reconciled: 'green',
};

const TYPE_LABEL: Record<PayRunType, string> = {
  payroll: 'Payroll',
  super: 'Super',
  contractor_ap: 'Contractor AP',
  supplier_ap: 'Supplier AP',
  mixed: 'Mixed',
};

export default async function PayRunDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const session = await getSession();
  if (!hasCapability(session, 'payrun.create')) notFound();

  const payRun = await getPayRun(params.id);
  if (!payRun) notFound();

  const canApprove = hasCapability(session, 'payrun.approve');
  const showApprove = canApprove && payRun.status === 'draft';
  const showDelete = canApprove && payRun.status === 'draft';
  const showAba = canApprove && payRun.status === 'approved';
  const showMarkAbaGenerated = canApprove && payRun.status === 'approved';
  const showMarkPaid =
    canApprove &&
    (payRun.status === 'approved' ||
      payRun.status === 'aba_generated' ||
      payRun.status === 'uploaded_to_paydotcomau');

  return (
    <div className="space-y-6">
      <div className="text-sm">
        <Link href="/payroll" className="text-ink-3 hover:text-ink">
          ← Back to Pay runs
        </Link>
      </div>

      <header className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="capitalize">
              {TYPE_LABEL[payRun.type]}
            </Badge>
            <h1 className="text-xl font-semibold text-ink">
              {payRun.periodStart.toLocaleDateString('en-AU')} –{' '}
              {payRun.periodEnd.toLocaleDateString('en-AU')}
            </h1>
            <Badge variant={STATUS_VARIANT[payRun.status]} className="capitalize">
              {payRun.status.replace(/_/g, ' ')}
            </Badge>
          </div>
          <p className="mt-1 text-sm text-ink-3">
            Created {payRun.createdAt.toLocaleDateString('en-AU')} · {payRun.lines.length}{' '}
            {payRun.lines.length === 1 ? 'line' : 'lines'} ·{' '}
            <span className="font-mono text-xs">{payRun.id}</span>
          </p>
        </div>
        <div className="text-right">
          <div className="text-[11px] uppercase tracking-wide text-ink-3">Total</div>
          <div className="text-2xl font-semibold tabular-nums text-ink">
            {formatMoney(payRun.totalCents)}
          </div>
        </div>
      </header>

      {(showApprove ||
        showAba ||
        showMarkAbaGenerated ||
        showMarkPaid ||
        showDelete ||
        payRun.approvedAt) && (
        <Card>
          <CardHeader>
            <CardTitle>Lifecycle</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-3 text-sm">
            {payRun.approvedAt && payRun.approvedBy && (
              <span className="flex items-center gap-2 text-ink-3">
                <Avatar className="h-5 w-5">
                  <AvatarFallback className="text-[9px]">
                    {payRun.approvedBy.initials}
                  </AvatarFallback>
                </Avatar>
                Approved by {payRun.approvedBy.firstName} {payRun.approvedBy.lastName} on{' '}
                {payRun.approvedAt.toLocaleDateString('en-AU')}
              </span>
            )}
            {showApprove && <ApproveButton payRunId={payRun.id} />}
            {showAba && (
              <a
                href={`/api/payroll/${payRun.id}/aba`}
                className="inline-flex h-9 items-center rounded-md bg-brand px-4 text-sm font-medium text-brand-ink hover:opacity-90"
              >
                Download ABA file
              </a>
            )}
            {showMarkAbaGenerated && <MarkAbaGeneratedButton payRunId={payRun.id} />}
            {showMarkPaid && <MarkPaidButton payRunId={payRun.id} />}
            {showDelete && <DeleteDraftButton payRunId={payRun.id} />}
          </CardContent>
        </Card>
      )}

      <Card className="p-0">
        <CardHeader>
          <CardTitle>Lines ({payRun.lines.length})</CardTitle>
        </CardHeader>
        {payRun.lines.length === 0 ? (
          <CardContent>
            <p className="text-sm text-ink-3">No lines on this pay-run.</p>
          </CardContent>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Payee</TableHead>
                <TableHead>Bill / reference</TableHead>
                <TableHead>BSB</TableHead>
                <TableHead>Account</TableHead>
                <TableHead className="text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {payRun.lines.map((l) => (
                <TableRow key={l.id}>
                  <TableCell className="text-sm text-ink">
                    {l.person ? (
                      <Link
                        href={`/directory/people/${l.person.id}`}
                        className="flex items-center gap-1.5 hover:underline"
                      >
                        <Avatar className="h-5 w-5">
                          <AvatarFallback className="text-[9px]">
                            {l.person.initials}
                          </AvatarFallback>
                        </Avatar>
                        <span>
                          {l.person.firstName} {l.person.lastName}
                        </span>
                      </Link>
                    ) : l.bill ? (
                      <span>{l.bill.supplierName}</span>
                    ) : (
                      <span className="text-ink-3">—</span>
                    )}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-ink-2">
                    {l.bill ? (
                      <Link href={`/bills/${l.bill.id}`} className="hover:underline">
                        {l.bill.supplierInvoiceNumber ?? l.reference}
                      </Link>
                    ) : (
                      l.reference
                    )}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-ink-3">{l.bsb}</TableCell>
                  <TableCell className="font-mono text-xs text-ink-3">
                    {l.acc.replace(/^0+/, '')}
                  </TableCell>
                  <TableCell className="text-right font-semibold tabular-nums text-ink">
                    {formatMoney(l.amountCents)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      {payRun.status === 'draft' && (
        <p className="text-xs text-ink-3">
          Next step: approve this pay-run to lock it in. Once approved the ABA file button
          appears — download the file and upload it to CBA (or pay.com.au once that
          integration ships).
        </p>
      )}
      {payRun.status === 'approved' && (
        <p className="text-xs text-ink-3">
          Download the ABA file and upload to CBA. Then mark it ABA-generated here to track
          handover cleanly, and Mark paid once CBA confirms settlement.
        </p>
      )}
    </div>
  );
}
