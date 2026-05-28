import { prisma } from '@/server/db';
import { listLeaderPendingActions } from '@/server/leader-actions';

async function asSession(email: string) {
  const person = await prisma.person.findUnique({
    where: { email },
    select: { id: true, initials: true, firstName: true, lastName: true, email: true, roles: true, headshotUrl: true },
  });
  if (!person) return null;
  return { person };
}

async function main() {
  for (const email of ['trung@foundry.health', 'jas@foundry.health', 'adrian@foundry.health', 'michael@foundry.health']) {
    const session = await asSession(email);
    if (!session) { console.log(`No user ${email}`); continue; }
    const result = await listLeaderPendingActions(session as never);
    console.log(`\n=== ${session.person.firstName} ${session.person.lastName} (${session.person.roles.join(',')}) ===`);
    console.log(`  counts: approvals=${result.counts.approvalsQueue} timesheets=${result.counts.timesheetsToApprove} bdDeals=${result.counts.myBdDeals} invoicesToDraft=${result.counts.invoicesToDraft}`);
    console.log(`  actions (${result.actions.length}):`);
    for (const a of result.actions.slice(0, 8)) {
      console.log(`    [${a.tone}] ${a.kind}`);
      console.log(`      ${a.title}`);
      console.log(`      → ${a.href}`);
    }
    if (result.actions.length > 8) console.log(`    ... +${result.actions.length - 8} more`);
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
