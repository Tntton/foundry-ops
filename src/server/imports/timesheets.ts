import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '@/server/db';
import { writeAudit } from '@/server/audit';
import { parseCsv, requireHeaders } from './csv-parse';

export const REQUIRED_TIMESHEET_HEADERS = [
  'personemail',
  'projectcode',
  'date',
  'hours',
] as const;

/** Hours: 0.25 step is the timesheet grid's resolution. */
const MIN_HOURS = 0.25;
const MAX_HOURS_PER_DAY = 24;

/**
 * Date is constrained to the last 3 fiscal years (AU FY = Jul–Jun). For
 * Jas's go-live load we just need FY26 — but we leave headroom so a
 * later catch-up of FY24/25 doesn't immediately need a code change.
 */
const MAX_DATE_LOOKBACK_DAYS = 365 * 3 + 30;

const TimesheetRowSchema = z
  .object({
    personemail: z.string().trim().toLowerCase().email(),
    projectcode: z.string().trim().min(1).max(40),
    date: z.coerce.date(),
    hours: z.coerce.number().min(MIN_HOURS).max(MAX_HOURS_PER_DAY),
    notes: z.string().trim().max(500).optional().transform((v) => (v ? v : null)).nullable(),
  })
  .passthrough();

export type TimesheetParsedRow = {
  personEmail: string;
  projectCode: string;
  date: string; // ISO YYYY-MM-DD
  hours: number;
  notes: string | null;
};

export type TimesheetPreviewRow = {
  rowIndex: number;
  raw: Record<string, string>;
  parsed: TimesheetParsedRow | null;
  /** Resolved Person.id from email match. Null = no person matched. */
  personId: string | null;
  /** Resolved Project.id from code match. Null = no project matched. */
  projectId: string | null;
  /** Set when (personId, projectId, date) already exists in the DB. */
  isDuplicate: boolean;
  /** Existing TimesheetEntry.id when duplicate — used by overwrite mode. */
  existingEntryId: string | null;
  /** When set, the row will be skipped at commit. */
  rejectionReason: string | null;
};

export type TimesheetPreview = {
  fileName: string;
  totalRows: number;
  acceptedCount: number;
  rejectedCount: number;
  duplicateCount: number;
  totalHours: number;
  perPerson: Array<{
    personEmail: string;
    matched: boolean;
    rowCount: number;
    totalHours: number;
  }>;
  perProject: Array<{
    projectCode: string;
    matched: boolean;
    rowCount: number;
    totalHours: number;
  }>;
  rows: TimesheetPreviewRow[];
  topLevelErrors: string[];
};

export type TimesheetLookups = {
  personByEmail: Map<string, string>;
  projectByCode: Map<string, string>;
  /** key = `${personId}|${projectId}|${YYYY-MM-DD}` → existing TimesheetEntry.id */
  existingDuplicates: Map<string, string>;
};

/**
 * Pure preview builder for timesheets. Takes the CSV text + pre-fetched
 * lookup maps; doesn't touch the DB. Split out so the parser can be
 * golden-file tested without mocking Prisma.
 */
export function buildTimesheetPreviewWithLookups(
  csvText: string,
  fileName: string,
  lookups: TimesheetLookups,
): { ok: true; preview: TimesheetPreview } | { ok: false; error: { message: string } } {
  const parsed = parseCsv(csvText);
  if (!parsed.ok) return { ok: false, error: { message: parsed.error.message } };

  const missing = requireHeaders(parsed.data, REQUIRED_TIMESHEET_HEADERS);
  if (missing.length > 0) {
    return {
      ok: false,
      error: {
        message: `CSV is missing required column(s): ${missing.join(', ')}. Download the template and try again.`,
      },
    };
  }

  const personByEmail = lookups.personByEmail;
  const projectByCode = lookups.projectByCode;

  const now = new Date();
  const earliest = new Date(now.getTime() - MAX_DATE_LOOKBACK_DAYS * 24 * 3600 * 1000);
  const latest = new Date(now.getTime() + 7 * 24 * 3600 * 1000); // 7d future grace

  const previewRows: TimesheetPreviewRow[] = [];
  for (let i = 0; i < parsed.data.rows.length; i++) {
    const raw = parsed.data.rows[i]!;
    const rowIndex = i + 1;

    const result = TimesheetRowSchema.safeParse(raw);
    if (!result.success) {
      const reason = result.error.issues
        .map((iss) => `${iss.path.join('.') || '(row)'}: ${iss.message}`)
        .join(' · ');
      previewRows.push({
        rowIndex,
        raw,
        parsed: null,
        personId: null,
        projectId: null,
        isDuplicate: false,
        existingEntryId: null,
        rejectionReason: reason,
      });
      continue;
    }
    const v = result.data;
    const parsedRow: TimesheetParsedRow = {
      personEmail: v.personemail,
      projectCode: v.projectcode,
      date: v.date.toISOString().slice(0, 10),
      hours: v.hours,
      notes: v.notes ?? null,
    };

    const personId = personByEmail.get(v.personemail.toLowerCase()) ?? null;
    const projectId = projectByCode.get(v.projectcode.toLowerCase()) ?? null;
    let rejectionReason: string | null = null;
    if (!personId) rejectionReason = `no Person with email ${v.personemail}`;
    else if (!projectId) rejectionReason = `no Project with code ${v.projectcode}`;
    else if (v.date < earliest) rejectionReason = `date older than 3 fiscal years`;
    else if (v.date > latest) rejectionReason = `date is in the future`;

    previewRows.push({
      rowIndex,
      raw,
      parsed: parsedRow,
      personId,
      projectId,
      isDuplicate: false,
      existingEntryId: null,
      rejectionReason,
    });
  }

  // Mark duplicates against the pre-fetched lookup.
  for (const r of previewRows) {
    if (r.rejectionReason !== null || !r.personId || !r.projectId || !r.parsed) continue;
    const key = `${r.personId}|${r.projectId}|${r.parsed.date}`;
    const existingId = lookups.existingDuplicates.get(key);
    if (existingId) {
      r.isDuplicate = true;
      r.existingEntryId = existingId;
    }
  }

  const acceptedCount = previewRows.filter((r) => r.rejectionReason === null).length;
  const rejectedCount = previewRows.filter((r) => r.rejectionReason !== null).length;
  const duplicateCount = previewRows.filter((r) => r.isDuplicate).length;
  const totalHours = previewRows
    .filter((r) => r.rejectionReason === null && r.parsed)
    .reduce((acc, r) => acc + r.parsed!.hours, 0);

  // Per-person + per-project rollups (use the raw email/code so unmatched
  // rows still surface — Jas needs to see "Suze had 18 rows but the email
  // didn't match anything in the DB").
  const perPersonMap = new Map<
    string,
    { personEmail: string; matched: boolean; rowCount: number; totalHours: number }
  >();
  const perProjectMap = new Map<
    string,
    { projectCode: string; matched: boolean; rowCount: number; totalHours: number }
  >();
  for (const r of previewRows) {
    if (!r.parsed) continue;
    const email = r.parsed.personEmail;
    const code = r.parsed.projectCode;
    const personMatched = r.personId !== null;
    const projectMatched = r.projectId !== null;
    if (!perPersonMap.has(email)) {
      perPersonMap.set(email, { personEmail: email, matched: personMatched, rowCount: 0, totalHours: 0 });
    }
    if (!perProjectMap.has(code)) {
      perProjectMap.set(code, { projectCode: code, matched: projectMatched, rowCount: 0, totalHours: 0 });
    }
    const person = perPersonMap.get(email)!;
    const project = perProjectMap.get(code)!;
    person.rowCount += 1;
    project.rowCount += 1;
    if (r.rejectionReason === null) {
      person.totalHours += r.parsed.hours;
      project.totalHours += r.parsed.hours;
    }
  }

  return {
    ok: true,
    preview: {
      fileName,
      totalRows: previewRows.length,
      acceptedCount,
      rejectedCount,
      duplicateCount,
      totalHours: roundQuarter(totalHours),
      perPerson: Array.from(perPersonMap.values()).sort((a, b) =>
        a.personEmail.localeCompare(b.personEmail),
      ),
      perProject: Array.from(perProjectMap.values()).sort((a, b) =>
        a.projectCode.localeCompare(b.projectCode),
      ),
      rows: previewRows,
      topLevelErrors: [],
    },
  };
}

/**
 * Async wrapper — pre-fetches the person + project + duplicate lookups and
 * delegates to the pure builder.
 */
export async function buildTimesheetPreview(
  csvText: string,
  fileName: string,
): Promise<{ ok: true; preview: TimesheetPreview } | { ok: false; error: { message: string } }> {
  const probe = parseCsv(csvText);
  const emails: string[] = [];
  const codes: string[] = [];
  if (probe.ok) {
    for (const r of probe.data.rows) {
      const e = (r['personemail'] ?? '').trim().toLowerCase();
      if (e) emails.push(e);
      const c = (r['projectcode'] ?? '').trim();
      if (c) codes.push(c);
    }
  }
  const uniqEmails = uniqueLower(emails);
  const uniqCodes = uniqueUpper(codes);

  const [persons, projects] = await Promise.all([
    uniqEmails.length > 0
      ? prisma.person.findMany({
          where: { email: { in: uniqEmails, mode: 'insensitive' } },
          select: { id: true, email: true },
        })
      : Promise.resolve([]),
    uniqCodes.length > 0
      ? prisma.project.findMany({
          where: { code: { in: uniqCodes, mode: 'insensitive' } },
          select: { id: true, code: true },
        })
      : Promise.resolve([]),
  ]);
  const personByEmail = new Map<string, string>();
  for (const p of persons) personByEmail.set(p.email.toLowerCase(), p.id);
  const projectByCode = new Map<string, string>();
  for (const p of projects) projectByCode.set(p.code.toLowerCase(), p.id);

  // Now we need duplicate (person, project, date) entries. We can't know
  // them until we resolve person + project — so do a second pass over
  // the CSV to extract the candidate triples.
  const tripleCandidates: Array<{ personId: string; projectId: string; date: Date }> = [];
  if (probe.ok) {
    for (const r of probe.data.rows) {
      const pid = personByEmail.get((r['personemail'] ?? '').trim().toLowerCase());
      const prj = projectByCode.get((r['projectcode'] ?? '').trim().toLowerCase());
      if (!pid || !prj) continue;
      const d = new Date(r['date'] ?? '');
      if (Number.isNaN(d.getTime())) continue;
      tripleCandidates.push({ personId: pid, projectId: prj, date: d });
    }
  }
  const existingDuplicates = new Map<string, string>();
  if (tripleCandidates.length > 0) {
    const dupes = await prisma.timesheetEntry.findMany({
      where: {
        OR: tripleCandidates.map((c) => ({
          personId: c.personId,
          projectId: c.projectId,
          date: c.date,
        })),
      },
      select: { id: true, personId: true, projectId: true, date: true },
    });
    for (const d of dupes) {
      const key = `${d.personId}|${d.projectId}|${d.date.toISOString().slice(0, 10)}`;
      existingDuplicates.set(key, d.id);
    }
  }

  return buildTimesheetPreviewWithLookups(csvText, fileName, {
    personByEmail,
    projectByCode,
    existingDuplicates,
  });
}

export type CommitTimesheetMode = 'skip_duplicates' | 'overwrite_duplicates';

export type CommitTimesheetResult = {
  insertedCount: number;
  overwrittenCount: number;
  skippedDuplicateCount: number;
  rejectedCount: number;
};

export async function commitTimesheetImport(
  preview: TimesheetPreview,
  actorPersonId: string,
  mode: CommitTimesheetMode,
): Promise<CommitTimesheetResult> {
  let inserted = 0;
  let overwritten = 0;
  let skippedDuplicate = 0;

  const usable = preview.rows.filter(
    (r) => r.rejectionReason === null && r.parsed && r.personId && r.projectId,
  );

  await prisma.$transaction(async (tx) => {
    for (const row of usable) {
      const v = row.parsed!;
      const data = {
        personId: row.personId!,
        projectId: row.projectId!,
        date: new Date(v.date),
        hours: new Prisma.Decimal(v.hours.toFixed(2)),
        description: v.notes,
        status: 'approved' as const,
        approvedById: actorPersonId,
        approvedAt: new Date(),
      };
      if (row.isDuplicate && row.existingEntryId) {
        if (mode === 'skip_duplicates') {
          skippedDuplicate += 1;
          continue;
        }
        await tx.timesheetEntry.update({
          where: { id: row.existingEntryId },
          data: {
            hours: data.hours,
            description: data.description,
            status: data.status,
            approvedById: data.approvedById,
            approvedAt: data.approvedAt,
          },
        });
        overwritten += 1;
      } else {
        await tx.timesheetEntry.create({ data });
        inserted += 1;
      }
    }
    await writeAudit(tx, {
      actor: { type: 'person', id: actorPersonId },
      action: 'bulk_imported',
      entity: {
        type: 'timesheet',
        id: actorPersonId,
        after: {
          fileName: preview.fileName,
          mode,
          totalRows: preview.totalRows,
          inserted,
          overwritten,
          skippedDuplicate,
          rejected: preview.rejectedCount,
          totalHours: preview.totalHours,
        },
      },
      source: 'web',
    });
  });

  return {
    insertedCount: inserted,
    overwrittenCount: overwritten,
    skippedDuplicateCount: skippedDuplicate,
    rejectedCount: preview.rejectedCount,
  };
}

export function timesheetRejectsToCsvRows(preview: TimesheetPreview): {
  headers: string[];
  rows: Array<Array<string>>;
} {
  const headers = ['rowIndex', 'personEmail', 'projectCode', 'date', 'hours', 'reason'];
  const rows: Array<Array<string>> = [];
  for (const r of preview.rows) {
    if (r.rejectionReason === null) continue;
    rows.push([
      String(r.rowIndex),
      r.raw['personemail'] ?? '',
      r.raw['projectcode'] ?? '',
      r.raw['date'] ?? '',
      r.raw['hours'] ?? '',
      r.rejectionReason,
    ]);
  }
  return { headers, rows };
}

function uniqueLower(arr: string[]): string[] {
  return Array.from(new Set(arr.map((s) => s.trim().toLowerCase()).filter((s) => s.length > 0)));
}

function uniqueUpper(arr: string[]): string[] {
  return Array.from(new Set(arr.map((s) => s.trim()).filter((s) => s.length > 0)));
}

function roundQuarter(n: number): number {
  return Math.round(n * 4) / 4;
}
