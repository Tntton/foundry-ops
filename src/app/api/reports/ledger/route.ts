import { NextResponse } from 'next/server';
import { getSession } from '@/server/session';
import { hasCapability } from '@/server/capabilities';
import { prisma } from '@/server/db';
import { writeAudit } from '@/server/audit';
import { buildLedger } from '@/server/reports/ledger';
import { parseLedgerFilters } from '@/server/reports/ledger-filters';
import { ledgerToCsv, ledgerToWorkbook } from '@/server/reports/ledger-export';
import { ymd } from '@/server/reports/csv';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const XLSX_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * Master-ledger export (TASK-069c). PII-bearing — gated on
 * `report.ledger.export` (super_admin / admin) and every download is
 * audited (A9). `?format=csv` (default) or `?format=xlsx`; filters match
 * the in-app tab via the shared parser.
 */
export async function GET(request: Request) {
  const session = await getSession();
  if (!session || !hasCapability(session, 'report.ledger.export')) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const url = new URL(request.url);
  const sp = Object.fromEntries(url.searchParams.entries());
  const filters = parseLedgerFilters(sp);
  const format = url.searchParams.get('format') === 'xlsx' ? 'xlsx' : 'csv';

  const rows = await buildLedger(session, filters);

  // Audit the download — who pulled the PII-bearing ledger, in what
  // shape, and over which filters.
  await prisma.$transaction(async (tx) => {
    await writeAudit(tx, {
      actor: { type: 'person', id: session.person.id },
      action: 'exported',
      entity: {
        type: 'report',
        id: 'ledger',
        after: {
          via: 'ledger_export_downloaded',
          format,
          rowCount: rows.length,
          filters: sp,
        },
      },
      source: 'web',
    });
  });

  const stamp = ymd(new Date());

  if (format === 'xlsx') {
    const buffer = ledgerToWorkbook(rows);
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': XLSX_MIME,
        'Content-Disposition': `attachment; filename="Master-Ledger-${stamp}.xlsx"`,
        'Cache-Control': 'no-store',
      },
    });
  }

  const csv = ledgerToCsv(rows);
  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="Master-Ledger-${stamp}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}
