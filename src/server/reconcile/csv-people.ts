/**
 * People-CSV importer for the reconcile assistant. Upsert by email.
 *
 * Required headers: email, firstName, lastName, initials, band, level, employment
 * Optional: roles (semicolon-separated), rate (dollars), rateUnit (hour|day),
 *           whatsappNumber, startDate (ISO), endDate (ISO)
 *
 * `band`, `level`, `employment` are required because the Person schema
 * defines them as non-null — there's no sensible default and silently
 * defaulting would create wrong utilisation maths downstream. Validation
 * rejects rows that omit them.
 */
import type { Band, Employment, Role } from '@prisma/client';
import { prisma } from '@/server/db';
import { parseCsv, requireHeaders } from '@/server/imports/csv-parse';

const PEOPLE_REQUIRED_HEADERS = ['email', 'firstname', 'lastname', 'initials', 'band', 'level', 'employment', 'region', 'startdate'] as const;

const VALID_BANDS: ReadonlyArray<Band> = [
  'MP', 'Partner', 'Associate_Partner', 'Expert', 'Consultant', 'Analyst', 'Support_Staff',
];
const VALID_EMPLOYMENTS: ReadonlyArray<Employment> = ['ft', 'contractor'];
const VALID_ROLES: ReadonlyArray<Role> = [
  'super_admin', 'admin', 'partner', 'associate_partner', 'manager', 'staff',
];
const VALID_RATE_UNITS = ['hour', 'day'] as const;

export type PersonImportRow = {
  lineNo: number;
  action: 'create' | 'update' | 'skip';
  email: string;
  note: string;
  data?: {
    email: string;
    firstName: string;
    lastName: string;
    initials: string;
    band: Band;
    level: string;
    employment: Employment;
    roles: Role[];
    rate: number;
    rateUnit: 'hour' | 'day';
    whatsappNumber: string | null;
    region: string;
    startDate: Date;
    endDate: Date | null;
  };
};

export type PersonImportPlan = {
  rows: PersonImportRow[];
  counts: { create: number; update: number; skip: number; total: number };
};

export async function planPeopleImport(csvText: string): Promise<{
  ok: true;
  plan: PersonImportPlan;
} | {
  ok: false;
  error: string;
}> {
  const parsed = parseCsv(csvText);
  if (!parsed.ok) return { ok: false, error: parsed.error.message };
  const missing = requireHeaders(parsed.data, PEOPLE_REQUIRED_HEADERS);
  if (missing.length > 0) {
    return {
      ok: false,
      error: `Missing required columns: ${missing.join(', ')}. Required: ${PEOPLE_REQUIRED_HEADERS.join(', ')}.`,
    };
  }

  const emails = new Set<string>();
  const initialsSet = new Set<string>();
  for (const r of parsed.data.rows) {
    if (r['email']) emails.add(r['email'].toLowerCase());
    if (r['initials']) initialsSet.add(r['initials'].toUpperCase());
  }
  const existing = emails.size === 0
    ? []
    : await prisma.person.findMany({
        where: { email: { in: Array.from(emails), mode: 'insensitive' } },
        select: {
          id: true, email: true, firstName: true, lastName: true,
          initials: true, band: true, level: true, employment: true,
          rate: true, rateUnit: true,
        },
      });
  const byEmail = new Map(existing.map((p) => [p.email!.toLowerCase(), p]));
  // Track in-CSV initials uniqueness so we don't try to upsert two rows
  // claiming the same initials.
  const initialsSeen = new Set<string>();

  const rows: PersonImportRow[] = [];
  let lineNo = 1;
  for (const r of parsed.data.rows) {
    lineNo += 1;
    const email = (r['email'] || '').trim().toLowerCase();
    const skip = (note: string): PersonImportRow => ({ lineNo, action: 'skip', email, note });
    if (!email || !email.includes('@')) { rows.push(skip('email missing or invalid.')); continue; }

    const initials = (r['initials'] || '').trim().toUpperCase();
    if (!initials) { rows.push(skip('initials empty.')); continue; }
    if (initialsSeen.has(initials)) { rows.push(skip(`initials "${initials}" collides with another row in this CSV.`)); continue; }
    initialsSeen.add(initials);

    const bandRaw = (r['band'] || '').trim();
    if (!(VALID_BANDS as ReadonlyArray<string>).includes(bandRaw)) {
      rows.push(skip(`band "${bandRaw}" must be one of ${VALID_BANDS.join(', ')}.`));
      continue;
    }
    const employmentRaw = (r['employment'] || '').trim().toLowerCase();
    if (!(VALID_EMPLOYMENTS as ReadonlyArray<string>).includes(employmentRaw)) {
      rows.push(skip(`employment "${employmentRaw}" must be one of ${VALID_EMPLOYMENTS.join(', ')}.`));
      continue;
    }
    const level = (r['level'] || '').trim();
    if (!level) { rows.push(skip('level empty.')); continue; }

    // roles: semicolon-separated list; default 'staff'.
    let roles: Role[] = ['staff'];
    if (r['roles']) {
      const parts = r['roles'].split(/[;,]/).map((p) => p.trim().toLowerCase()).filter(Boolean);
      const bad = parts.filter((p) => !(VALID_ROLES as ReadonlyArray<string>).includes(p));
      if (bad.length > 0) { rows.push(skip(`unknown roles: ${bad.join(', ')}.`)); continue; }
      roles = parts as Role[];
    }

    // Rate.
    let rate = 0;
    if (r['rate']) {
      const num = Number(r['rate'].replace(/[,$]/g, ''));
      if (!Number.isFinite(num) || num < 0) { rows.push(skip(`rate "${r['rate']}" unparseable.`)); continue; }
      rate = Math.round(num * 100);
    }
    const rateUnitRaw = (r['rateunit'] || 'hour').trim().toLowerCase();
    if (!(VALID_RATE_UNITS as ReadonlyArray<string>).includes(rateUnitRaw)) {
      rows.push(skip(`rateUnit "${rateUnitRaw}" must be hour or day.`));
      continue;
    }

    // Dates.
    function parseDate(name: 'startdate' | 'enddate'): Date | null | 'error' {
      const v = r[name];
      if (!v || v.toLowerCase() === 'null') return null;
      const d = new Date(v);
      if (!Number.isFinite(d.getTime())) return 'error';
      return d;
    }
    const startDate = parseDate('startdate');
    if (startDate === 'error') { rows.push(skip('startDate unparseable.')); continue; }
    if (startDate === null) { rows.push(skip('startDate is required.')); continue; }
    const endDate = parseDate('enddate');
    if (endDate === 'error') { rows.push(skip('endDate unparseable.')); continue; }

    const region = (r['region'] || '').trim().toUpperCase();
    if (region.length !== 2) { rows.push(skip(`region "${region}" must be 2-letter ISO (e.g. AU, NZ).`)); continue; }
    const data = {
      email,
      firstName: (r['firstname'] || '').trim(),
      lastName: (r['lastname'] || '').trim(),
      initials,
      band: bandRaw as Band,
      level,
      employment: employmentRaw as Employment,
      roles,
      rate,
      rateUnit: rateUnitRaw as 'hour' | 'day',
      whatsappNumber: r['whatsappnumber']?.trim() || null,
      region,
      startDate,
      endDate,
    };
    if (!data.firstName || !data.lastName) { rows.push(skip('firstName / lastName empty.')); continue; }

    const ex = byEmail.get(email);
    if (ex) {
      const diffs: string[] = [];
      if (ex.firstName !== data.firstName || ex.lastName !== data.lastName) diffs.push('name →');
      if (ex.band !== data.band) diffs.push(`band → ${data.band}`);
      if (ex.level !== data.level) diffs.push(`level → ${data.level}`);
      if (ex.employment !== data.employment) diffs.push(`employment → ${data.employment}`);
      if (ex.rate !== data.rate) diffs.push(`rate → ${(data.rate / 100).toLocaleString('en-AU')}`);
      if (ex.rateUnit !== data.rateUnit) diffs.push(`rateUnit → ${data.rateUnit}`);
      if (ex.initials !== data.initials) diffs.push(`initials → ${data.initials}`);
      if (diffs.length === 0) {
        rows.push(skip('No changes — matches existing.'));
        continue;
      }
      rows.push({ lineNo, action: 'update', email, note: diffs.join(', '), data });
    } else {
      rows.push({
        lineNo, action: 'create', email,
        note: `${data.firstName} ${data.lastName} · ${data.band} ${data.level} · ${data.employment}`,
        data,
      });
    }
  }
  // Make sure new initials don't collide with the DB.
  if (rows.some((r) => r.action !== 'skip')) {
    const claimed = rows
      .filter((r): r is PersonImportRow & { data: NonNullable<typeof r.data> } => r.action !== 'skip' && r.data !== undefined)
      .map((r) => r.data.initials);
    if (claimed.length > 0) {
      const collisions = await prisma.person.findMany({
        where: { initials: { in: claimed } },
        select: { initials: true, email: true },
      });
      const conflictByInitials = new Map<string, string>();
      for (const c of collisions) {
        if (c.email) conflictByInitials.set(c.initials, c.email.toLowerCase());
      }
      for (const row of rows) {
        if (row.action === 'skip' || !row.data) continue;
        const conflictEmail = conflictByInitials.get(row.data.initials);
        if (conflictEmail && conflictEmail !== row.email) {
          row.action = 'skip';
          row.note = `initials "${row.data.initials}" already used by ${conflictEmail}.`;
          delete row.data;
        }
      }
    }
  }

  const counts = {
    create: rows.filter((r) => r.action === 'create').length,
    update: rows.filter((r) => r.action === 'update').length,
    skip: rows.filter((r) => r.action === 'skip').length,
    total: rows.length,
  };
  return { ok: true, plan: { rows, counts } };
}
