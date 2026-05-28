/**
 * Set the staff designation + FTE values for the three tracked-for-
 * utilisation employees (Trung Ton, Matt Byers, Sarah Ravindran). All
 * other people get isStaff=false (the schema default). Idempotent —
 * safe to re-run.
 *
 * Run: pnpm tsx scripts/set-staff-designations.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

type RegularDays = {
  mon: number;
  tue: number;
  wed: number;
  thu: number;
  fri: number;
  sat: number;
  sun: number;
};

const STAFF: Array<{
  email: string;
  fte: number;
  label: string;
  regular: RegularDays;
}> = [
  {
    email: 'trung@foundry.health',
    fte: 1.0,
    label: 'Trung Ton',
    regular: { mon: 8, tue: 8, wed: 8, thu: 8, fri: 8, sat: 0, sun: 0 },
  },
  {
    email: 'matt@foundry.health',
    fte: 1.0,
    label: 'Matt Byers',
    regular: { mon: 8, tue: 8, wed: 8, thu: 8, fri: 8, sat: 0, sun: 0 },
  },
  {
    email: 'sarah@foundry.health',
    fte: 0.5,
    label: 'Sarah Ravindran',
    regular: { mon: 0, tue: 4, wed: 8, thu: 8, fri: 0, sat: 0, sun: 0 },
  },
];

async function main() {
  // Reset everyone to non-staff first so a re-run trims any stragglers.
  const reset = await prisma.person.updateMany({
    where: { isStaff: true },
    data: { isStaff: false },
  });
  console.log(`reset: cleared isStaff on ${reset.count} existing rows`);

  for (const s of STAFF) {
    const existing = await prisma.person.findUnique({
      where: { email: s.email },
      select: { id: true, firstName: true, lastName: true, fte: true, isStaff: true },
    });
    if (!existing) {
      console.warn(`skip: no Person with email ${s.email} (${s.label})`);
      continue;
    }
    const updated = await prisma.person.update({
      where: { id: existing.id },
      data: {
        isStaff: true,
        fte: s.fte,
        regularDaysEnabled: true,
        regularMonHours: s.regular.mon,
        regularTueHours: s.regular.tue,
        regularWedHours: s.regular.wed,
        regularThuHours: s.regular.thu,
        regularFriHours: s.regular.fri,
        regularSatHours: s.regular.sat,
        regularSunHours: s.regular.sun,
      },
      select: { firstName: true, lastName: true, fte: true, isStaff: true },
    });
    const dayCols = Object.entries(s.regular)
      .filter(([, h]) => h > 0)
      .map(([d, h]) => `${d}=${h}`)
      .join(' ');
    console.log(
      `set: ${updated.firstName} ${updated.lastName} → isStaff=${updated.isStaff}, fte=${updated.fte}, regular: ${dayCols}`,
    );
  }

  const finalStaff = await prisma.person.findMany({
    where: { isStaff: true },
    orderBy: { lastName: 'asc' },
    select: { firstName: true, lastName: true, fte: true, band: true },
  });
  console.log('\nfinal staff roster:');
  for (const p of finalStaff) {
    console.log(`  · ${p.firstName} ${p.lastName} · ${p.band} · ${p.fte}FTE`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
