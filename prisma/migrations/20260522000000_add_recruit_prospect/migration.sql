-- Recruitment pipeline — RecruitProspect model + supporting enums.
-- Mirrors the BD pipeline shape (kanban-style) but for prospective
-- hires instead of deals. Super-admin only at the surface level;
-- ACL enforced at the route handler via the recruit.manage capability.

CREATE TYPE "RecruitTargetBand" AS ENUM (
  'analyst',
  'consultant',
  'fellow',
  'expert',
  'senior_leader'
);

CREATE TYPE "RecruitStatus" AS ENUM (
  'active',
  'nixed',
  'converted'
);

CREATE TABLE "RecruitProspect" (
  "id"               TEXT PRIMARY KEY,
  "firstName"        TEXT NOT NULL,
  "lastName"         TEXT NOT NULL,
  "email"            TEXT,
  "phone"            TEXT,
  "location"         TEXT,
  "targetBand"       "RecruitTargetBand" NOT NULL,
  "status"           "RecruitStatus" NOT NULL DEFAULT 'active',
  "stage"            TEXT,
  "source"           TEXT,
  "referredById"     TEXT,
  "ownerId"          TEXT NOT NULL,
  "notes"            TEXT,
  "linkedinUrl"      TEXT,
  "cvSharepointUrl"  TEXT,
  "linkedPersonId"   TEXT UNIQUE,
  "closedAt"         TIMESTAMP(3),
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL,

  CONSTRAINT "RecruitProspect_referredById_fkey"
    FOREIGN KEY ("referredById") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "RecruitProspect_ownerId_fkey"
    FOREIGN KEY ("ownerId") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "RecruitProspect_linkedPersonId_fkey"
    FOREIGN KEY ("linkedPersonId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "RecruitProspect_status_targetBand_idx" ON "RecruitProspect"("status", "targetBand");
CREATE INDEX "RecruitProspect_ownerId_idx" ON "RecruitProspect"("ownerId");
