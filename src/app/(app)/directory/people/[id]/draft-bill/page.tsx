import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSession } from '@/server/session';
import { hasAnyRole } from '@/server/roles';
import { prisma } from '@/server/db';
import { listContractorBillableEntries } from '@/server/timesheet';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { DraftBillForm } from './form';

function formatMoney(cents: number): string {
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

export default async function DraftContractorBillPage({
  params,
}: {
  params: { id: string };
}) {
  const session = await getSession();
  if (!hasAnyRole(session, ['super_admin', 'admin', 'partner'])) notFound();

  const person = await prisma.person.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      initials: true,
      headshotUrl: true,
      employment: true,
      rate: true,
      billRate: true,
    },
  });
  if (!person) notFound();
  if (person.employment !== 'contractor') {
    return (
      <div className="space-y-4">
        <div className="text-sm">
          <Link href={`/directory/people/${person.id}`} className="text-ink-3 hover:text-ink">
            ← Back to {person.firstName} {person.lastName}
          </Link>
        </div>
        <Card>
          <CardContent className="py-8 text-center text-sm text-ink-3">
            Draft bills are for contractors. {person.firstName} is on full-time payroll —
            paid via the next pay run instead.
          </CardContent>
        </Card>
      </div>
    );
  }

  const billable = await listContractorBillableEntries(person.id);
  const totalHours = billable.groups.reduce((s, g) => s + g.hours, 0);
  const totalEx = billable.groups.reduce((s, g) => s + g.billCents, 0);
  const totalGst = Math.round(totalEx * 0.1);
  const totalInc = totalEx + totalGst;
  const today = new Date().toISOString().slice(0, 10);
  const due = new Date();
  due.setUTCDate(due.getUTCDate() + 14);
  const defaultDue = due.toISOString().slice(0, 10);

  return (
    <div className="space-y-6">
      <div className="text-sm">
        <Link href={`/directory/people/${person.id}`} className="text-ink-3 hover:text-ink">
          ← Back to {person.firstName} {person.lastName}
        </Link>
      </div>

      <header>
        <h1 className="text-xl font-semibold text-ink">
          Draft bill from approved hours
        </h1>
        <p className="text-sm text-ink-3">
          One Bill per project (status &ldquo;pending review&rdquo;) is created at the
          contractor&apos;s {billable.billRate ? 'bill rate' : 'cost rate'}. The matching
          timesheet entries flip to &ldquo;billed&rdquo; so they don&apos;t appear here
          again. Send the contractor the draft for sign-off, then attach their PDF
          invoice + approve the bill in the AP queue.
        </p>
      </header>

      {billable.groups.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-ink-3">
            No approved + unbilled hours. Approvers — head to the timesheet approval
            queue first, then come back.
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Summary</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Project</TableHead>
                    <TableHead className="text-right">Hours</TableHead>
                    <TableHead className="text-right">Bill rate</TableHead>
                    <TableHead className="text-right">Ex GST</TableHead>
                    <TableHead className="text-right">GST 10%</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {billable.groups.map((g) => {
                    const gst = Math.round(g.billCents * 0.1);
                    return (
                      <TableRow key={g.projectId}>
                        <TableCell>
                          <Link
                            href={`/projects/${g.projectCode}`}
                            className="hover:underline"
                          >
                            <span className="font-mono text-xs text-ink-3">
                              {g.projectCode}
                            </span>{' '}
                            <span className="text-ink-2">{g.projectName}</span>
                          </Link>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {g.hours.toFixed(2)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-ink-3">
                          {formatMoney(billable.billRate ?? billable.rate)}/h
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatMoney(g.billCents)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-ink-3">
                          {formatMoney(gst)}
                        </TableCell>
                        <TableCell className="text-right font-semibold tabular-nums">
                          {formatMoney(g.billCents + gst)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  <TableRow>
                    <TableCell className="font-semibold text-ink">Total</TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">
                      {totalHours.toFixed(2)}
                    </TableCell>
                    <TableCell />
                    <TableCell className="text-right font-semibold tabular-nums">
                      {formatMoney(totalEx)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-ink-3">
                      {formatMoney(totalGst)}
                    </TableCell>
                    <TableCell className="text-right font-semibold tabular-nums text-ink">
                      {formatMoney(totalInc)}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <DraftBillForm
            personId={person.id}
            defaultIssueDate={today}
            defaultDueDate={defaultDue}
            projectCount={billable.groups.length}
          />
        </>
      )}
    </div>
  );
}
