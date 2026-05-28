import { prisma } from '@/server/db';

async function main() {
  // 1) Verify the 2 bills we just imported.
  const bills = await prisma.bill.findMany({
    where: { receivedVia: 'navan_csv' },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      supplierName: true,
      supplierInvoiceNumber: true,
      amountTotal: true,
      gst: true,
      status: true,
      projectId: true,
      attributedToPersonId: true,
      attributedTo: { select: { firstName: true, lastName: true, email: true } },
      project: { select: { code: true, name: true } },
      issueDate: true,
      createdAt: true,
    },
  });
  console.log(`\n=== Bills imported via navan_csv (${bills.length}) ===`);
  for (const b of bills) {
    console.log(
      `  ${b.id} ${b.supplierName} $${(b.amountTotal / 100).toFixed(2)} (gst $${(b.gst / 100).toFixed(2)}) status=${b.status}`,
    );
    console.log(`    invoiceNo: ${b.supplierInvoiceNumber}`);
    console.log(
      `    traveller: ${b.attributedTo?.firstName} ${b.attributedTo?.lastName} (${b.attributedTo?.email})`,
    );
    console.log(`    project: ${b.project?.code ?? 'OPEX'} ${b.project?.name ?? ''}`);
    console.log(`    issueDate: ${b.issueDate.toISOString()}`);
  }

  // 2) Verify approvals exist for them.
  const approvals = await prisma.approval.findMany({
    where: {
      subjectType: 'bill',
      subjectId: { in: bills.map((b) => b.id) },
    },
    select: { id: true, status: true, requiredRole: true, subjectId: true },
  });
  console.log(`\n=== Approvals for those bills (${approvals.length}) ===`);
  for (const a of approvals) console.log(`  ${a.id} subject=${a.subjectId} status=${a.status} role=${a.requiredRole}`);

  // 3) Look up the unmatched emails — are they in the Person table at all?
  const unmatchedEmails = [
    'julia.maguire@foundry.health',
    'matt.byers@foundry.health',
    'will.macdonald@foundry.health',
    'sarah.rav@foundry.health',
    'simone.sandler@foundry.health',
    'alejandro.rosales@foundry.health',
  ];
  const found = await prisma.person.findMany({
    where: { email: { in: unmatchedEmails } },
    select: { id: true, firstName: true, lastName: true, email: true },
  });
  console.log(`\n=== Unmatched emails found in Person (${found.length}) ===`);
  for (const p of found) console.log(`  ${p.email} → ${p.firstName} ${p.lastName} (${p.id})`);

  // What's in the Person table close to those names?
  const close = await prisma.person.findMany({
    where: {
      OR: [
        { firstName: { in: ['Julia', 'Matt', 'Will', 'Sarah', 'Simone', 'Alejandro'], mode: 'insensitive' } },
        { lastName: { in: ['Maguire', 'Byers', 'Macdonald', 'Rav', 'Sandler', 'Rosales'], mode: 'insensitive' } },
      ],
    },
    select: { firstName: true, lastName: true, email: true, inactiveAt: true },
  });
  console.log(`\n=== Close-name matches in Person ===`);
  for (const p of close) console.log(`  ${p.firstName} ${p.lastName} (${p.email}) inactiveAt=${p.inactiveAt ?? '-'}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
