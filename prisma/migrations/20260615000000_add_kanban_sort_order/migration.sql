-- Within-column kanban ranking (TASK-303).
-- Both surfaces (Projects + BD) get a per-stage int rank renumbered on
-- every reorder. Default 0 means "unranked / freshly created"; the
-- list queries order by sortOrder ASC and push 0s to the bottom so a
-- new card never elbows ahead of a ranked one.

ALTER TABLE "Project" ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Deal"    ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 0;

-- Backfill existing rows so the initial render matches what the team
-- sees today.
--
-- Projects: alphabetical by code within each stage (matches the
-- legacy `orderBy: [stage, code]` in listProjects).
UPDATE "Project" SET "sortOrder" = sub.rn
FROM (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY stage ORDER BY code) AS rn
  FROM "Project"
) AS sub
WHERE "Project".id = sub.id;

-- Deals: target close date (soonest first), createdAt as fallback so
-- undated deals fall in by age. Matches what partners eyeball as the
-- de-facto priority today.
UPDATE "Deal" SET "sortOrder" = sub.rn
FROM (
  SELECT id, ROW_NUMBER() OVER (
    PARTITION BY stage
    ORDER BY COALESCE("targetCloseDate", "createdAt") DESC
  ) AS rn
  FROM "Deal"
) AS sub
WHERE "Deal".id = sub.id;
