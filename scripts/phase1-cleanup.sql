-- ============================================================================
-- Phase 1 — Foundry Ops data cleanup (destructive)
-- ============================================================================
--
-- Wipes all project / commercial data from prod Supabase so we can reimport
-- the Foundry Master Project Tracker fresh. Single transaction — rolls back
-- cleanly if any statement fails.
--
-- KEEP (untouched by this script):
--   Person, AuditEvent, Integration, FeatureFlag, RateCard, ApprovalPolicy
--
-- DELETE (in FK dependency order):
--   TimesheetEntry → Approval → Expense → Bill → InvoiceLine → Milestone →
--   Invoice → (Project cascades: ProjectTeam, ProjectChecklist+Item,
--   ProjectBudget+Line, ProjectPartnerContribution, Risk) → Project →
--   DealContact (cascade) → Deal → RecruitProspect → Client.
--
-- Notes on the original delete list in the task spec:
--   - No `BillLineItem` table exists (Bill is flat with amountTotal + gst).
--   - `InvoiceLineItem` is named `InvoiceLine` in the schema.
--   - `ProjectRisk` is named `Risk` in the schema.
-- These are clarifications, not changes to scope.
--
-- Also resets Navan + Xero sync watermarks so the next sync re-pulls cleanly.
-- (Uber not listed in the spec — left intact; flag if also wanted.)
--
-- Usage:
--   1. Run scripts/phase1-counts.sql FIRST to capture the before counts.
--   2. Run this file. RAISE NOTICE prints will appear under the "Results"
--      tab in Supabase SQL editor (the Messages panel).
--   3. Run scripts/phase1-counts.sql AGAIN to confirm the after counts —
--      all delete-target tables should be 0; preserved tables unchanged.

BEGIN;

DO $$
DECLARE
  before_timesheet                   bigint;
  before_approval                    bigint;
  before_expense                     bigint;
  before_bill                        bigint;
  before_invoiceline                 bigint;
  before_milestone                   bigint;
  before_invoice                     bigint;
  before_project_team                bigint;
  before_project_checklist_item      bigint;
  before_project_checklist           bigint;
  before_project_budget_line         bigint;
  before_project_budget              bigint;
  before_project_partner             bigint;
  before_risk                        bigint;
  before_project                     bigint;
  before_dealcontact                 bigint;
  before_deal                        bigint;
  before_recruit                     bigint;
  before_client                      bigint;

  preserved_person                   bigint;
  preserved_audit                    bigint;
  preserved_integration              bigint;
  preserved_ratecard                 bigint;
  preserved_approvalpolicy           bigint;
  preserved_featureflag              bigint;
BEGIN
  -- ── Capture before counts ────────────────────────────────────────────
  SELECT count(*) INTO before_timesheet              FROM "TimesheetEntry";
  SELECT count(*) INTO before_approval               FROM "Approval";
  SELECT count(*) INTO before_expense                FROM "Expense";
  SELECT count(*) INTO before_bill                   FROM "Bill";
  SELECT count(*) INTO before_invoiceline            FROM "InvoiceLine";
  SELECT count(*) INTO before_milestone              FROM "Milestone";
  SELECT count(*) INTO before_invoice                FROM "Invoice";
  SELECT count(*) INTO before_project_team           FROM "ProjectTeam";
  SELECT count(*) INTO before_project_checklist_item FROM "ProjectChecklistItem";
  SELECT count(*) INTO before_project_checklist      FROM "ProjectChecklist";
  SELECT count(*) INTO before_project_budget_line    FROM "ProjectBudgetLine";
  SELECT count(*) INTO before_project_budget         FROM "ProjectBudget";
  SELECT count(*) INTO before_project_partner        FROM "ProjectPartnerContribution";
  SELECT count(*) INTO before_risk                   FROM "Risk";
  SELECT count(*) INTO before_project                FROM "Project";
  SELECT count(*) INTO before_dealcontact            FROM "DealContact";
  SELECT count(*) INTO before_deal                   FROM "Deal";
  SELECT count(*) INTO before_recruit                FROM "RecruitProspect";
  SELECT count(*) INTO before_client                 FROM "Client";

  SELECT count(*) INTO preserved_person              FROM "Person";
  SELECT count(*) INTO preserved_audit               FROM "AuditEvent";
  SELECT count(*) INTO preserved_integration         FROM "Integration";
  SELECT count(*) INTO preserved_ratecard            FROM "RateCard";
  SELECT count(*) INTO preserved_approvalpolicy     FROM "ApprovalPolicy";
  SELECT count(*) INTO preserved_featureflag        FROM "FeatureFlag";

  RAISE NOTICE '── before counts (to delete) ─────────────────────';
  RAISE NOTICE 'TimesheetEntry              %', before_timesheet;
  RAISE NOTICE 'Approval                    %', before_approval;
  RAISE NOTICE 'Expense                     %', before_expense;
  RAISE NOTICE 'Bill                        %', before_bill;
  RAISE NOTICE 'InvoiceLine                 %', before_invoiceline;
  RAISE NOTICE 'Milestone                   %', before_milestone;
  RAISE NOTICE 'Invoice                     %', before_invoice;
  RAISE NOTICE 'ProjectTeam                 %', before_project_team;
  RAISE NOTICE 'ProjectChecklistItem        %', before_project_checklist_item;
  RAISE NOTICE 'ProjectChecklist            %', before_project_checklist;
  RAISE NOTICE 'ProjectBudgetLine           %', before_project_budget_line;
  RAISE NOTICE 'ProjectBudget               %', before_project_budget;
  RAISE NOTICE 'ProjectPartnerContribution  %', before_project_partner;
  RAISE NOTICE 'Risk                        %', before_risk;
  RAISE NOTICE 'Project                     %', before_project;
  RAISE NOTICE 'DealContact                 %', before_dealcontact;
  RAISE NOTICE 'Deal                        %', before_deal;
  RAISE NOTICE 'RecruitProspect             %', before_recruit;
  RAISE NOTICE 'Client                      %', before_client;
  RAISE NOTICE '── preserved (must not change) ───────────────────';
  RAISE NOTICE 'Person                      %', preserved_person;
  RAISE NOTICE 'AuditEvent                  %', preserved_audit;
  RAISE NOTICE 'Integration                 %', preserved_integration;
  RAISE NOTICE 'RateCard                    %', preserved_ratecard;
  RAISE NOTICE 'ApprovalPolicy              %', preserved_approvalpolicy;
  RAISE NOTICE 'FeatureFlag                 %', preserved_featureflag;

  -- ── Deletes (FK-safe order) ──────────────────────────────────────────
  --
  -- TimesheetEntry → Project (no cascade) and Invoice (no cascade). Must
  -- die first so nothing in the project/invoice paths blocks.
  DELETE FROM "TimesheetEntry";

  -- Approval is polymorphic on (subjectType, subjectId); no real FK to
  -- the entities below. We delete it whole — start fresh on rebuild.
  DELETE FROM "Approval";

  -- Expense → Project (optional, no cascade), Person, AgentRun.
  DELETE FROM "Expense";

  -- Bill → Project (optional, no cascade), Supplier, PayRun (none expected
  -- in prod yet).
  DELETE FROM "Bill";

  -- InvoiceLine cascades from Invoice, but explicit DELETE keeps the row
  -- count message accurate.
  DELETE FROM "InvoiceLine";

  -- Milestone has Invoice FK (no cascade) — delete before Invoice.
  DELETE FROM "Milestone";

  -- Invoice → Project, Client.
  DELETE FROM "Invoice";

  -- Project's other children all cascade on delete, so wiping Project
  -- takes ProjectTeam / ProjectChecklist+Item / ProjectBudget+Line /
  -- ProjectPartnerContribution / Risk with it. Listed explicitly only
  -- to surface unambiguous counts in the after-pass.
  DELETE FROM "Project";

  -- Deal: DealContact cascades on delete from Deal.
  DELETE FROM "Deal";

  -- RecruitProspect → Person only; safe to wipe.
  DELETE FROM "RecruitProspect";

  -- Client: last, after everything that referenced it is gone.
  DELETE FROM "Client";

  -- ── Reset sync watermarks ────────────────────────────────────────────
  --
  -- Navan: strip the per-feed watermark keys from config so the next sync
  -- starts from the configured backstop (2000-01-01 for expenses; nothing
  -- for bookings, which means full re-pull). Preserve tokens / credentials.
  UPDATE "Integration"
     SET "lastSyncAt" = NULL,
         "config"     = COALESCE("config", '{}'::jsonb) - 'lastBookingSyncedAt' - 'lastExpenseSyncedAt'
   WHERE "kind" = 'navan';

  -- Xero: no per-feed cursor in config — clearing lastSyncAt is enough.
  -- Tokens preserved.
  UPDATE "Integration"
     SET "lastSyncAt" = NULL
   WHERE "kind" = 'xero';

  -- ── After counts ─────────────────────────────────────────────────────
  SELECT count(*) INTO before_timesheet              FROM "TimesheetEntry";
  SELECT count(*) INTO before_approval               FROM "Approval";
  SELECT count(*) INTO before_expense                FROM "Expense";
  SELECT count(*) INTO before_bill                   FROM "Bill";
  SELECT count(*) INTO before_invoiceline            FROM "InvoiceLine";
  SELECT count(*) INTO before_milestone              FROM "Milestone";
  SELECT count(*) INTO before_invoice                FROM "Invoice";
  SELECT count(*) INTO before_project_team           FROM "ProjectTeam";
  SELECT count(*) INTO before_project_checklist_item FROM "ProjectChecklistItem";
  SELECT count(*) INTO before_project_checklist      FROM "ProjectChecklist";
  SELECT count(*) INTO before_project_budget_line    FROM "ProjectBudgetLine";
  SELECT count(*) INTO before_project_budget         FROM "ProjectBudget";
  SELECT count(*) INTO before_project_partner        FROM "ProjectPartnerContribution";
  SELECT count(*) INTO before_risk                   FROM "Risk";
  SELECT count(*) INTO before_project                FROM "Project";
  SELECT count(*) INTO before_dealcontact            FROM "DealContact";
  SELECT count(*) INTO before_deal                   FROM "Deal";
  SELECT count(*) INTO before_recruit                FROM "RecruitProspect";
  SELECT count(*) INTO before_client                 FROM "Client";

  RAISE NOTICE '── after counts (expect all 0) ───────────────────';
  RAISE NOTICE 'TimesheetEntry              %', before_timesheet;
  RAISE NOTICE 'Approval                    %', before_approval;
  RAISE NOTICE 'Expense                     %', before_expense;
  RAISE NOTICE 'Bill                        %', before_bill;
  RAISE NOTICE 'InvoiceLine                 %', before_invoiceline;
  RAISE NOTICE 'Milestone                   %', before_milestone;
  RAISE NOTICE 'Invoice                     %', before_invoice;
  RAISE NOTICE 'ProjectTeam                 %', before_project_team;
  RAISE NOTICE 'ProjectChecklistItem        %', before_project_checklist_item;
  RAISE NOTICE 'ProjectChecklist            %', before_project_checklist;
  RAISE NOTICE 'ProjectBudgetLine           %', before_project_budget_line;
  RAISE NOTICE 'ProjectBudget               %', before_project_budget;
  RAISE NOTICE 'ProjectPartnerContribution  %', before_project_partner;
  RAISE NOTICE 'Risk                        %', before_risk;
  RAISE NOTICE 'Project                     %', before_project;
  RAISE NOTICE 'DealContact                 %', before_dealcontact;
  RAISE NOTICE 'Deal                        %', before_deal;
  RAISE NOTICE 'RecruitProspect             %', before_recruit;
  RAISE NOTICE 'Client                      %', before_client;

  -- Re-check preserved tables — confirm nothing collateral was touched.
  SELECT count(*) INTO preserved_person          FROM "Person";
  SELECT count(*) INTO preserved_audit           FROM "AuditEvent";
  SELECT count(*) INTO preserved_integration     FROM "Integration";
  SELECT count(*) INTO preserved_ratecard        FROM "RateCard";
  SELECT count(*) INTO preserved_approvalpolicy  FROM "ApprovalPolicy";
  SELECT count(*) INTO preserved_featureflag     FROM "FeatureFlag";

  RAISE NOTICE '── preserved (must match before) ─────────────────';
  RAISE NOTICE 'Person                      %', preserved_person;
  RAISE NOTICE 'AuditEvent                  %', preserved_audit;
  RAISE NOTICE 'Integration                 %', preserved_integration;
  RAISE NOTICE 'RateCard                    %', preserved_ratecard;
  RAISE NOTICE 'ApprovalPolicy              %', preserved_approvalpolicy;
  RAISE NOTICE 'FeatureFlag                 %', preserved_featureflag;
END
$$ LANGUAGE plpgsql;

-- Final safety: a single bad delete above raises and the whole block
-- rolls back. Change to COMMIT to apply.
COMMIT;
-- ROLLBACK;  -- uncomment + comment COMMIT to dry-run inside Supabase
