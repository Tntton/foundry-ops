import { prisma } from '@/server/db';

async function main() {
  const existing = await prisma.recruitProspect.count();
  if (existing > 0) {
    console.log(`Already have ${existing} recruits — skipping seed.`);
    return;
  }

  // Pick TT as the default owner so the cards have a real Person FK.
  const tt = await prisma.person.findFirst({
    where: { email: 'trung@foundry.health' },
    select: { id: true },
  });
  if (!tt) { console.log('TT not found'); return; }

  // A handful of representative cards across the band pools.
  const samples = [
    { firstName: 'Eleanor', lastName: 'Quinn', targetBand: 'senior_leader' as const, stage: 'interviewing', source: 'LinkedIn intro', notes: 'Ex-McKinsey health director. Worked with us on PNC pre-acquisition.' },
    { firstName: 'Daniel', lastName: 'Park', targetBand: 'expert' as const, stage: 'screening', source: 'Referral · Doug', notes: 'Clinical informatics. AU pharma side.' },
    { firstName: 'Tahlia', lastName: 'Ng', targetBand: 'fellow' as const, stage: 'offer', source: 'Applied via website' },
    { firstName: 'Sam', lastName: 'Anderson', targetBand: 'consultant' as const, stage: 'interviewing', source: 'LinkedIn', notes: '4 yrs Bain. Open to AU move.' },
    { firstName: 'Priya', lastName: 'Chandra', targetBand: 'analyst' as const, stage: 'lead', source: 'University careers fair' },
    { firstName: 'Marcus', lastName: 'Liu', targetBand: 'consultant' as const, stage: 'screening', source: 'Referral · Will' },
    // One nixed example so the rightmost column isn't empty
    { firstName: 'Jordan', lastName: 'Reeves', targetBand: 'fellow' as const, stage: 'nixed', source: 'LinkedIn', notes: 'Withdrew after first screen — accepted offer elsewhere.', nixed: true },
  ];

  for (const s of samples) {
    await prisma.recruitProspect.create({
      data: {
        firstName: s.firstName,
        lastName: s.lastName,
        targetBand: s.targetBand,
        stage: s.nixed ? null : s.stage,
        source: s.source,
        notes: s.notes ?? null,
        ownerId: tt.id,
        status: s.nixed ? 'nixed' : 'active',
        closedAt: s.nixed ? new Date() : null,
      },
    });
  }
  console.log(`Seeded ${samples.length} sample prospects.`);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
