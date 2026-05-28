/**
 * Phase 1 — Wipe transactional data so the master-tracker import can
 * load a clean slate. Idempotent + safe to re-run.
 *
 * What it deletes (single transaction, child→parent order):
 *   TimesheetEntry, InvoiceLine, Invoice, Milestone, PayRunLine, PayRun,
 *   Bill, Expense, Approval, Risk, ProjectBudgetLine, ProjectBudget,
 *   ProjectChecklistItem, ProjectChecklist, ProjectPartnerContribution,
 *   ProjectTeam, Project, DealContact, Deal, RecruitProspect, Client,
 *   AvailabilityForecast, DocuSignEnvelope, WhatsAppMessage,
 *   WhatsAppConversation, Notification, UserPreference, UserUpdate,
 *   EducationEntry, WorkHistoryEntry, BankTransaction, MagicLink, Person
 *   (except TT, matched by email = trung@foundry.health).
 *
 * What it KEEPS:
 *   AuditEvent (history — actorId is nulled for deleted Persons so the
 *   FK stays valid), Integration, FeatureFlag, RateCard, OpexLine,
 *   PartnerPool, AgentRun, LLMCall, ApprovalPolicy.
 *
 * Watermark reset: Integration.lastSyncAt set to NULL for
 *   navan, xero, uber so the next sync re-pulls from scratch.
 *
 * Usage:
 *   pnpm tsx scripts/cleanup_for_master_tracker_import.ts            # show counts only (default safe mode)
 *   pnpm tsx scripts/cleanup_for_master_tracker_import.ts --execute  # actually run it
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const TT_EMAIL = 'trung@foundry.health';

type CountFn = () => Promise<number>;

const COUNT_TABLES: Array<[string, CountFn]> = [
  ['TimesheetEntry', () => prisma.timesheetEntry.count()],
  ['InvoiceLine', () => prisma.invoiceLine.count()],
  ['Invoice', () => prisma.invoice.count()],
  ['Milestone', () => prisma.milestone.count()],
  ['PayRunLine', () => prisma.payRunLine.count()],
  ['PayRun', () => prisma.payRun.count()],
  ['Bill', () => prisma.bill.count()],
  ['Expense', () => prisma.expense.count()],
  ['Approval', () => prisma.approval.count()],
  ['Risk', () => prisma.risk.count()],
  ['ProjectBudgetLine', () => prisma.projectBudgetLine.count()],
  ['ProjectBudget', () => prisma.projectBudget.count()],
  ['ProjectChecklistItem', () => prisma.projectChecklistItem.count()],
  ['ProjectChecklist', () => prisma.projectChecklist.count()],
  ['ProjectPartnerContribution', () => prisma.projectPartnerContribution.count()],
  ['ProjectTeam', () => prisma.projectTeam.count()],
  ['Project', () => prisma.project.count()],
  ['DealContact', () => prisma.dealContact.count()],
  ['Deal', () => prisma.deal.count()],
  ['RecruitProspect', () => prisma.recruitProspect.count()],
  ['Client', () => prisma.client.count()],
  ['AvailabilityForecast', () => prisma.availabilityForecast.count()],
  ['DocuSignEnvelope', () => prisma.docuSignEnvelope.count()],
  ['WhatsAppMessage', () => prisma.whatsAppMessage.count()],
  ['WhatsAppConversation', () => prisma.whatsAppConversation.count()],
  ['Notification', () => prisma.notification.count()],
  ['UserPreference', () => prisma.userPreference.count()],
  ['UserUpdate', () => prisma.userUpdate.count()],
  ['EducationEntry', () => prisma.educationEntry.count()],
  ['WorkHistoryEntry', () => prisma.workHistoryEntry.count()],
  ['BankTransaction', () => prisma.bankTransaction.count()],
  ['MagicLink', () => prisma.magicLink.count()],
  ['Person', () => prisma.person.count()],
  ['AuditEvent (preserved)', () => prisma.auditEvent.count()],
  ['Integration (preserved)', () => prisma.integration.count()],
  ['FeatureFlag (preserved)', () => prisma.featureFlag.count()],
  ['RateCard (preserved)', () => prisma.rateCard.count()],
];

async function snapshot(label: string) {
  console.log(`\n── ${label} ──`);
  const out: Record<string, number> = {};
  for (const [name, fn] of COUNT_TABLES) {
    out[name] = await fn();
    console.log(`  ${name.padEnd(34)} ${out[name]}`);
  }
  return out;
}

async function main() {
  const execute = process.argv.includes('--execute');
  await snapshot('BEFORE');

  if (!execute) {
    console.log('\n(dry-run — pass --execute to perform the cleanup)');
    return;
  }

  const tt = await prisma.person.findUnique({
    where: { email: TT_EMAIL },
    select: { id: true, initials: true, firstName: true, lastName: true },
  });
  if (!tt) {
    console.error(`\nABORT: TT not found (email ${TT_EMAIL}).`);
    process.exit(1);
  }
  console.log(`\nTT preserved: ${tt.firstName} ${tt.lastName} (${tt.initials}) ${tt.id}`);

  console.log('\nrunning cleanup transaction…');
  await prisma.$transaction(
    async (tx) => {
      // Child rows that reference the entities below — order matters.
      await tx.timesheetEntry.deleteMany({});
      await tx.invoiceLine.deleteMany({});
      await tx.invoice.deleteMany({});
      await tx.milestone.deleteMany({});
      await tx.payRunLine.deleteMany({});
      await tx.payRun.deleteMany({});
      await tx.bill.deleteMany({});
      await tx.expense.deleteMany({});
      await tx.approval.deleteMany({});
      await tx.risk.deleteMany({});
      await tx.projectBudgetLine.deleteMany({});
      await tx.projectBudget.deleteMany({});
      await tx.projectChecklistItem.deleteMany({});
      await tx.projectChecklist.deleteMany({});
      await tx.projectPartnerContribution.deleteMany({});
      await tx.projectTeam.deleteMany({});
      await tx.project.deleteMany({});
      await tx.dealContact.deleteMany({});
      await tx.deal.deleteMany({});
      await tx.recruitProspect.deleteMany({});
      await tx.client.deleteMany({});

      // Person-referencing tables — drop before nuking non-TT people.
      await tx.availabilityForecast.deleteMany({});
      await tx.docuSignEnvelope.deleteMany({});
      await tx.whatsAppMessage.deleteMany({});
      await tx.whatsAppConversation.deleteMany({});
      await tx.notification.deleteMany({});
      await tx.userPreference.deleteMany({});
      await tx.userUpdate.deleteMany({});
      await tx.educationEntry.deleteMany({});
      await tx.workHistoryEntry.deleteMany({});
      await tx.bankTransaction.deleteMany({});
      await tx.magicLink.deleteMany({});

      // AuditEvent stays — null out actors that point at people about to be deleted.
      await tx.auditEvent.updateMany({
        where: { actorId: { not: tt.id } },
        data: { actorId: null },
      });

      // Person — keep TT only.
      const deleted = await tx.person.deleteMany({
        where: { email: { not: TT_EMAIL } },
      });
      console.log(`  deleted persons: ${deleted.count}`);

      // Reset Navan / Xero / Uber sync watermarks.
      await tx.integration.updateMany({
        where: { kind: { in: ['navan', 'xero', 'uber'] } },
        data: { lastSyncAt: null },
      });
    },
    { timeout: 120_000, maxWait: 30_000 },
  );

  await snapshot('AFTER');
  console.log('\ndone.');
}

main()
  .catch((err) => {
    console.error('FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
