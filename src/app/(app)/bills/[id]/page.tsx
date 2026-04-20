import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSession } from '@/server/session';
import { prisma } from '@/server/db';
import { hasAnyRole } from '@/server/roles';
import { hasCapability } from '@/server/capabilities';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { XeroPushBillButton } from './xero-push-button';
import { DeleteDraftBillButton } from './delete-button';

function formatMoney(cents: number): string {
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

const STATUS_VARIANT: Record<string, 'outline' | 'amber' | 'green' | 'blue' | 'red'> = {
  pending_review: 'amber',
  approved: 'blue',
  rejected: 'red',
  scheduled_for_payment: 'blue',
  paid: 'green',
};

export default async function BillDetailPage({ params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) notFound();

  const bill = await prisma.bill.findUnique({
    where: { id: params.id },
    include: {
      project: { select: { id: true, code: true, name: true } },
    },
  });
  if (!bill) notFound();

  const canPushToXero = hasAnyRole(session, ['super_admin']);
  const isPushable =
    bill.status === 'approved' || bill.status === 'scheduled_for_payment' || bill.status === 'paid';
  const canDeleteDraft =
    hasCapability(session, 'bill.delete_draft') && bill.status === 'pending_review';

  return (
    <div className="space-y-6">
      <div className="text-sm">
        <Link href="/bills" className="text-ink-3 hover:text-ink">
          ← Back to Bills
        </Link>
      </div>

      <header className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold text-ink">{bill.supplierName}</h1>
            <Badge variant={STATUS_VARIANT[bill.status] ?? 'outline'} className="capitalize">
              {bill.status.replace(/_/g, ' ')}
            </Badge>
          </div>
          {bill.supplierInvoiceNumber && (
            <p className="mt-1 text-sm text-ink-3">
              Supplier ref: <span className="font-mono">{bill.supplierInvoiceNumber}</span>
            </p>
          )}
        </div>
        <div className="flex flex-col items-end gap-2 text-sm">
          <div className="text-right">
            <div className="text-ink-3">Amount due</div>
            <div className="text-2xl font-semibold tabular-nums text-ink">
              {formatMoney(bill.amountTotal)}
            </div>
            <div className="text-xs text-ink-3">incl. {formatMoney(bill.gst)} GST</div>
          </div>
          {canDeleteDraft && (
            <DeleteDraftBillButton
              billId={bill.id}
              supplierName={bill.supplierName ?? 'supplier'}
            />
          )}
        </div>
      </header>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Issued</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-ink">
            {bill.issueDate.toLocaleDateString('en-AU')}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Due</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-ink">
            {bill.dueDate.toLocaleDateString('en-AU')}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Xero</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col items-start gap-2 text-sm text-ink-3">
            {bill.xeroBillId ? (
              <span className="font-mono text-xs">{bill.xeroBillId}</span>
            ) : (
              <span>Not yet pushed.</span>
            )}
            {canPushToXero && isPushable && (
              <XeroPushBillButton billId={bill.id} alreadyPushed={Boolean(bill.xeroBillId)} />
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Classification</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <Row label="Category">{bill.category.replace(/_/g, ' ')}</Row>
          <Row label="Project">
            {bill.project ? (
              <Link href={`/projects/${bill.project.code}`} className="hover:underline">
                <span className="font-mono">{bill.project.code}</span>{' '}
                <span>{bill.project.name}</span>
              </Link>
            ) : (
              <span className="text-ink-3">OPEX</span>
            )}
          </Row>
          <Row label="Cost centre">{bill.costCentre ?? '—'}</Row>
          <Row label="Received via">{bill.receivedVia}</Row>
          <Row label="Attachment">
            {bill.attachmentSharepointUrl ? (
              <a
                href={bill.attachmentSharepointUrl}
                target="_blank"
                rel="noreferrer"
                className="text-brand hover:underline"
              >
                Open in SharePoint →
              </a>
            ) : (
              <span className="text-ink-3">—</span>
            )}
          </Row>
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[140px_1fr] gap-2 py-1">
      <div className="text-ink-3">{label}</div>
      <div className="text-ink">{children}</div>
    </div>
  );
}
