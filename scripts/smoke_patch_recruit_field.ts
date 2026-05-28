import { prisma } from '@/server/db';

async function main() {
  const r = await prisma.recruitProspect.findFirst({
    where: { status: 'active' },
    select: { id: true, firstName: true, lastName: true, email: true, notes: true },
  });
  if (!r) { console.log('No active recruit to test'); return; }

  const stamp = new Date().toISOString().slice(11, 19);
  const testEmail = `qa-test-${stamp}@example.com`;
  const testNotes = `Existing: ${r.notes ?? '(none)'}\n[QA ping ${stamp}]`;

  console.log(`Test target: ${r.firstName} ${r.lastName} (${r.id})`);
  console.log(`Before: email=${r.email ?? 'null'}, notes len=${(r.notes ?? '').length}`);

  await prisma.recruitProspect.update({
    where: { id: r.id },
    data: { email: testEmail, notes: testNotes },
  });

  const after = await prisma.recruitProspect.findUnique({
    where: { id: r.id },
    select: { email: true, notes: true },
  });
  console.log(`After:  email=${after?.email}, notes len=${(after?.notes ?? '').length}`);

  // Revert so the test isn't sticky.
  await prisma.recruitProspect.update({
    where: { id: r.id },
    data: { email: r.email, notes: r.notes },
  });
  console.log('Reverted.');
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
