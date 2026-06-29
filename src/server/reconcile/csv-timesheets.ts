/**
 * Timesheets-CSV importer for the reconcile assistant. Bulk inserts
 * historical timesheet entries pre-approved by the super-admin running
 * the import — same semantics as the existing /admin/import/timesheets
 * flow but routed through the reconcile chat panel.
 *
 * Required headers: personEmail, projectCode, date, hours
 * Optional: description
 *
 * Each row creates one TimesheetEntry. Hours are snapped to the
 * nearest 0.5. Date must be a parseable ISO. (Person, project) pairs
 * with no existing ProjectTeam row will be auto-added at apply time
 * so resourcing reflects the import — matches saveTimesheet's
 * behaviour.
 *
 * No update mode — timesheet rows are write-once. Dupes on the same
 * (person, project, date) get action='skip' with a "matches existing"
 * note.
 */
import { prisma } from '@/server/db';
import { parseCsv, requireHeaders } from '@/server/imports/csv-parse';

const TIMESHEET_REQUIRED_HEADERS = ['personemail', 'projectcode', 'date', 'hours'] as const;

export type TimesheetImportRow = {
  lineNo: number;
  action: 'create' | 'skip';
  note: string;
  data?: {
    personId: string;
    projectId: string;
    /** stored as Date with UTC noon to avoid TZ slippage on the day boundary. */
    date: Date;
    hours: number;
    description: string;
  };
};

export type TimesheetImportPlan = {
  rows: TimesheetImportRow[];
  counts: { create: number; skip: number; total: number };
};

export async function planTimesheetImport(csvText: string): Promise<{
  ok: true;
  plan: TimesheetImportPlan;
} | {
  ok: false;
  error: string;
}> {
  const parsed = parseCsv(csvText);
  if (!parsed.ok) return { ok: false, error: parsed.error.message };
  const missing = requireHeaders(parsed.data, TIMESHEET_REQUIRED_HEADERS);
  if (missing.length > 0) {
    return {
      ok: false,
      error: `Missing required columns: ${missing.join(', ')}. Required: personEmail, projectCode, date, hours.`,
    };
  }

  const emails = new Set<string>();
  const codes = new Set<string>();
  for (const r of parsed.data.rows) {
    if (r['personemail']) emails.add(r['personemail'].toLowerCase());
    if (r['projectcode']) codes.add(r['projectcode'].toUpperCase());
  }
  const [people, projects] = await Promise.all([
    emails.size === 0
      ? Promise.resolve([])
      : prisma.person.findMany({
          where: { email: { in: Array.from(emails), mode: 'insensitive' } },
          select: { id: true, email: true, endDate: true, inactiveAt: true },
        }),
    codes.size === 0
      ? Promise.resolve([])
      : prisma.project.findMany({
          where: { code: { in: Array.from(codes) } },
          select: { id: true, code: true },
        }),
  ]);
  const personByEmail = new Map<string, { id: string; active: boolean }>();
  for (const p of people) {
    if (p.email) {
      personByEmail.set(p.email.toLowerCase(), {
        id: p.id,
        active: p.endDate === null && p.inactiveAt === null,
      });
    }
  }
  const projectByCode = new Map(projects.map((p) => [p.code.toUpperCase(), p.id]));

  // Build a set of (personId, projectId, dateKey) already in DB so we
  // can flag duplicates without per-row queries.
  const candidatePersonIds = new Set<string>();
  const candidateProjectIds = new Set<string>();
  const candidateDates = new Set<string>();
  for (const r of parsed.data.rows) {
    const e = r['personemail']?.toLowerCase();
    const c = r['projectcode']?.toUpperCase();
    const personId = e ? personByEmail.get(e)?.id : null;
    const projectId = c ? projectByCode.get(c) : null;
    if (personId && projectId && r['date']) {
      candidatePersonIds.add(personId);
      candidateProjectIds.add(projectId);
      const d = new Date(r['date']);
      if (Number.isFinite(d.getTime())) candidateDates.add(d.toISOString().slice(0, 10));
    }
  }
  const dupes = candidatePersonIds.size > 0
    ? await prisma.timesheetEntry.findMany({
        where: {
          personId: { in: Array.from(candidatePersonIds) },
          projectId: { in: Array.from(candidateProjectIds) },
        },
        select: { personId: true, projectId: true, date: true },
      })
    : [];
  const dupeKey = (personId: string, projectId: string, dayKey: string) =>
    `${personId}|${projectId}|${dayKey}`;
  const dupeSet = new Set(
    dupes.map((d) => dupeKey(d.personId, d.projectId, d.date.toISOString().slice(0, 10))),
  );

  const rows: TimesheetImportRow[] = [];
  let lineNo = 1;
  for (const r of parsed.data.rows) {
    lineNo += 1;
    const skip = (note: string): TimesheetImportRow => ({ lineNo, action: 'skip', note });
    const email = (r['personemail'] || '').trim().toLowerCase();
    const code = (r['projectcode'] || '').trim().toUpperCase();
    if (!email) { rows.push(skip('personEmail empty.')); continue; }
    if (!code) { rows.push(skip('projectCode empty.')); continue; }
    const person = personByEmail.get(email);
    if (!person) { rows.push(skip(`No active person with email "${email}".`)); continue; }
    if (!person.active) { rows.push(skip(`person "${email}" is inactive / end-dated.`)); continue; }
    const projectId = projectByCode.get(code);
    if (!projectId) { rows.push(skip(`No project with code "${code}".`)); continue; }

    const rawDate = r['date'] ?? '';
    if (!rawDate) { rows.push(skip('date empty.')); continue; }
    const d = new Date(rawDate);
    if (!Number.isFinite(d.getTime())) { rows.push(skip(`date "${rawDate}" unparseable.`)); continue; }
    // Anchor to UTC noon — saveTimesheet stores @db.Date which Prisma
    // serialises at UTC midnight; noon avoids "the row landed on the
    // wrong day" surprises when the importer is in a +10 TZ.
    const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 12, 0, 0));
    const dayKey = date.toISOString().slice(0, 10);

    const hrsRaw = Number(r['hours']);
    if (!Number.isFinite(hrsRaw) || hrsRaw < 0 || hrsRaw > 24) {
      rows.push(skip(`hours "${r['hours']}" must be between 0 and 24.`));
      continue;
    }
    const hours = Math.round(hrsRaw * 2) / 2;
    if (hours === 0) {
      rows.push(skip('hours = 0 — nothing to log.'));
      continue;
    }

    if (dupeSet.has(dupeKey(person.id, projectId, dayKey))) {
      rows.push(skip(`Entry already exists for ${email} · ${code} · ${dayKey}.`));
      continue;
    }
    rows.push({
      lineNo,
      action: 'create',
      note: `${email} · ${code} · ${dayKey} · ${hours}h`,
      data: {
        personId: person.id,
        projectId,
        date,
        hours,
        description: r['description']?.trim() ?? '',
      },
    });
  }

  const counts = {
    create: rows.filter((r) => r.action === 'create').length,
    skip: rows.filter((r) => r.action === 'skip').length,
    total: rows.length,
  };
  return { ok: true, plan: { rows, counts } };
}
