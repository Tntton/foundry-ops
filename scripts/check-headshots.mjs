import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const teamFile = join(__dirname, '..', 'foundry-team.jsx');
const raw = readFileSync(teamFile, 'utf8');

// Parse design file for { initials, avatar } pairs
const blocks = raw.split(/\n\s*\{/).slice(1);
const designByInitials = new Map();
for (const block of blocks) {
  const i = block.match(/initials\s*:\s*['"]([^'"]+)['"]/);
  const a = block.match(/avatar\s*:\s*['"]([^'"]+)['"]/);
  if (i && a) designByInitials.set(i[1].trim(), a[1].trim());
}

const prisma = new PrismaClient();
try {
  const people = await prisma.person.findMany({
    where: { endDate: null },
    orderBy: { initials: 'asc' },
    select: {
      id: true,
      initials: true,
      firstName: true,
      lastName: true,
      headshotUrl: true,
      endDate: true,
    },
  });

  const totalActive = people.length;
  const withHeadshot = people.filter((p) => p.headshotUrl).length;
  const missingButInDesign = people.filter(
    (p) => !p.headshotUrl && designByInitials.has(p.initials),
  );
  const missingNoDesign = people.filter(
    (p) => !p.headshotUrl && !designByInitials.has(p.initials),
  );
  const designOnly = [...designByInitials.keys()].filter(
    (initials) => !people.some((p) => p.initials === initials),
  );

  console.log(`Active people in DB:        ${totalActive}`);
  console.log(`Active with headshot:       ${withHeadshot}`);
  console.log(`Active missing headshot:    ${totalActive - withHeadshot}`);
  console.log(`Design-file entries:        ${designByInitials.size}`);
  console.log('');

  if (missingButInDesign.length > 0) {
    console.log('⚠️  In DB AND design file but headshot NOT applied:');
    for (const p of missingButInDesign) {
      console.log(
        `   ${p.initials}  ${p.firstName} ${p.lastName}  → ${designByInitials.get(p.initials)}`,
      );
    }
    console.log('');
  }

  if (missingNoDesign.length > 0) {
    console.log('Active staff with NO design entry (would need manual upload):');
    for (const p of missingNoDesign) {
      console.log(`   ${p.initials}  ${p.firstName} ${p.lastName}`);
    }
    console.log('');
  }

  if (designOnly.length > 0) {
    console.log(
      `Design-file initials NOT in DB (likely contractors / former staff):`,
    );
    console.log(`   ${designOnly.join(', ')}`);
  }
} finally {
  await prisma.$disconnect();
}
