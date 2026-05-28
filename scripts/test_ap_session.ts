import { prisma } from '@/server/db';
import { hasCapability } from '@/server/capabilities';
import { hasAnyRole } from '@/server/roles';
import { listLeaderPendingActions } from '@/server/leader-actions';
import { filterNavForRoles } from '@/components/shell/nav-config';

async function main() {
  const ap = await prisma.person.findFirst({
    where: { roles: { has: 'associate_partner' }, inactiveAt: null },
    select: { id: true, initials: true, firstName: true, lastName: true, email: true, headshotUrl: true, roles: true, band: true, level: true },
  });
  if (!ap) { console.log('No AP found'); return; }
  console.log(`AP sample: ${ap.firstName} ${ap.lastName} · band=${ap.band} · level=${ap.level} · roles=${ap.roles.join(',')}`);

  const session = { person: ap };

  console.log('\n=== Capabilities ===');
  const caps = [
    'invoice.approve.under_20k',
    'invoice.approve.over_20k',
    'invoice.create',
    'expense.approve.under_2k',
    'expense.approve.over_2k',
    'bill.approve',
    'bill.create',
    'project.create',
    'deal.create',
    'ratecard.view',
    'partner.scorecard.view',  // SHOULD BE FALSE
    'integration.manage',
    'timesheet.submit',
  ] as const;
  for (const c of caps) {
    const ok = hasCapability(session as never, c);
    console.log(`  ${ok ? '✓' : '✗'} ${c}`);
  }

  console.log('\n=== Nav visibility (filtered for AP) ===');
  const nav = filterNavForRoles(ap.roles);
  for (const group of nav) {
    console.log(`  [${group.label}]`);
    for (const item of group.items) {
      console.log(`    • ${item.label} → ${item.href}`);
    }
  }

  console.log('\n=== Leader pending actions ===');
  const result = await listLeaderPendingActions(session as never);
  console.log(`  counts: approvals=${result.counts.approvalsQueue} timesheets=${result.counts.timesheetsToApprove} bd=${result.counts.myBdDeals} invoices=${result.counts.invoicesToDraft}`);
  console.log(`  actions: ${result.actions.length}`);
  for (const a of result.actions.slice(0, 5)) {
    console.log(`    [${a.tone}] ${a.title}`);
  }

  // Confirm partner.scorecard is hidden
  const partnerScoreItem = nav.flatMap((g) => g.items).find((i) => i.href === '/partners');
  console.log(`\n=== Partner scorecard nav entry: ${partnerScoreItem ? '⚠ VISIBLE (bug!)' : '✓ hidden (correct)'} ===`);

  // Also verify isLeader includes AP
  const isLeader = hasAnyRole(session as never, ['super_admin', 'admin', 'partner', 'associate_partner', 'manager']);
  console.log(`isLeader check: ${isLeader ? '✓ true' : '✗ false (bug)'}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
