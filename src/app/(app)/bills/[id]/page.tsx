import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSession } from '@/server/session';
import { prisma } from '@/server/db';
import { hasAnyRole } from '@/server/roles';
import { hasCapability } from '@/server/capabilities';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EXPENSE_CATEGORIES, expenseCategoryLabel } from '@/lib/expense-categories';
import { isHiddenFromAllocationPicker } from '@/lib/project-kind';
import { XeroPushBillButton } from './xero-push-button';
import { DeleteDraftBillButton } from './delete-button';
import { MarkBillPaidButton, ScheduleBillButton } from './lifecycle-buttons';
import { BillClassificationForm } from './classification-form';

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
      attributedTo: { select: { id: true, firstName: true, lastName: true } },
    },
  });
  if (!bill) notFound();

  const canPushToXero = hasAnyRole(session, ['super_admin']);
  const isPushable =
    bill.status === 'approved' || bill.status === 'scheduled_for_payment' || bill.status === 'paid';
  const canDeleteDraft =
    hasCapability(session, 'bill.delete_draft') && bill.status === 'pending_review';
  const canApprove = hasCapability(session, 'bill.approve');
  const canSchedule = canApprove && bill.status === 'approved';
  const canMarkPaid =
    canApprove && (bill.status === 'approved' || bill.status === 'scheduled_for_payment');
  // Admin can re-classify (project / cost type / associated user / cost
  // centre) inline on the bill detail. Same capability that gates
  // approve / push-to-Xero — these are the same "AP owner" set.
  const canEditClassification = canApprove;

  // Fetch picker options for admin — projects (non-archived, sorted
  // with FHB/FHO/FHX OPEX buckets at the top), active people, and the
  // canonical category list. Skip both queries cleanly for non-admin
  // viewers so a Manager seeing a bill detail doesn't pay the cost.
  const [projectsRaw, personsRaw] = await Promise.all([
    canEditClassification
      ? prisma.project.findMany({
          where: { stage: { not: 'archived' } },
          orderBy: { code: 'asc' },
          select: { id: true, code: true, name: true },
        })
      : Promise.resolve([]),
    canEditClassification
      ? prisma.person.findMany({
          where: { inactiveAt: null },
          orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
          select: { id: true, firstName: true, lastName: true },
        })
      : Promise.resolve([]),
  ]);
  // All three *000 catch-alls (FHB000 BD, FHO000 Operations, FHX000
  // Other) sort to the top as initial-allocation targets. Lines can be
  // re-assigned to a more specific code later. See
  // `isHiddenFromAllocationPicker` for the rationale (TT 2026-06-16).
  const visibleProjects = projectsRaw.filter(
    (p) => !isHiddenFromAllocationPicker(p.code),
  );
  const BUCKETS = ['FHB000', 'FHO000', 'FHX000'];
  const bucketProjects = visibleProjects
    .filter((p) => BUCKETS.includes(p.code))
    .sort((a, b) => BUCKETS.indexOf(a.code) - BUCKETS.indexOf(b.code));
  const otherProjects = visibleProjects.filter((p) => !BUCKETS.includes(p.code));
  const projectOptions = [...bucketProjects, ...otherProjects];
  const personOptions = personsRaw.map((p) => ({
    id: p.id,
    firstName: p.firstName,
    lastName: p.lastName,
  }));
  const categoryOptions = [...EXPENSE_CATEGORIES]
    .sort((a, b) => a.label.localeCompare(b.label))
    .map((c) => ({ value: c.value, label: c.label }));

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

      {(canSchedule || canMarkPaid) && (
        <Card>
          <CardHeader>
            <CardTitle>Payment lifecycle</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-2 text-sm">
            {canSchedule && <ScheduleBillButton billId={bill.id} />}
            {canMarkPaid && <MarkBillPaidButton billId={bill.id} />}
            <p className="text-xs text-ink-3">
              Schedule moves the bill into the pay queue; Mark paid closes it out.
              Actual pay-run + ABA export flow lands later.
            </p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Classification</CardTitle>
        </CardHeader>
        <CardContent>
          {canEditClassification ? (
            <BillClassificationForm
              billId={bill.id}
              initial={{
                projectId: bill.projectId,
                projectCode: bill.project?.code ?? null,
                projectName: bill.project?.name ?? null,
                attributedToPersonId: bill.attributedToPersonId,
                attributedToName: bill.attributedTo
                  ? `${bill.attributedTo.firstName} ${bill.attributedTo.lastName}`
                  : null,
                costCentre: bill.costCentre,
                category: bill.category,
                receivedVia: bill.receivedVia,
                attachmentSharepointUrl: bill.attachmentSharepointUrl,
              }}
              projectOptions={projectOptions}
              personOptions={personOptions}
              categoryOptions={categoryOptions}
            />
          ) : (
            <div className="space-y-2 text-sm">
              <Row label="Category">{expenseCategoryLabel(bill.category)}</Row>
              <Row label="Project">
                {bill.project ? (
                  <Link
                    href={`/projects/${bill.project.code}`}
                    className="hover:underline"
                  >
                    <span className="font-mono">{bill.project.code}</span>{' '}
                    <span>{bill.project.name}</span>
                  </Link>
                ) : (
                  <span className="text-ink-3">OPEX</span>
                )}
              </Row>
              <Row label="Associated user">
                {bill.attributedTo ? (
                  <span>
                    {bill.attributedTo.firstName} {bill.attributedTo.lastName}
                  </span>
                ) : (
                  <span className="text-ink-3">—</span>
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
            </div>
          )}
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
