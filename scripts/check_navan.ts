import { prisma } from '@/server/db';

async function main() {
  // 1) Bills tagged as coming from Navan (api or csv)
  const navanBills = await prisma.bill.findMany({
    where: {
      OR: [
        { receivedVia: 'navan_api' },
        { receivedVia: 'navan_csv' },
        { supplierInvoiceNumber: { startsWith: 'navan:booking:' } },
      ],
    },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      supplierName: true,
      supplierInvoiceNumber: true,
      receivedVia: true,
      amountTotal: true,
      status: true,
      projectId: true,
      attributedToPersonId: true,
      createdAt: true,
    },
    take: 50,
  });
  console.log(`\n=== Navan bills (${navanBills.length}) ===`);
  for (const b of navanBills) {
    console.log(
      `  ${b.createdAt.toISOString()} ${b.id.slice(0, 8)} ${b.supplierName} $${(b.amountTotal / 100).toFixed(2)} status=${b.status} via=${b.receivedVia} project=${b.projectId ?? 'OPEX'} attr=${b.attributedToPersonId ?? '-'}`,
    );
    console.log(`     invoiceNo: ${b.supplierInvoiceNumber}`);
  }

  // 2) Approvals for bill subjects
  const billApprovals = await prisma.approval.findMany({
    where: { subjectType: 'bill' },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      subjectId: true,
      status: true,
      requiredRole: true,
      createdAt: true,
    },
    take: 50,
  });
  console.log(`\n=== Bill approvals (${billApprovals.length}) ===`);
  for (const a of billApprovals) {
    console.log(
      `  ${a.createdAt.toISOString()} ${a.id.slice(0, 8)} subject=${a.subjectId.slice(0, 8)} status=${a.status} requiredRole=${a.requiredRole}`,
    );
  }

  // 3) Integration row state
  const navanIntegration = await prisma.integration.findFirst({
    where: { kind: 'navan' },
    select: { id: true, status: true, lastSyncAt: true, kind: true, updatedAt: true },
  });
  console.log(`\n=== Navan integration row ===`);
  console.log(JSON.stringify(navanIntegration, null, 2));

  // 4) Did anything ever land as an Expense via navan? (the old code path,
  //    pre-Bill-model-switch)
  const navanExpenses = await prisma.expense.findMany({
    where: {
      OR: [
        { description: { startsWith: 'navan:booking:' } },
        { description: { contains: 'Navan', mode: 'insensitive' } },
        { description: { contains: 'navan', mode: 'insensitive' } },
      ],
    },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      description: true,
      vendor: true,
      amount: true,
      status: true,
      projectId: true,
      createdAt: true,
    },
    take: 50,
  });
  console.log(`\n=== Navan expenses (legacy path, ${navanExpenses.length}) ===`);
  for (const e of navanExpenses) {
    console.log(
      `  ${e.createdAt.toISOString()} ${e.id.slice(0, 8)} ${e.vendor} $${(e.amount / 100).toFixed(2)} status=${e.status} project=${e.projectId ?? 'OPEX'}`,
    );
    console.log(`     desc: ${e.description}`);
  }

  // 5) All bill receivedVia values currently in the DB — sanity check
  //    what tags are actually being written.
  const tags = await prisma.bill.groupBy({
    by: ['receivedVia'],
    _count: { _all: true },
    orderBy: { _count: { receivedVia: 'desc' } },
  });
  console.log(`\n=== Bill.receivedVia distribution ===`);
  for (const t of tags) console.log(`  ${t.receivedVia}: ${t._count._all}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
