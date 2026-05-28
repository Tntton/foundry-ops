-- Add Associate Partner / Director as a new role + band. Junior to
-- partner — no scorecard visibility but full project-leadership
-- + invoice-approval authority. Run as two ALTERs because Postgres
-- can't add multiple enum values in a single statement.
ALTER TYPE "Role" ADD VALUE 'associate_partner';
ALTER TYPE "Band" ADD VALUE 'Associate_Partner';
