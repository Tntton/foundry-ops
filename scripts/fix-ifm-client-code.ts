import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const bad = await prisma.client.findUnique({
    where: { code: 'IFM001-' },
    select: { id: true, legalName: true },
  });
  if (!bad) {
    console.log('No client with code "IFM001-" — checking IFM…');
    const ok = await prisma.client.findUnique({
      where: { code: 'IFM' },
      select: { code: true, legalName: true },
    });
    console.log('IFM row:', ok);
    return;
  }
  const taken = await prisma.client.findUnique({ where: { code: 'IFM' } });
  if (taken) {
    console.log(
      'IFM is already taken — deleting the IFM001- duplicate to avoid collision.',
    );
    await prisma.client.delete({ where: { id: bad.id } });
    console.log('deleted IFM001-');
    return;
  }
  const updated = await prisma.client.update({
    where: { id: bad.id },
    data: { code: 'IFM' },
    select: { code: true, legalName: true },
  });
  console.log(`renamed: ${updated.code}  ${updated.legalName}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
