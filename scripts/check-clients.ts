import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const rows = await prisma.client.findMany({
    orderBy: { code: 'asc' },
    select: { code: true, legalName: true, primaryPartner: { select: { initials: true } } },
  });
  console.log(`total clients: ${rows.length}\n`);
  for (const r of rows) {
    console.log(
      `  ${r.code.padEnd(6)}  ${r.legalName.padEnd(40)}  partner=${r.primaryPartner.initials}`,
    );
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
