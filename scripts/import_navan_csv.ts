import { readFileSync } from 'node:fs';
import { prisma } from '@/server/db';
import { importNavanCsv } from '@/server/integrations/navan-csv';

async function main() {
  const csvPath = '/Users/tnt/Downloads/REPORT_2026_05_11__06_13_46_129PT-CONTAINS-SENSITIVE-DATA-REMOVE-AFTER-USE.csv';
  const csv = readFileSync(csvPath, 'utf8');
  console.log(`Read ${csv.length} bytes from CSV`);
  console.log(`First 200 chars: ${csv.slice(0, 200)}`);

  // Use TT (super_admin) as the actor.
  const actor = await prisma.person.findFirst({
    where: { email: 'trung@foundry.health' },
    select: { id: true, firstName: true, lastName: true },
  });
  if (!actor) throw new Error('Could not find TT in DB');
  console.log(`Actor: ${actor.firstName} ${actor.lastName} (${actor.id})`);

  const result = await importNavanCsv({ csv, actorPersonId: actor.id });
  console.log('\n=== Import result ===');
  console.log(JSON.stringify(result, null, 2));
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
