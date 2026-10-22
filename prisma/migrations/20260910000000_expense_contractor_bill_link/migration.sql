-- TASK-509 — contractor expenses on the period invoice.
--
-- Expense gains its own AP-leg FK, mirroring TimesheetEntry.contractorBillId
-- from TASK-500 and for the same reason: the leg that pays the contractor
-- needs a dedicated marker rather than overloading a status column, so it
-- cannot interfere with the AR leg (`rebilledOnInvoiceId`) that recharges the
-- client. The same flight is legitimately both a cost in and revenue out.
--
-- Setting contractorBillId removes the expense from the reimbursement float:
-- it is being paid on the invoice instead, so `/reimbursables` and the pay
-- run both skip it. Without that the cost goes out twice.
--
-- TimesheetPeriod gains a frozen expense snapshot alongside the frozen rate.
-- D3 (TT 2026-09-10) is PASS-THROUGH: the contractor invoices the full
-- GST-inclusive amount and adds no GST of their own on these lines; Foundry
-- claims the input credit. draftExpenseTotalCents is therefore GST-INCLUSIVE
-- and draftExpenseGstCents is the component within it, not a figure added on
-- top.
--
-- Purely additive: new nullable columns and one FK. Safe to apply ahead of
-- the code that uses it.

ALTER TABLE "Expense" ADD COLUMN "contractorBillId" TEXT;

CREATE INDEX "Expense_contractorBillId_idx" ON "Expense"("contractorBillId");

-- SET NULL so deleting a draft contractor bill returns its expenses to the
-- reimbursement float, matching how TimesheetEntry hours are released.
ALTER TABLE "Expense"
  ADD CONSTRAINT "Expense_contractorBillId_fkey"
  FOREIGN KEY ("contractorBillId") REFERENCES "Bill"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "TimesheetPeriod" ADD COLUMN "draftExpenseTotalCents" INTEGER;
ALTER TABLE "TimesheetPeriod" ADD COLUMN "draftExpenseGstCents" INTEGER;
ALTER TABLE "TimesheetPeriod" ADD COLUMN "draftExpenseCount" INTEGER;
