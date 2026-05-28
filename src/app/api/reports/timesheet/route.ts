import { NextResponse } from 'next/server';
import type { TimesheetStatus } from '@prisma/client';
import { getSession } from '@/server/session';
import { hasAnyRole } from '@/server/roles';
import { prisma } from '@/server/db';
import { centsToDecimal, toCsv, ymd } from '@/server/reports/csv';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STATUS_OPTIONS: readonly TimesheetStatus[] = [
  'draft',
  'submitted',
  'approved',
  'billed',
];

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const url = new URL(req.url);
  const status = STATUS_OPTIONS.includes(url.searchParams.get('status') as TimesheetStatus)
    ? (url.searchParams.get('status') as TimesheetStatus)
    : undefined;
  const projectCode = url.searchParams.get('projectCode')?.trim() || undefined;
  const personId = url.searchParams.get('personId')?.trim() || undefined;
  const fromIso = url.searchParams.get('from')?.trim();
  const toIso = url.searchParams.get('to')?.trim();

  // Permission scoping:
  // - super_admin / admin / partner: see all
  // - manager: see entries for projects they manage
  // - everyone else: only their own entries
  const canSeeAll = hasAnyRole(session, ['super_admin', 'admin', 'partner']);
  const isManager = hasAnyRole(session, ['manager']);

  const where: Record<string, unknown> = {};
  if (status) where['status'] = status;
  if (personId) where['personId'] = personId;
  if (projectCode) {
    where['project'] = { code: projectCode };
  }
  if (fromIso || toIso) {
    const range: { gte?: Date; lt?: Date } = {};
    if (fromIso) range.gte = new Date(`${fromIso}T00:00:00Z`);
    if (toIso) range.lt = new Date(`${toIso}T00:00:00Z`);
    where['date'] = range;
  }

  if (!canSeeAll) {
    if (isManager) {
      where['OR'] = [
        { personId: session.person.id },
        { project: { managerId: session.person.id } },
      ];
    } else {
      where['personId'] = session.person.id;
    }
  }

  const rows = await prisma.timesheetEntry.findMany({
    where,
    orderBy: [{ date: 'asc' }],
    include: {
      person: {
        select: { id: true, initials: true, headshotUrl: true, firstName: true, lastName: true, rate: true },
      },
      project: { select: { code: true, name: true } },
      billedInvoice: { select: { number: true } },
    },
  });

  const csv = toCsv(
    [
      'Date',
      'Person',
      'Project code',
      'Project name',
      'Hours',
      'Description',
      'Status',
      'Approved at',
      'Cost rate (AUD/hr)',
      'Cost (AUD)',
      'Linked invoice',
    ],
    rows.map((e) => [
      ymd(e.date),
      `${e.person.firstName} ${e.person.lastName}`,
      e.project.code,
      e.project.name,
      Number(e.hours).toFixed(2),
      e.description ?? '',
      e.status,
      e.approvedAt ? ymd(e.approvedAt) : '',
      centsToDecimal(e.person.rate ?? 0),
      centsToDecimal(Math.round(Number(e.hours) * (e.person.rate ?? 0))),
      e.billedInvoice?.number ?? '',
    ]),
  );

  const namePart = projectCode
    ? `-${projectCode.toLowerCase()}`
    : personId
      ? '-person'
      : '';
  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="foundry-timesheet${namePart}-${ymd(new Date())}.csv"`,
    },
  });
}
