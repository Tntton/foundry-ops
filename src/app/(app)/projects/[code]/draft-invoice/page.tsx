import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSession } from '@/server/session';
import { hasCapability } from '@/server/capabilities';
import { prisma } from '@/server/db';
import { previewInvoiceFromTimesheets } from '@/server/invoice-drafter';
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
import { DraftInvoiceFromTimeForm } from './form';

function formatMoney(cents: number): string {
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function firstOfMonth(d = new Date()): string {
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}
function firstOfNextMonth(d = new Date()): string {
  return new Date(d.getFullYear(), d.getMonth() + 1, 1).toISOString().slice(0, 10);
}

export default async function DraftInvoiceFromTimePage({
  params,
  searchParams,
}: {
  params: { code: string };
  searchParams: { start?: string; end?: string };
}) {
  const session = await getSession();
  if (!hasCapability(session, 'invoice.create')) notFound();

  const project = await prisma.project.findUnique({
    where: { code: params.code },
    select: {
      id: true,
      code: true,
      name: true,
      client: { select: { code: true, legalName: true } },
    },
  });
  if (!project) notFound();

  const start = searchParams.start ?? firstOfMonth();
  const end = searchParams.end ?? firstOfNextMonth();
  const periodStart = new Date(start);
  const periodEnd = new Date(end);
  const isValid = !isNaN(periodStart.getTime()) && !isNaN(periodEnd.getTime()) && periodEnd > periodStart;

  const preview = isValid
    ? await previewInvoiceFromTimesheets(project.id, periodStart, periodEnd)
    : null;

  return (
    <div className="space-y-6">
      <div className="text-sm">
        <Link href={`/projects/${project.code}`} className="text-ink-3 hover:text-ink">
          ← Back to {project.code}
        </Link>
      </div>

      <header>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="font-mono">
            {project.code}
          </Badge>
          <h1 className="text-xl font-semibold text-ink">Draft invoice from timesheets</h1>
        </div>
        <p className="mt-1 text-sm text-ink-3">
          Collects approved, not-yet-billed timesheets for <strong>{project.client.legalName}</strong>{' '}
          in the selected period. Draft is created as a standard invoice in status{' '}
          <span className="font-mono">draft</span> — you can review and submit for
          approval like any other.
        </p>
      </header>

      <form action={`/projects/${project.code}/draft-invoice`} method="get">
        <Card>
          <CardHeader>
            <CardTitle>Period</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-xs text-ink-3">
              Start
              <input
                name="start"
                type="date"
                defaultValue={start}
                className="flex h-9 rounded-md border border-line bg-surface-elev px-2 text-sm text-ink"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-ink-3">
              End (exclusive)
              <input
                name="end"
                type="date"
                defaultValue={end}
                className="flex h-9 rounded-md border border-line bg-surface-elev px-2 text-sm text-ink"
              />
            </label>
            <button
              type="submit"
              className="inline-flex h-9 items-center rounded-md border border-line px-3 text-sm text-ink-2 hover:bg-surface-hover hover:text-ink"
            >
              Preview
            </button>
          </CardContent>
        </Card>
      </form>

      {!isValid ? (
        <Card className="p-12 text-center text-sm text-status-red">
          Invalid date range. Period end must be after period start.
        </Card>
      ) : !preview ? null : preview.perPerson.length === 0 ? (
        <Card className="p-12 text-center text-sm text-ink-3">
          No approved, unbilled timesheets in this period.
          {preview.unbillableHours > 0 && (
            <p className="mt-2 text-xs text-status-amber">
              {preview.unbillableHours.toFixed(1)}h logged but no bill rate on file for those
              people — set their Person.billRate to include them.
            </p>
          )}
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Preview</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Person</TableHead>
                    <TableHead className="text-right">Hours</TableHead>
                    <TableHead className="text-right">Rate</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.perPerson.map((p) => (
                    <TableRow key={p.personId}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Avatar className="h-6 w-6">
                            <AvatarFallback className="text-[10px]">
                              {p.personInitials}
                            </AvatarFallback>
                          </Avatar>
                          <span className="text-sm text-ink">
                            {p.personFirstName} {p.personLastName}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {p.hours.toFixed(1)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-ink-3">
                        {p.billRateCents !== null ? formatMoney(p.billRateCents) : '—'} / hr
                      </TableCell>
                      <TableCell className="text-right font-semibold tabular-nums text-ink">
                        {formatMoney(p.lineAmountCents)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <div className="mt-3 flex items-center justify-between border-t border-line pt-3 text-sm">
                <div className="text-ink-3">
                  {preview.perPerson.length}{' '}
                  {preview.perPerson.length === 1 ? 'person' : 'people'} ·{' '}
                  {preview.totalHours.toFixed(1)} hours
                </div>
                <div className="font-semibold tabular-nums text-ink">
                  Total ex GST: {formatMoney(preview.totalAmountCents)}
                </div>
              </div>
              {preview.unbillableHours > 0 && (
                <p className="mt-3 text-xs text-status-amber">
                  Excluded: {preview.unbillableHours.toFixed(1)}h from people with no
                  Person.billRate on file. Update their rate card to include them.
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Create draft</CardTitle>
            </CardHeader>
            <CardContent>
              <DraftInvoiceFromTimeForm
                projectId={project.id}
                defaultStart={start}
                defaultEnd={end}
                disabled={preview.perPerson.length === 0}
              />
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
