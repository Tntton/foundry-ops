import { NextResponse } from 'next/server';
import type { DealStage } from '@prisma/client';
import { getSession } from '@/server/session';
import { hasAnyRole } from '@/server/roles';
import { listDeals } from '@/server/deals';
import { centsToDecimal, toCsv, ymd } from '@/server/reports/csv';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STAGE_OPTIONS: readonly DealStage[] = [
  'lead',
  'qualifying',
  'proposal',
  'negotiation',
  'won',
  'lost',
];

export async function GET(req: Request) {
  const session = await getSession();
  if (!hasAnyRole(session, ['super_admin', 'admin', 'partner'])) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const url = new URL(req.url);
  const stage = STAGE_OPTIONS.includes(url.searchParams.get('stage') as DealStage)
    ? (url.searchParams.get('stage') as DealStage)
    : undefined;
  const q = url.searchParams.get('q')?.trim();

  const rows = await listDeals({
    ...(stage ? { stage } : {}),
    ...(q ? { search: q } : {}),
  });

  const csv = toCsv(
    [
      'Code',
      'Name',
      'Stage',
      'Client code',
      'Client / prospective',
      'Owner',
      'Expected (AUD)',
      'Probability %',
      'Weighted (AUD)',
      'Target close',
      'Created',
      'Converted project',
    ],
    rows.map((d) => [
      d.code,
      d.name,
      d.stage,
      d.client?.code ?? '',
      d.client?.legalName ?? d.prospectiveName ?? '',
      `${d.owner.firstName} ${d.owner.lastName}`,
      centsToDecimal(d.expectedValueCents),
      d.probabilityPct,
      centsToDecimal(d.weightedValueCents),
      d.targetCloseDate ? ymd(d.targetCloseDate) : '',
      ymd(d.createdAt),
      d.convertedProject?.code ?? '',
    ]),
  );

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="foundry-deals-${ymd(new Date())}.csv"`,
    },
  });
}
