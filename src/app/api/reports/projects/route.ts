import { NextResponse } from 'next/server';
import type { ProjectStage } from '@prisma/client';
import { getSession } from '@/server/session';
import { listProjects } from '@/server/projects';
import { centsToDecimal, toCsv, ymd } from '@/server/reports/csv';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STAGE_OPTIONS: readonly ProjectStage[] = ['kickoff', 'delivery', 'closing', 'archived'];

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const url = new URL(req.url);
  const stage = STAGE_OPTIONS.includes(url.searchParams.get('stage') as ProjectStage)
    ? (url.searchParams.get('stage') as ProjectStage)
    : undefined;
  const active =
    url.searchParams.get('active') === 'true'
      ? true
      : url.searchParams.get('active') === 'false'
        ? false
        : undefined;
  const q = url.searchParams.get('q')?.trim();

  const rows = await listProjects(session, {
    ...(stage ? { stage } : {}),
    ...(active !== undefined ? { active } : {}),
    ...(q ? { search: q } : {}),
  });

  const csv = toCsv(
    [
      'Code',
      'Name',
      'Client code',
      'Client',
      'Stage',
      'Partner',
      'Manager',
      'Contract (AUD ex GST)',
      'Start',
      'End',
    ],
    rows.map((p) => [
      p.code,
      p.name,
      p.client.code,
      p.client.legalName,
      p.stage,
      `${p.primaryPartner.firstName} ${p.primaryPartner.lastName}`,
      `${p.manager.firstName} ${p.manager.lastName}`,
      centsToDecimal(p.contractValueCents),
      ymd(p.startDate),
      ymd(p.endDate),
    ]),
  );

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="foundry-projects-${ymd(new Date())}.csv"`,
    },
  });
}
