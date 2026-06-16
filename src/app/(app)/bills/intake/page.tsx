import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSession } from '@/server/session';
import { hasAnyRole } from '@/server/roles';
import { hasCapability } from '@/server/capabilities';
import { prisma } from '@/server/db';
import { listIntakeBills, getIntakeBill } from '@/server/intake';
import { listExpenses } from '@/server/expenses';
import { startOfCurrentAuFy } from '@/lib/au-fy';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { IntakeDropzone } from './dropzone';
import { IntakeFieldEditor } from './intake-form';

function formatMoney(cents: number): string {
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function STATUS_COPY(s: string): { label: string; tone: 'amber' | 'green' | 'red' | 'outline' } {
  if (s === 'reviewing') return { label: 'reviewing', tone: 'amber' };
  if (s === 'auto_categ') return { label: 'auto-categ.', tone: 'green' };
  if (s === 'needs_match') return { label: 'needs match', tone: 'red' };
  return { label: 'unknown', tone: 'outline' };
}

export default async function BillIntakePage({
  searchParams,
}: {
  searchParams: { id?: string; posted?: string };
}) {
  const session = await getSession();
  // Intake is open to anyone who can submit an expense (which is every
  // staff member per capability map). Vendor-bill creation is gated
  // separately via `canCreateBill` and enforced server-side in actions.ts.
  if (!session || !hasCapability(session, 'expense.submit')) notFound();
  const canCreateBill = hasCapability(session, 'bill.create');
  // Only admins / partners see and review the AP bills queue. Staff using
  // the dropzone for personal expenses don't need it.
  const canReviewBills = hasAnyRole(session, ['super_admin', 'admin', 'partner']);

  const queue = canReviewBills ? await listIntakeBills() : [];

  // Pick the active bill: explicit ?id=, then first in queue. Only admins
  // see a queue, so staff dropping personal expenses won't load this.
  const activeId = canReviewBills
    ? (searchParams.id ?? queue[0]?.id ?? null)
    : null;
  const active = activeId ? await getIntakeBill(activeId) : null;
  // Receipt-upload project picker scope:
  //   - every "live" project (kickoff / delivery / closing / standing)
  //     so the firm-overhead buckets (FHO / FHX, both stage = standing),
  //     every active client engagement, and every standing internal
  //     initiative all appear naturally
  //   - PLUS archived projects whose actualEndDate (or endDate
  //     fallback) sits inside the current AU financial year, so
  //     late-arriving receipts can still be coded against a job that
  //     just closed
  //   - excluded: archived rows that closed in a prior FY, and benched
  //     internal projects (paused — not actively accruing costs)
  const fyStart = startOfCurrentAuFy();
  const LIVE_STAGES = ['kickoff', 'delivery', 'closing', 'standing'] as const;
  // Same scope query for both staff and admins — staff now use it to
  // power the inline project-tag picker on the dropzone row (was
  // canReviewBills-only when only the review pane needed it).
  const projects = await prisma.project.findMany({
    where: {
      OR: [
        { stage: { in: [...LIVE_STAGES] } },
        {
          stage: 'archived',
          OR: [
            { actualEndDate: { gte: fyStart } },
            { AND: [{ actualEndDate: null }, { endDate: { gte: fyStart } }] },
          ],
        },
      ],
    },
    orderBy: [{ stage: 'asc' }, { code: 'asc' }],
    select: { id: true, code: true, name: true },
  });

  // Pull the most recent extraction audit row for the active bill so the
  // review pane can call out what the OCR agent did (or failed to do).
  const extractionAudit = activeId
    ? await prisma.auditEvent.findFirst({
        where: {
          entityType: 'bill',
          entityId: activeId,
          action: 'created',
        },
        orderBy: { at: 'desc' },
        select: { entityDelta: true },
      })
    : null;
  type ExtractionMeta = {
    ran?: boolean;
    ok?: boolean;
    reason?: string;
    confidence?: { overall?: number };
  };
  const extractionMeta: ExtractionMeta | null = (() => {
    const delta = extractionAudit?.entityDelta as
      | { created?: { extraction?: ExtractionMeta } }
      | null
      | undefined;
    return delta?.created?.extraction ?? null;
  })();
  const ocrConfigured = Boolean(process.env['ANTHROPIC_API_KEY']);

  const queueIndex = activeId ? queue.findIndex((q) => q.id === activeId) : -1;
  const prevId = queueIndex > 0 ? queue[queueIndex - 1]!.id : null;
  const nextId =
    queueIndex >= 0 && queueIndex < queue.length - 1
      ? queue[queueIndex + 1]!.id
      : null;
  const justPosted = searchParams.posted ?? null;

  // Staff don't see the AP intake queue, but they DO want a quick
  // echo of "did the receipt I just uploaded actually land?". Pull
  // their last 5 expense submissions so the dropzone landing page
  // doubles as a "here's what's in flight for you" panel. Skipped
  // for canReviewBills users — their working surface is the AP
  // queue sidebar on the right.
  const myRecentExpenses = canReviewBills
    ? []
    : await listExpenses(session, 'mine', {}).then((r) => r.slice(0, 5));

  return (
    // Two-col grid only when there's a meaningful right column to
    // show (admin / partner reviewers see the AP queue + "how it
    // works" panel). Staff get the full width — their upload UI
    // doesn't need the right rail and the wasted 320px on a laptop
    // was a real friction point.
    <div
      className={
        canReviewBills
          ? 'grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_320px]'
          : 'space-y-6'
      }
    >
      <div className="space-y-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-xl font-semibold text-ink">Receipt Upload</h1>
              {canReviewBills && (
                <Badge variant="outline" className="text-xs">
                  {queue.length} in AP queue
                </Badge>
              )}
              <Link
                href="/expenses"
                className="rounded-md border border-line bg-card px-2 py-1 font-mono text-[11px] text-ink-3 hover:bg-surface-hover"
              >
                My expenses
              </Link>
              {canReviewBills && (
                <Link
                  href="/bills"
                  className="rounded-md border border-line bg-card px-2 py-1 font-mono text-[11px] text-ink-3 hover:bg-surface-hover"
                >
                  Bills · AP queue
                </Link>
              )}
            </div>
            <p className="mt-1 text-xs text-ink-3">
              {canCreateBill ? (
                <>
                  Drop receipts &amp; vendor invoices.{' '}
                  <strong className="text-ink-2">Personal expense</strong>{' '}
                  reimburses you;{' '}
                  <strong className="text-ink-2">Vendor bill</strong> queues
                  Foundry to pay the supplier. Pick per row before extracting.
                </>
              ) : (
                <>
                  Drop receipts here &mdash; OCR fills the fields and submits
                  them to the expense approval queue. Tag the project on the
                  expense detail page after the row is created.
                </>
              )}
            </p>
          </div>
          {canReviewBills && (
            <div className="flex items-center gap-2 text-xs">
              <Link
                href={prevId ? `/bills/intake?id=${prevId}` : '#'}
                aria-disabled={!prevId}
                className={`rounded-md border border-line px-2 py-1 ${prevId ? 'text-ink-2 hover:bg-surface-hover' : 'cursor-not-allowed text-ink-4'}`}
              >
                ← prev
              </Link>
              <Link
                href={nextId ? `/bills/intake?id=${nextId}` : '#'}
                aria-disabled={!nextId}
                className={`rounded-md border border-line px-2 py-1 ${nextId ? 'text-ink-2 hover:bg-surface-hover' : 'cursor-not-allowed text-ink-4'}`}
              >
                next →
              </Link>
            </div>
          )}
        </header>

        {justPosted && (
          <div className="rounded-md border border-status-green bg-status-green-soft px-3 py-2 text-sm text-status-green">
            {canReviewBills ? (
              <>
                Submitted to the AP approval queue. Once decided, the bill
                posts to its project P&amp;L and queues for the next pay run.
              </>
            ) : (
              <>
                Receipt submitted for reimbursement. You&apos;ll see the
                status update under <Link href="/expenses" className="underline">My expenses</Link>{' '}
                — once approved it lands in the next pay run.
              </>
            )}
          </div>
        )}

        {!ocrConfigured && (
          <div className="rounded-md border border-status-amber bg-status-amber-soft px-3 py-2 text-sm text-status-amber">
            <strong>OCR offline</strong> — set{' '}
            <span className="font-mono text-xs">ANTHROPIC_API_KEY</span> in{' '}
            <span className="font-mono text-xs">.env.local</span> and restart
            the dev server to enable claude-sonnet field extraction. Until
            then uploads land in the queue as empty placeholders for manual
            entry.
          </div>
        )}

        {ocrConfigured && extractionMeta?.ran === true && extractionMeta.ok === false && (
          <div className="rounded-md border border-status-red bg-status-red-soft px-3 py-2 text-sm text-status-red">
            <strong>Extraction failed</strong> for the most recent upload.{' '}
            {extractionMeta.reason ?? 'No reason captured.'} Edit the fields
            below manually, or re-upload a sharper / different format.
          </div>
        )}

        {ocrConfigured && extractionMeta?.ok === true && (
          <div className="rounded-md border border-status-green bg-status-green-soft px-3 py-2 text-sm text-status-green">
            <strong>Extracted</strong> at{' '}
            {extractionMeta.confidence?.overall ?? '?'}% overall confidence.
            Review the fields below and click{' '}
            <span className="font-mono">Approve &amp; post</span> when happy.
          </div>
        )}

        <IntakeDropzone
          defaultKind={canCreateBill ? 'bill' : 'expense'}
          canCreateBill={canCreateBill}
          projectOptions={projects}
        />

        {!canReviewBills ? (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-semibold uppercase tracking-wide text-ink-3">
                Your recent uploads
              </CardTitle>
              <Link
                href="/expenses"
                className="text-xs text-brand hover:underline"
              >
                See all →
              </Link>
            </CardHeader>
            <CardContent className="space-y-1 pt-0">
              {myRecentExpenses.length === 0 ? (
                <p className="px-1 py-6 text-center text-sm text-ink-3">
                  Nothing uploaded yet. Drop a receipt above to start —
                  Sonnet will read the supplier, amount, and date in a
                  few seconds and it lands in your{' '}
                  <Link href="/expenses" className="text-brand hover:underline">
                    expenses list
                  </Link>{' '}
                  for review.
                </p>
              ) : (
                myRecentExpenses.map((e) => {
                  const tone: 'amber' | 'green' | 'red' | 'blue' | 'outline' =
                    e.status === 'submitted'
                      ? 'amber'
                      : e.status === 'approved'
                        ? 'green'
                        : e.status === 'rejected'
                          ? 'red'
                          : e.status === 'reimbursed'
                            ? 'blue'
                            : 'outline';
                  return (
                    <Link
                      key={e.id}
                      href={`/expenses/${e.id}`}
                      className="flex items-center justify-between gap-3 rounded-md border border-line bg-surface-elev px-3 py-2 text-sm hover:bg-surface-hover"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate font-medium text-ink">
                            {e.vendor || 'Untitled receipt'}
                          </span>
                          {e.project?.code && (
                            <span className="font-mono text-[10px] text-ink-3">
                              {e.project.code}
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-ink-3">
                          {e.category} · {e.date.toLocaleDateString('en-AU')}
                        </div>
                      </div>
                      <span className="tabular-nums text-ink">
                        {formatMoney(e.amountCents)}
                      </span>
                      <Badge variant={tone} className="capitalize">
                        {e.status.replace(/_/g, ' ')}
                      </Badge>
                    </Link>
                  );
                })
              )}
            </CardContent>
          </Card>
        ) : active ? (
          <Card>
            <CardHeader className="flex flex-row items-start justify-between gap-3">
              <div>
                <CardTitle>
                  Review · <span className="font-mono">{active.fileName}</span>
                </CardTitle>
                <p className="mt-0.5 text-xs text-ink-3">
                  Received via {active.receivedVia} ·{' '}
                  <span className="font-medium text-ink-2">
                    {active.ocrConfidence}% OCR confidence
                  </span>
                  . Edit any field before posting.
                </p>
              </div>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <PdfPreview bill={active} />
              <div>
                <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-3">
                  Extracted fields · edit anything
                </h3>
                {/* `key={active.id}` forces React to remount the form
                    when navigating between bills (queue clicks). Without it
                    the useState initialisers only fire on first mount, so
                    fresh bill data — like values just OCR'd in — never
                    overwrites the stale form state. */}
                <IntakeFieldEditor
                  key={active.id}
                  bill={active}
                  projects={projects}
                  nextId={nextId}
                />
                <div className="mt-4 rounded-md border border-line bg-surface-subtle/40 px-3 py-2 text-xs text-ink-3">
                  <div className="mb-1 font-medium uppercase tracking-wide text-ink-3">
                    On approval
                  </div>
                  <ol className="list-inside list-decimal space-y-0.5 text-[11px]">
                    <li>
                      adds the bill to the AP queue (super-admin gate per policy)
                    </li>
                    <li>
                      updates{' '}
                      {active.projectCode ? (
                        <span>
                          <span className="font-mono">{active.projectCode}</span> P&amp;L (
                          {active.category} line)
                        </span>
                      ) : (
                        <>firm OPEX P&amp;L ({active.category} line)</>
                      )}
                    </li>
                    <li>
                      routes for payment (TT approval ·{' '}
                      {active.amountTotalCents >= 200_000 ? 'over $2k' : 'standard'}
                      )
                    </li>
                  </ol>
                </div>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="py-12 text-center text-sm text-ink-3">
              The intake queue is empty — drop a PDF above to start, or wait for
              the email forwarder to land the next one.
            </CardContent>
          </Card>
        )}
      </div>

      {canReviewBills && (
      <aside className="space-y-4">
        {/* The duplicated `canReviewBills` guard on the inner cards
             below is intentional — the outer aside wrapper IS that
             check today (staff skip the whole right column), but
             keeping the inner guards keeps the inner cards safe
             against an accidental future "show aside for everyone"
             refactor leaking the queue or OCR-glossary panel to
             staff. */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>
              Queue · {queue.length}
            </CardTitle>
            <span className="text-[11px] text-ink-3">newest first</span>
          </CardHeader>
          <CardContent className="space-y-1 p-2">
            {queue.length === 0 ? (
              <p className="px-3 py-3 text-xs text-ink-3">
                Empty. New uploads land here.
              </p>
            ) : (
              queue.map((q) => {
                const status = STATUS_COPY(q.status);
                const isActive = q.id === activeId;
                return (
                  <Link
                    key={q.id}
                    href={`/bills/intake?id=${q.id}`}
                    className={`flex items-start justify-between gap-2 rounded-md px-3 py-2 text-xs ${
                      isActive
                        ? 'border border-brand bg-surface-hover'
                        : 'border border-transparent hover:bg-surface-hover'
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-mono text-[11px] text-ink">
                        {q.fileName}
                      </div>
                      <div className="mt-0.5 flex items-center gap-1.5">
                        <span
                          className={`inline-block h-1.5 w-1.5 rounded-full ${
                            status.tone === 'green'
                              ? 'bg-status-green'
                              : status.tone === 'amber'
                                ? 'bg-status-amber'
                                : status.tone === 'red'
                                  ? 'bg-status-red'
                                  : 'bg-ink-4'
                          }`}
                        />
                        <span className="text-[10px] text-ink-3">
                          {status.label}
                        </span>
                      </div>
                    </div>
                    <div className="text-right">
                      {q.projectCode ? (
                        <Badge variant="outline" className="text-[10px]">
                          {q.projectCode}
                        </Badge>
                      ) : q.category.toLowerCase().includes('opex') ? (
                        <Badge variant="green" className="text-[10px]">
                          OPEX
                        </Badge>
                      ) : (
                        <Badge variant="amber" className="text-[10px]">
                          ?
                        </Badge>
                      )}
                      <div className="mt-1 font-semibold tabular-nums text-ink">
                        {formatMoney(q.amountTotalCents)}
                      </div>
                    </div>
                  </Link>
                );
              })
            )}
          </CardContent>
        </Card>

        {/* "How it works" only renders for admin/partner reviewers
             — staff don't need the AP intake glossary. The staff-side
             dropzone has its own helper copy under the drop target. */}
        {canReviewBills && (
          <Card>
            <CardHeader>
              <CardTitle>How OCR works</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-[11px] text-ink-3">
              <p>
                <span className="font-medium text-ink-2">1.</span> Upload /
                email PDF →{' '}
                <span className="font-medium text-ink-2">2.</span> extract
                fields + match project →{' '}
                <span className="font-medium text-ink-2">3.</span> human
                confirms →{' '}
                <span className="font-medium text-ink-2">4.</span> post → live
                P&amp;L + AP queue.
              </p>
              <p className="pt-1">
                Real OCR runs on{' '}
                <span className="font-mono text-ink-2">claude-sonnet</span> via
                the AP intake agent (TASK-080). Until it ships, fill the fields
                manually here — same flow, just no auto-fill.
              </p>
            </CardContent>
          </Card>
        )}
      </aside>
      )}
    </div>
  );
}

function PdfPreview({ bill }: { bill: Awaited<ReturnType<typeof getIntakeBill>> }) {
  if (!bill) return null;

  // Inline file preview — the upload action stashes the file as a `data:`
  // URL on the bill so the reviewer can sanity-check fields against the
  // actual receipt. Three render paths:
  //   - data:application/pdf;base64,…  → <iframe>
  //   - data:image/(jpeg|png|webp|gif);base64,… → <img>
  //   - HEIC / unsupported / no body → fall back to the field stand-in
  const url = bill.attachmentSharepointUrl ?? '';
  const isDataUrl = url.startsWith('data:');
  const dataMime = isDataUrl
    ? url.slice(5, url.indexOf(';'))
    : null;
  const isPdfData = isDataUrl && dataMime === 'application/pdf';
  const isBrowserDisplayableImage =
    isDataUrl &&
    (dataMime === 'image/jpeg' ||
      dataMime === 'image/png' ||
      dataMime === 'image/webp' ||
      dataMime === 'image/gif');

  if (isPdfData) {
    return (
      <div className="overflow-hidden rounded-md border border-line bg-card">
        <iframe
          src={url}
          title={`PDF preview · ${bill.fileName}`}
          className="h-[640px] w-full"
        />
      </div>
    );
  }
  if (isBrowserDisplayableImage) {
    return (
      <div className="flex max-h-[720px] items-start justify-center overflow-auto rounded-md border border-line bg-card p-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt={`Receipt · ${bill.fileName}`}
          className="max-w-full rounded-sm shadow-sm"
        />
      </div>
    );
  }

  // Fallback stand-in for HEIC / no-body uploads: visual echo of the parsed
  // fields styled like an invoice so the reviewer can sanity-check at a
  // glance. Real PDF viewer comes once SharePoint fetching is wired
  // (TASK-082).
  const supplierLine = bill.supplierName ?? '—';
  return (
    <div className="rounded-md border border-line bg-card p-5 text-sm">
      <div className="text-base font-semibold uppercase tracking-wide text-ink">
        {supplierLine}
      </div>
      <div className="mt-1 text-[11px] text-ink-3">
        Forwarded via {bill.receivedVia}
      </div>
      <div className="my-3 h-px bg-line" />
      <div className="space-y-1.5 text-xs">
        <Row label="Invoice #">
          <Highlight tone="green">
            {bill.supplierInvoiceNumber ?? <span className="text-ink-4">—</span>}
          </Highlight>
        </Row>
        <Row label="Date">
          <Highlight tone="green">
            {bill.issueDate.toLocaleDateString('en-AU', {
              day: 'numeric',
              month: 'long',
              year: 'numeric',
            })}
          </Highlight>
        </Row>
        <Row label="Bill to">Foundry Health Pty Ltd</Row>
        {bill.projectCode && (
          <Row label="Ref">
            <Highlight tone="green">
              <span className="font-mono">{bill.projectCode}</span>
              {bill.projectName && <> — {bill.projectName}</>}
            </Highlight>
          </Row>
        )}
      </div>
      <div className="my-3 h-px bg-line" />
      <table className="w-full text-xs tabular-nums">
        <thead className="text-ink-3">
          <tr>
            <th className="text-left font-medium">Item</th>
            <th className="text-right font-medium">Qty</th>
            <th className="text-right font-medium">Rate</th>
            <th className="text-right font-medium">Amount</th>
          </tr>
        </thead>
        <tbody className="text-ink">
          <tr>
            <td className="py-1">{bill.category}</td>
            <td className="py-1 text-right text-ink-3">—</td>
            <td className="py-1 text-right text-ink-3">—</td>
            <td className="py-1 text-right">
              ${((bill.amountTotalCents - bill.gstCents) / 100).toFixed(2)}
            </td>
          </tr>
          {bill.gstCents > 0 && (
            <tr>
              <td className="py-1 text-ink-3">GST 10%</td>
              <td colSpan={2} />
              <td className="py-1 text-right text-ink-3">
                ${(bill.gstCents / 100).toFixed(2)}
              </td>
            </tr>
          )}
          <tr className="border-t border-line">
            <td className="pt-2 font-semibold">Total (AUD)</td>
            <td colSpan={2} />
            <td className="pt-2 text-right font-semibold">
              <Highlight tone="green">
                ${(bill.amountTotalCents / 100).toFixed(2)}
              </Highlight>
            </td>
          </tr>
        </tbody>
      </table>
      <div className="mt-4 text-[11px] text-ink-3">
        Due:{' '}
        <Highlight tone="amber">
          {bill.dueDate.toLocaleDateString('en-AU', {
            day: 'numeric',
            month: 'long',
            year: 'numeric',
          })}
        </Highlight>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[80px_1fr] gap-2">
      <div className="text-ink-3">{label}:</div>
      <div className="text-ink">{children}</div>
    </div>
  );
}

function Highlight({
  tone,
  children,
}: {
  tone: 'green' | 'amber' | 'red';
  children: React.ReactNode;
}) {
  const cls =
    tone === 'green'
      ? 'border-status-green text-status-green'
      : tone === 'amber'
        ? 'border-status-amber text-status-amber'
        : 'border-status-red text-status-red';
  return (
    <span className={`rounded-sm border border-dashed px-1 ${cls}`}>{children}</span>
  );
}

// Avatar import retained intentionally — used in case we surface the
// uploader's identity in the queue list later.
const _AvatarRef = Avatar;
const _AvatarFallbackRef = AvatarFallback;
void _AvatarRef;
void _AvatarFallbackRef;
