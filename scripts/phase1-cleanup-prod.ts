/**
 * Phase 1 — destructive cleanup of Foundry Ops project / commercial data
 * in prod Supabase. Mirror of scripts/phase1-cleanup.sql in TypeScript so
 * the same cleanup can be run from the laptop when a real DATABASE_URL is
 * available locally (e.g. via `vercel env pull .env.prod` or pasted in).
 *
 * KEEPS:  Person, AuditEvent, Integration, FeatureFlag, RateCard,
 *         ApprovalPolicy.
 *
 * DELETES (FK-safe order, single transaction):
 *   TimesheetEntry → Approval → Expense → Bill → InvoiceLine → Milestone →
 *   Invoice → Project (cascades ProjectTeam / ProjectChecklist+Item /
 *   ProjectBudget+Line / ProjectPartnerContribution / Risk) →
 *   Deal (cascades DealContact) → RecruitProspect → Client.
 *
 * Also clears Navan + Xero sync watermarks so the next pull is a full
 * resync.
 *
 * Run:
 *   pnpm dlx dotenv -e .env.prod -- pnpm tsx scripts/phase1-cleanup-prod.ts --confirm
 *
 * Without --confirm the script prints before-counts and aborts (dry-run).
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

type CountRow = { name: string; rows: number };

async function countAll(): Promise<{
  deletables: CountRow[];
  preserved: CountRow[];
}> {
  const [
    timesheet,
    approval,
    expense,
    bill,
    invoiceLine,
    milestone,
    invoice,
    projectTeam,
    projectChecklistItem,
    projectChecklist,
    projectBudgetLine,
    projectBudget,
    projectPartner,
    risk,
    project,
    dealContact,
    deal,
    recruit,
    client,
    person,
    audit,
    integration,
    rateCard,
    approvalPolicy,
    featureFlag,
  ] = await Promise.all([
    prisma.timesheetEntry.count(),
    prisma.approval.count(),
    prisma.expense.count(),
    prisma.bill.count(),
    prisma.invoiceLine.count(),
    prisma.milestone.count(),
    prisma.invoice.count(),
    prisma.projectTeam.count(),
    prisma.projectChecklistItem.count(),
    prisma.projectChecklist.count(),
    prisma.projectBudgetLine.count(),
    prisma.projectBudget.count(),
    prisma.projectPartnerContribution.count(),
    prisma.risk.count(),
    prisma.project.count(),
    prisma.dealContact.count(),
    prisma.deal.count(),
    prisma.recruitProspect.count(),
    prisma.client.count(),
    prisma.person.count(),
    prisma.auditEvent.count(),
    prisma.integration.count(),
    prisma.rateCard.count(),
    prisma.approvalPolicy.count(),
    prisma.featureFlag.count(),
  ]);
  return {
    deletables: [
      { name: 'TimesheetEntry', rows: timesheet },
      { name: 'Approval', rows: approval },
      { name: 'Expense', rows: expense },
      { name: 'Bill', rows: bill },
      { name: 'InvoiceLine', rows: invoiceLine },
      { name: 'Milestone', rows: milestone },
      { name: 'Invoice', rows: invoice },
      { name: 'ProjectTeam', rows: projectTeam },
      { name: 'ProjectChecklistItem', rows: projectChecklistItem },
      { name: 'ProjectChecklist', rows: projectChecklist },
      { name: 'ProjectBudgetLine', rows: projectBudgetLine },
      { name: 'ProjectBudget', rows: projectBudget },
      { name: 'ProjectPartnerContribution', rows: projectPartner },
      { name: 'Risk', rows: risk },
      { name: 'Project', rows: project },
      { name: 'DealContact', rows: dealContact },
      { name: 'Deal', rows: deal },
      { name: 'RecruitProspect', rows: recruit },
      { name: 'Client', rows: client },
    ],
    preserved: [
      { name: 'Person', rows: person },
      { name: 'AuditEvent', rows: audit },
      { name: 'Integration', rows: integration },
      { name: 'RateCard', rows: rateCard },
      { name: 'ApprovalPolicy', rows: approvalPolicy },
      { name: 'FeatureFlag', rows: featureFlag },
    ],
  };
}

function printTable(title: string, rows: CountRow[]): void {
  console.log(`── ${title} ${''.padEnd(40 - title.length, '─')}`);
  for (const r of rows) {
    console.log(`  ${r.name.padEnd(32)} ${String(r.rows).padStart(8)}`);
  }
}

async function main(): Promise<void> {
  const confirmed = process.argv.includes('--confirm');

  console.log('Phase 1 cleanup — connected to:', process.env.DATABASE_URL?.split('@')[1] ?? '(unknown)');
  console.log();

  const before = await countAll();
  printTable('before counts (to delete)', before.deletables);
  printTable('preserved (must not change)', before.preserved);

  if (!confirmed) {
    console.log();
    console.log('Dry-run — re-run with --confirm to actually delete.');
    return;
  }

  console.log();
  console.log('--confirm passed — applying deletes in a single transaction…');

  await prisma.$transaction(
    async (tx) => {
      // Order matches the SQL script — see comments there.
      await tx.timesheetEntry.deleteMany();
      await tx.approval.deleteMany();
      await tx.expense.deleteMany();
      await tx.bill.deleteMany();
      await tx.invoiceLine.deleteMany();
      await tx.milestone.deleteMany();
      await tx.invoice.deleteMany();
      // Project's children cascade — wiping Project takes ProjectTeam,
      // ProjectChecklist+Item, ProjectBudget+Line,
      // ProjectPartnerContribution, Risk with it.
      await tx.project.deleteMany();
      // Deal cascades DealContact.
      await tx.deal.deleteMany();
      await tx.recruitProspect.deleteMany();
      await tx.client.deleteMany();

      // Reset sync watermarks. Strip per-feed cursors from Navan config;
      // clear lastSyncAt on both Navan and Xero. Tokens preserved.
      const navan = await tx.integration.findUnique({ where: { kind: 'navan' } });
      if (navan) {
        const cfg = (navan.config ?? {}) as Record<string, unknown>;
        delete cfg.lastBookingSyncedAt;
        delete cfg.lastExpenseSyncedAt;
        await tx.integration.update({
          where: { kind: 'navan' },
          data: { lastSyncAt: null, config: cfg as object },
        });
      }
      const xero = await tx.integration.findUnique({ where: { kind: 'xero' } });
      if (xero) {
        await tx.integration.update({
          where: { kind: 'xero' },
          data: { lastSyncAt: null },
        });
      }
    },
    { timeout: 60_000 },
  );

  console.log('Transaction committed. Re-counting…');
  console.log();
  const after = await countAll();
  printTable('after counts (expect all 0)', after.deletables);
  printTable('preserved (must match before)', after.preserved);

  const collateral = after.preserved.filter(
    (a) => before.preserved.find((b) => b.name === a.name)?.rows !== a.rows,
  );
  if (collateral.length > 0) {
    console.error('⚠ preserved row counts changed — investigate:', collateral);
    process.exit(1);
  }
  const stillThere = after.deletables.filter((a) => a.rows > 0);
  if (stillThere.length > 0) {
    console.error('⚠ some target tables still have rows:', stillThere);
    process.exit(1);
  }
  console.log('clean.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
