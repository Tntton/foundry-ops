import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '@/server/db';
import { writeAudit } from '@/server/audit';
import { isLeadershipBand } from '@/lib/levels';
import { parseCsv, requireHeaders } from './csv-parse';

const FOUNDRY_SUFFIX = '@foundry.health';

const BANDS = ['MP', 'Partner', 'Associate_Partner', 'Expert', 'Consultant', 'Analyst', 'Support_Staff'] as const;
const ROLE_ENUM = ['super_admin', 'admin', 'partner', 'associate_partner', 'manager', 'staff'] as const;

export const REQUIRED_PERSONNEL_HEADERS = [
  'email',
  'firstname',
  'lastname',
  'band',
  'level',
  'employment',
  'region',
  'rateunit',
  'ratedollars',
  'startdate',
] as const;

const optionalString = z
  .string()
  .trim()
  .max(500)
  .optional()
  .transform((v) => (v ? v : null))
  .nullable();

/** Row-level Zod schema. Header keys are already lowercased + trimmed. */
const PersonnelRowSchema = z
  .object({
    email: z.string().trim().toLowerCase().email(),
    firstname: z.string().trim().min(1).max(120),
    lastname: z.string().trim().min(1).max(120),
    band: z.enum(BANDS),
    level: z.string().trim().min(1).max(10),
    employment: z.enum(['ft', 'contractor']),
    region: z.enum(['AU', 'NZ']),
    rateunit: z.enum(['hour', 'day']),
    ratedollars: z.coerce.number().min(0).max(10_000),
    startdate: z.coerce.date(),
    phone: optionalString,
    whatsappnumber: optionalString,
    personalemail: z
      .string()
      .trim()
      .toLowerCase()
      .transform((v) => (v ? v : null))
      .pipe(z.string().email().nullable())
      .nullable()
      .optional(),
    linkedinurl: optionalString,
    fte: z
      .union([z.literal(''), z.coerce.number().min(0.1).max(1.0)])
      .optional()
      .transform((v) => (v === '' || v === undefined ? null : v)),
    roles: z
      .string()
      .trim()
      .optional()
      .transform((v) => (v ? v : null))
      .nullable(),
    jobtitle: z.string().trim().max(120).optional().transform((v) => (v ? v : null)).nullable(),
  })
  .passthrough();

export type PersonnelParsedRow = {
  email: string;
  firstName: string;
  lastName: string;
  band: (typeof BANDS)[number];
  level: string;
  employment: 'ft' | 'contractor';
  region: 'AU' | 'NZ';
  rateUnit: 'hour' | 'day';
  rateDollars: number;
  startDate: string; // ISO YYYY-MM-DD
  phone: string | null;
  whatsappNumber: string | null;
  personalEmail: string | null;
  linkedinUrl: string | null;
  fte: number | null;
  roles: Array<(typeof ROLE_ENUM)[number]>;
  jobTitle: string | null;
};

export type PersonnelPreviewRow = {
  /** 1-based index of the source CSV data row (line N+1 in the file). */
  rowIndex: number;
  raw: Record<string, string>;
  /** What the commit step will do for this row. */
  action: 'new' | 'update' | 'error';
  errors: string[];
  parsed: PersonnelParsedRow | null;
  /** For updates: the diff vs the existing Person record. */
  diff: Array<{ field: string; before: string; after: string }>;
  /** For updates: the existing Person.id to update. */
  matchedPersonId: string | null;
};

export type PersonnelPreview = {
  fileName: string;
  totalRows: number;
  newCount: number;
  updateCount: number;
  errorCount: number;
  rows: PersonnelPreviewRow[];
  /** Set when the same email appears twice in the CSV — blocks commit. */
  duplicateEmails: string[];
  /** Top-level validation problems (missing headers, etc.) — blocks commit. */
  topLevelErrors: string[];
};

export type PersonnelParseError = { message: string };

/**
 * Pure form of the existing-Person row that the preview builder cares
 * about. Exposed so the unit test can hand-craft existing-row fixtures
 * without spinning up a Prisma client.
 */
export type ExistingPersonRow = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  band: string;
  level: string;
  employment: string;
  region: string;
  rateUnit: string;
  rate: number;
  startDate: Date | null;
  phone: string | null;
  whatsappNumber: string | null;
  personalEmail: string | null;
  linkedinUrl: string | null;
  fte: { toString: () => string } | null;
  roles: string[];
  initials: string;
};

/**
 * Pure preview builder — no DB calls. Takes the CSV text + a snapshot of
 * existing persons (already resolved by the caller). Split out from
 * `buildPersonnelPreview` so it can be golden-file tested without
 * mocking Prisma.
 */
export function buildPersonnelPreviewWithExisting(
  csvText: string,
  fileName: string,
  existing: readonly ExistingPersonRow[],
): { ok: true; preview: PersonnelPreview } | { ok: false; error: PersonnelParseError } {
  const parsed = parseCsv(csvText);
  if (!parsed.ok) return { ok: false, error: { message: parsed.error.message } };

  const missing = requireHeaders(parsed.data, REQUIRED_PERSONNEL_HEADERS);
  if (missing.length > 0) {
    return {
      ok: false,
      error: {
        message: `CSV is missing required column(s): ${missing.join(', ')}. Download the template and try again.`,
      },
    };
  }

  const existingByEmail = new Map<string, ExistingPersonRow>();
  for (const r of existing) existingByEmail.set(r.email.toLowerCase(), r);

  const previewRows: PersonnelPreviewRow[] = [];
  const seenEmails = new Map<string, number>(); // email → first rowIndex
  const duplicateEmails: string[] = [];

  for (let i = 0; i < parsed.data.rows.length; i++) {
    const raw = parsed.data.rows[i]!;
    const rowIndex = i + 1;
    const errors: string[] = [];

    const result = PersonnelRowSchema.safeParse(raw);
    if (!result.success) {
      for (const issue of result.error.issues) {
        const path = issue.path.length > 0 ? issue.path.join('.') : '(row)';
        errors.push(`${path}: ${issue.message}`);
      }
      previewRows.push({
        rowIndex,
        raw,
        action: 'error',
        errors,
        parsed: null,
        diff: [],
        matchedPersonId: null,
      });
      continue;
    }
    const v = result.data;

    // Per-row business validation that the schema can't express directly.
    const rolesParsed = parseRolesCell(v.roles);
    if (rolesParsed.invalid.length > 0) {
      errors.push(
        `roles: invalid value(s) ${rolesParsed.invalid.join(', ')} (allowed: ${ROLE_ENUM.join(', ')})`,
      );
    }
    if (v.employment === 'ft' && !isLeadershipBand(v.band) && v.fte === null) {
      errors.push('fte: required for ft employees (0.1 – 1.0)');
    }

    const existing = existingByEmail.get(v.email);
    const action: 'new' | 'update' = existing ? 'update' : 'new';

    if (action === 'new' && !v.email.endsWith(FOUNDRY_SUFFIX)) {
      errors.push(`email: new persons must use a ${FOUNDRY_SUFFIX} work email`);
    }
    if (v.personalemail && v.personalemail.endsWith(FOUNDRY_SUFFIX)) {
      errors.push('personalEmail: cannot be a @foundry.health address');
    }
    if (action === 'new' && v.employment === 'contractor' && !v.personalemail) {
      errors.push('personalEmail: required for contractors');
    }

    const seenAt = seenEmails.get(v.email);
    if (seenAt !== undefined) {
      duplicateEmails.push(v.email);
      errors.push(`email: duplicate of row ${seenAt} in this file`);
    } else {
      seenEmails.set(v.email, rowIndex);
    }

    const parsedRow: PersonnelParsedRow = {
      email: v.email,
      firstName: v.firstname,
      lastName: v.lastname,
      band: v.band,
      level: v.level,
      employment: v.employment,
      region: v.region,
      rateUnit: v.rateunit,
      rateDollars: v.ratedollars,
      startDate: v.startdate.toISOString().slice(0, 10),
      phone: v.phone ?? null,
      whatsappNumber: v.whatsappnumber ?? null,
      personalEmail: v.personalemail ?? null,
      linkedinUrl: v.linkedinurl ?? null,
      fte: v.fte ?? null,
      roles: rolesParsed.valid,
      jobTitle: v.jobtitle ?? null,
    };

    let diff: PersonnelPreviewRow['diff'] = [];
    if (action === 'update' && existing) {
      diff = diffAgainstExisting(parsedRow, existing);
    }

    previewRows.push({
      rowIndex,
      raw,
      action: errors.length > 0 ? 'error' : action,
      errors,
      parsed: errors.length > 0 ? null : parsedRow,
      diff,
      matchedPersonId: existing?.id ?? null,
    });
  }

  const newCount = previewRows.filter((r) => r.action === 'new').length;
  const updateCount = previewRows.filter((r) => r.action === 'update').length;
  const errorCount = previewRows.filter((r) => r.action === 'error').length;

  return {
    ok: true,
    preview: {
      fileName,
      totalRows: parsed.data.rows.length,
      newCount,
      updateCount,
      errorCount,
      rows: previewRows,
      duplicateEmails: Array.from(new Set(duplicateEmails)),
      topLevelErrors: [],
    },
  };
}

function parseRolesCell(raw: string | null): {
  valid: Array<(typeof ROLE_ENUM)[number]>;
  invalid: string[];
} {
  if (!raw) return { valid: ['staff'], invalid: [] };
  const tokens = raw
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t.length > 0);
  const valid: Array<(typeof ROLE_ENUM)[number]> = [];
  const invalid: string[] = [];
  for (const t of tokens) {
    if ((ROLE_ENUM as readonly string[]).includes(t)) {
      valid.push(t as (typeof ROLE_ENUM)[number]);
    } else {
      invalid.push(t);
    }
  }
  // De-dupe and keep a stable order.
  const unique = Array.from(new Set(valid)) as Array<(typeof ROLE_ENUM)[number]>;
  // Always ensure at least one role — fallback to staff if user gave only invalid values
  // (the row will still error on invalid, but we keep this defensive for the parsed shape).
  if (unique.length === 0 && invalid.length === 0) unique.push('staff');
  return { valid: unique, invalid };
}

/**
 * Async wrapper that loads existing persons from the DB then delegates to
 * the pure preview builder.
 */
export async function buildPersonnelPreview(
  csvText: string,
  fileName: string,
): Promise<{ ok: true; preview: PersonnelPreview } | { ok: false; error: PersonnelParseError }> {
  // Cheap pre-parse to extract the email column for the lookup — if the
  // parse fails we still bail in the pure builder, just without the DB
  // round-trip.
  const probe = parseCsv(csvText);
  const emails: string[] = [];
  if (probe.ok) {
    for (const r of probe.data.rows) {
      const e = (r['email'] ?? '').trim().toLowerCase();
      if (e) emails.push(e);
    }
  }
  const uniqueEmails = Array.from(new Set(emails));
  const existing = uniqueEmails.length > 0 ? await loadExisting(uniqueEmails) : [];
  return buildPersonnelPreviewWithExisting(csvText, fileName, existing);
}

async function loadExisting(emails: string[]): Promise<ExistingPersonRow[]> {
  const rows = await prisma.person.findMany({
    where: { email: { in: emails, mode: 'insensitive' } },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      band: true,
      level: true,
      employment: true,
      region: true,
      rateUnit: true,
      rate: true,
      startDate: true,
      phone: true,
      whatsappNumber: true,
      personalEmail: true,
      linkedinUrl: true,
      fte: true,
      roles: true,
      initials: true,
    },
  });
  return rows.map((r) => ({
    id: r.id,
    email: r.email,
    firstName: r.firstName,
    lastName: r.lastName,
    band: r.band,
    level: r.level,
    employment: r.employment,
    region: r.region,
    rateUnit: r.rateUnit,
    rate: r.rate,
    startDate: r.startDate ?? null,
    phone: r.phone ?? null,
    whatsappNumber: r.whatsappNumber ?? null,
    personalEmail: r.personalEmail ?? null,
    linkedinUrl: r.linkedinUrl ?? null,
    fte: r.fte ?? null,
    roles: r.roles ?? [],
    initials: r.initials,
  }));
}

function diffAgainstExisting(
  row: PersonnelParsedRow,
  existing: ExistingPersonRow,
): PersonnelPreviewRow['diff'] {
  const diff: PersonnelPreviewRow['diff'] = [];
  const push = (field: string, before: unknown, after: unknown) => {
    const b = String(before ?? '');
    const a = String(after ?? '');
    if (b !== a) diff.push({ field, before: b, after: a });
  };
  push('firstName', existing.firstName, row.firstName);
  push('lastName', existing.lastName, row.lastName);
  push('band', existing.band, row.band);
  push('level', existing.level, row.level);
  push('employment', existing.employment, row.employment);
  push('region', existing.region, row.region);
  push('rateUnit', existing.rateUnit, row.rateUnit);
  push('rate (¢)', existing.rate, Math.round(row.rateDollars * 100));
  push('startDate', existing.startDate?.toISOString().slice(0, 10) ?? '', row.startDate);
  push('phone', existing.phone ?? '', row.phone ?? '');
  push('whatsappNumber', existing.whatsappNumber ?? '', row.whatsappNumber ?? '');
  push('personalEmail', existing.personalEmail ?? '', row.personalEmail ?? '');
  push('linkedinUrl', existing.linkedinUrl ?? '', row.linkedinUrl ?? '');
  push('fte', existing.fte?.toString() ?? '', row.fte === null ? '' : row.fte.toFixed(2));
  push('roles', (existing.roles ?? []).join(','), row.roles.join(','));
  return diff;
}

export type CommitPersonnelResult = {
  newCount: number;
  updatedCount: number;
  skippedCount: number;
};

/**
 * Commit the validated rows. Wraps the entire batch in one transaction
 * with one bulk-import AuditEvent so partial failures roll back.
 */
export async function commitPersonnelImport(
  preview: PersonnelPreview,
  actorPersonId: string,
): Promise<CommitPersonnelResult> {
  // Refuse to commit if there are top-level blockers — the preview UI
  // shouldn't surface the Commit button in those cases, but we defend
  // here in case the URL was tampered with.
  if (preview.errorCount > 0 || preview.duplicateEmails.length > 0 || preview.topLevelErrors.length > 0) {
    throw new Error('Cannot commit — preview has errors.');
  }

  const usableRows = preview.rows.filter(
    (r) => r.parsed && (r.action === 'new' || r.action === 'update'),
  );
  if (usableRows.length === 0) {
    return { newCount: 0, updatedCount: 0, skippedCount: preview.totalRows };
  }

  let newCount = 0;
  let updatedCount = 0;
  await prisma.$transaction(async (tx) => {
    for (const row of usableRows) {
      const v = row.parsed!;
      const rateCents = Math.round(v.rateDollars * 100);
      if (row.action === 'new') {
        const initials = await ensureUniqueInitials(tx, deriveInitials(v.firstName, v.lastName));
        const created = await tx.person.create({
          // jobTitle is accepted in the CSV (for parity with the
          // new-person form's M365 provisioning hook) but isn't a
          // Person column — silently dropped here.
          data: {
            email: v.email,
            personalEmail: v.personalEmail,
            firstName: v.firstName,
            lastName: v.lastName,
            initials,
            phone: v.phone,
            whatsappNumber: v.whatsappNumber,
            linkedinUrl: v.linkedinUrl,
            band: v.band,
            level: v.level,
            employment: v.employment,
            fte: v.fte ?? undefined,
            region: v.region,
            rateUnit: v.rateUnit,
            rate: rateCents,
            roles: v.roles,
            startDate: new Date(v.startDate),
          },
          select: { id: true },
        });
        newCount += 1;
        row.matchedPersonId = created.id;
      } else if (row.action === 'update' && row.matchedPersonId) {
        await tx.person.update({
          where: { id: row.matchedPersonId },
          data: {
            firstName: v.firstName,
            lastName: v.lastName,
            personalEmail: v.personalEmail,
            phone: v.phone,
            whatsappNumber: v.whatsappNumber,
            linkedinUrl: v.linkedinUrl,
            band: v.band,
            level: v.level,
            employment: v.employment,
            fte: v.fte ?? null,
            region: v.region,
            rateUnit: v.rateUnit,
            rate: rateCents,
            roles: v.roles,
            startDate: new Date(v.startDate),
          },
        });
        updatedCount += 1;
      }
    }

    // Single bulk-import audit row covering the whole batch. The
    // entityId is set to the actor's own person id so the row remains
    // queryable; the delta carries the per-row summary so an admin can
    // reconstruct exactly what landed without scraping the DB.
    await writeAudit(tx, {
      actor: { type: 'person', id: actorPersonId },
      action: 'bulk_imported',
      entity: {
        type: 'person',
        id: actorPersonId,
        after: {
          fileName: preview.fileName,
          totalRows: preview.totalRows,
          newCount,
          updatedCount,
          rowSummary: usableRows.map((r) => ({
            rowIndex: r.rowIndex,
            email: r.parsed!.email,
            action: r.action,
            personId: r.matchedPersonId,
          })),
        },
      },
      source: 'web',
    });
  });

  return {
    newCount,
    updatedCount,
    skippedCount: preview.totalRows - usableRows.length,
  };
}

function deriveInitials(firstName: string, lastName: string): string {
  const first = firstName[0]?.toUpperCase() ?? 'X';
  const last = lastName[0]?.toUpperCase() ?? 'X';
  return `${first}${last}`;
}

async function ensureUniqueInitials(
  tx: Prisma.TransactionClient,
  base: string,
): Promise<string> {
  let candidate = base;
  let suffix = 1;
  while (await tx.person.findUnique({ where: { initials: candidate } })) {
    suffix += 1;
    candidate = `${base}${suffix}`;
    if (suffix > 99) throw new Error(`Could not generate unique initials for ${base}`);
  }
  return candidate;
}

/** For external use (tests + the "download errors as CSV" feature). */
export function previewErrorsToCsvRows(preview: PersonnelPreview): {
  headers: string[];
  rows: Array<Array<string>>;
} {
  const headers = ['rowIndex', 'email', 'errors'];
  const rows: Array<Array<string>> = [];
  for (const r of preview.rows) {
    if (r.errors.length === 0) continue;
    rows.push([String(r.rowIndex), r.raw['email'] ?? '', r.errors.join(' · ')]);
  }
  return { headers, rows };
}

export const __test_internals = { parseRolesCell };
