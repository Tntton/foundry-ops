import { prisma } from '@/server/db';

async function main() {
  const bills = await prisma.bill.findMany({
    where: { receivedVia: 'navan_csv' },
    orderBy: [{ attributedToPersonId: 'asc' }, { issueDate: 'asc' }],
    select: {
      id: true,
      supplierName: true,
      amountTotal: true,
      status: true,
      issueDate: true,
      attributedTo: { select: { firstName: true, lastName: true, email: true } },
    },
  });
  const grouped = new Map<string, typeof bills>();
  for (const b of bills) {
    const key = `${b.attributedTo?.firstName} ${b.attributedTo?.lastName}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(b);
  }
  console.log(`\n=== Navan bills in /approvals queue (${bills.length} total) ===`);
  for (const [traveller, rows] of grouped) {
    const total = rows.reduce((s, r) => s + r.amountTotal, 0) / 100;
    console.log(`\n  ${traveller}  ($${total.toFixed(2)} across ${rows.length} bookings)`);
    for (const r of rows) {
      console.log(`    ${r.issueDate.toISOString().slice(0, 10)}  ${r.supplierName.padEnd(20)} $${(r.amountTotal / 100).toFixed(2).padStart(8)}  [${r.status}]`);
    }
  }

  const totalApprovalsPending = await prisma.approval.count({
    where: { subjectType: 'bill', status: 'pending' },
  });
  console.log(`\n=== Bill approvals pending: ${totalApprovalsPending} ===`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
