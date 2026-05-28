-- Phase 1 — read-only row counts for tables targeted by the cleanup.
-- Run in Supabase SQL editor BEFORE running phase1-cleanup.sql so we
-- have a known baseline to compare against.

SELECT 'TimesheetEntry'              AS table_name, count(*) AS rows FROM "TimesheetEntry"
UNION ALL SELECT 'Approval',                    count(*) FROM "Approval"
UNION ALL SELECT 'ProjectTeam',                 count(*) FROM "ProjectTeam"
UNION ALL SELECT 'Milestone',                   count(*) FROM "Milestone"
UNION ALL SELECT 'ProjectChecklist',            count(*) FROM "ProjectChecklist"
UNION ALL SELECT 'ProjectChecklistItem',        count(*) FROM "ProjectChecklistItem"
UNION ALL SELECT 'Risk',                        count(*) FROM "Risk"
UNION ALL SELECT 'ProjectBudget',               count(*) FROM "ProjectBudget"
UNION ALL SELECT 'ProjectBudgetLine',           count(*) FROM "ProjectBudgetLine"
UNION ALL SELECT 'ProjectPartnerContribution',  count(*) FROM "ProjectPartnerContribution"
UNION ALL SELECT 'Expense',                     count(*) FROM "Expense"
UNION ALL SELECT 'Bill',                        count(*) FROM "Bill"
UNION ALL SELECT 'Invoice',                     count(*) FROM "Invoice"
UNION ALL SELECT 'InvoiceLine',                 count(*) FROM "InvoiceLine"
UNION ALL SELECT 'Project',                     count(*) FROM "Project"
UNION ALL SELECT 'DealContact',                 count(*) FROM "DealContact"
UNION ALL SELECT 'Deal',                        count(*) FROM "Deal"
UNION ALL SELECT 'RecruitProspect',             count(*) FROM "RecruitProspect"
UNION ALL SELECT 'Client',                      count(*) FROM "Client"
-- Preserved tables — proves nothing here gets touched.
UNION ALL SELECT 'Person (preserved)',          count(*) FROM "Person"
UNION ALL SELECT 'AuditEvent (preserved)',      count(*) FROM "AuditEvent"
UNION ALL SELECT 'Integration (preserved)',     count(*) FROM "Integration"
UNION ALL SELECT 'RateCard (preserved)',        count(*) FROM "RateCard"
UNION ALL SELECT 'ApprovalPolicy (preserved)',  count(*) FROM "ApprovalPolicy"
UNION ALL SELECT 'FeatureFlag (preserved)',     count(*) FROM "FeatureFlag"
ORDER BY table_name;
