import { z } from 'zod';
import { prisma } from '@/server/db';
import { writeAudit } from '@/server/audit';
import { parseCsv, requireHeaders } from './csv-parse';

export const REQUIRED_EXPENSES_HEADERS = [
  'personemail',
  'date',
  'amounttotaldollars',
  'gstdollars',
  'category',
  'description',
] as const;

const MAX_AMOUNT_DOLLARS = 1_000_000;
const MAX_DATE_LOOKBACK_DAYS = 365 * 3 + 30;

const ExpensesRowSchema = z
  .object({
    personemail: z.string().trim().toLowerCase().email(),
    date: z.coerce.date(),
    amounttotaldollars: z.coerce.number().min(0).max(MAX_AMOUNT_DOLLARS),
    gstdollars: z.coerce.number().min(0).max(MAX_AMOUNT_DOLLARS),
    category: z.string().trim().min(1).max(80),
    description: z.string().trim().min(1).max(500),
    projectcode: z
      .string()
      .trim()
      .max(40)
      .optional()
      .transform((v) => (v ? v : null))
      .nullable(),
    vendor: z
      .string()
      .trim()
      .max(200)
      .optional()
      .transform((v) => (v ? v : null))
      .nullable(),
    rebillable: z
      .union([z.literal(''), z.coerce.boolean()])
      .optional()
      .transform((v) => (v === '' || v === undefined ? false : Boolean(v))),
  })
  .passthrough();

export type ExpensesParsedRow = {
  personEmail: string;
  date: string;
  amountTotalDollars: number;
  gstDollars: number;
  category: string;
  description: string;
  projectCode: string | null;
  vendor: string | null;
  rebillable: boolean;
};

export type ExpensesPreviewRow = {
  rowIndex: number;
  raw: Record<string, string>;
  parsed: ExpensesParsedRow | null;
  personId: string | null;
  projectId: string | null;
  unmatchedProjectCode: boolean;
  rejectionReason: string | null;
};

export type ExpensesPreview = {
  fileName: string;
  totalRows: number;
  acceptedCount: number;
  rejectedCount: number;
  totalAmountDollars: number;
  perPerson: Array<{
    personEmail: string;
    matched: boolean;
    rowCount: number;
    totalDollars: number;
  }>;
  perProject: Array<{
    projectCode: string;
    matched: boolean;
    rowCount: number;
    totalDollars: number;
  }>;
  rows: ExpensesPreviewRow[];
  topLevelErrors: string[];
};

export type ExpensesLookups = {
  personByEmail: Map<string, string>;
  projectByCode: Map<string, string>;
};

export function buildExpensesPreviewWithLookups(
  csvText: string,
  fileName: string,
  lookups: ExpensesLookups,
): { ok: true; preview: ExpensesPreview } | { ok: false; error: { message: string } } {
  const parsed = parseCsv(csvText);
  if (!parsed.ok) return { ok: false, error: { message: parsed.error.message } };
  const missing = requireHeaders(parsed.data, REQUIRED_EXPENSES_HEADERS);
  if (missing.length > 0) {
    return {
      ok: false,
      error: {
        message: `CSV is missing required column(s): ${missing.join(', ')}. Download the template and try again.`,
      },
    };
  }

  const now = new Date();
  const earliest = new Date(now.getTime() - MAX_DATE_LOOKBACK_DAYS * 24 * 3600 * 1000);
  const latest = new Date(now.getTime() + 7 * 24 * 3600 * 1000);

  const previewRows: ExpensesPreviewRow[] = [];
  for (let i = 0; i < parsed.data.rows.length; i++) {
    const raw = parsed.data.rows[i]!;
    const rowIndex = i + 1;
    const result = ExpensesRowSchema.safeParse(raw);
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
        unmatchedProjectCode: false,
        rejectionReason: reason,
      });
      continue;
    }
    const v = result.data;
    const parsedRow: ExpensesParsedRow = {
      personEmail: v.personemail,
      date: v.date.toISOString().slice(0, 10),
      amountTotalDollars: v.amounttotaldollars,
      gstDollars: v.gstdollars,
      category: v.category,
      description: v.description,
      projectCode: v.projectcode ?? null,
      vendor: v.vendor ?? null,
      rebillable: v.rebillable,
    };

    const personId = lookups.personByEmail.get(v.personemail.toLowerCase()) ?? null;

    let projectId: string | null = null;
    let unmatchedProjectCode = false;
    if (parsedRow.projectCode) {
      projectId = lookups.projectByCode.get(parsedRow.projectCode.toLowerCase()) ?? null;
      if (!projectId) unmatchedProjectCode = true;
    }

    let rejectionReason: string | null = null;
    if (!personId) {
      rejectionReason = `no Person with email ${v.personemail}`;
    } else if (parsedRow.gstDollars > parsedRow.amountTotalDollars) {
      rejectionReason = `GST $${parsedRow.gstDollars.toFixed(2)} exceeds total $${parsedRow.amountTotalDollars.toFixed(2)}`;
    } else if (v.date < earliest) {
      rejectionReason = 'date older than 3 fiscal years';
    } else if (v.date > latest) {
      rejectionReason = 'date is in the future';
    } else if (unmatchedProjectCode) {
      rejectionReason = `projectCode "${parsedRow.projectCode}" doesn't match any Project — clear the column to land as OPEX, or fix the code`;
    }

    previewRows.push({
      rowIndex,
      raw,
      parsed: parsedRow,
      personId,
      projectId,
      unmatchedProjectCode,
      rejectionReason,
    });
  }

  const acceptedCount = previewRows.filter((r) => r.rejectionReason === null).length;
  const rejectedCount = previewRows.length - acceptedCount;
  const totalAmountDollars = previewRows
    .filter((r) => r.rejectionReason === null && r.parsed)
    .reduce((acc, r) => acc + r.parsed!.amountTotalDollars, 0);

  const perPersonMap = new Map<
    string,
    { personEmail: string; matched: boolean; rowCount: number; totalDollars: number }
  >();
  const perProjectMap = new Map<
    string,
    { projectCode: string; matched: boolean; rowCount: number; totalDollars: number }
  >();
  for (const r of previewRows) {
    if (!r.parsed) continue;
    const email = r.parsed.personEmail;
    if (!perPersonMap.has(email)) {
      perPersonMap.set(email, {
        personEmail: email,
        matched: r.personId !== null,
        rowCount: 0,
        totalDollars: 0,
      });
    }
    const pbucket = perPersonMap.get(email)!;
    pbucket.rowCount += 1;
    if (r.rejectionReason === null) pbucket.totalDollars += r.parsed.amountTotalDollars;

    if (r.parsed.projectCode) {
      if (!perProjectMap.has(r.parsed.projectCode)) {
        perProjectMap.set(r.parsed.projectCode, {
          projectCode: r.parsed.projectCode,
          matched: r.projectId !== null,
          rowCount: 0,
          totalDollars: 0,
        });
      }
      const prj = perProjectMap.get(r.parsed.projectCode)!;
      prj.rowCount += 1;
      if (r.rejectionReason === null) prj.totalDollars += r.parsed.amountTotalDollars;
    }
  }

  return {
    ok: true,
    preview: {
      fileName,
      totalRows: previewRows.length,
      acceptedCount,
      rejectedCount,
      totalAmountDollars: Math.round(totalAmountDollars * 100) / 100,
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

export async function buildExpensesPreview(
  csvText: string,
  fileName: string,
): Promise<{ ok: true; preview: ExpensesPreview } | { ok: false; error: { message: string } }> {
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
  const uniqEmails = Array.from(new Set(emails));
  const uniqCodes = Array.from(new Set(codes));

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

  return buildExpensesPreviewWithLookups(csvText, fileName, { personByEmail, projectByCode });
}

export type CommitExpensesResult = {
  insertedCount: number;
  rejectedCount: number;
};

export async function commitExpensesImport(
  preview: ExpensesPreview,
  actorPersonId: string,
): Promise<CommitExpensesResult> {
  const usable = preview.rows.filter(
    (r) => r.rejectionReason === null && r.parsed && r.personId,
  );
  let inserted = 0;
  await prisma.$transaction(async (tx) => {
    for (const row of usable) {
      const v = row.parsed!;
      await tx.expense.create({
        data: {
          personId: row.personId!,
          projectId: row.projectId,
          date: new Date(v.date),
          amount: Math.round(v.amountTotalDollars * 100),
          gst: Math.round(v.gstDollars * 100),
          category: v.category,
          vendor: v.vendor,
          description: v.description,
          rebillable: v.rebillable,
          // Backfill convention: historical expenses land approved with
          // the importer as approver, so they skip the manual approval
          // workflow.
          status: 'approved',
          approvedById: actorPersonId,
          approvedAt: new Date(),
        },
      });
      inserted += 1;
    }
    await writeAudit(tx, {
      actor: { type: 'person', id: actorPersonId },
      action: 'bulk_imported',
      entity: {
        type: 'expense',
        id: actorPersonId,
        after: {
          fileName: preview.fileName,
          totalRows: preview.totalRows,
          inserted,
          rejected: preview.rejectedCount,
          totalAmountDollars: preview.totalAmountDollars,
        },
      },
      source: 'web',
    });
  });

  return { insertedCount: inserted, rejectedCount: preview.rejectedCount };
}

export function expensesRejectsToCsvRows(preview: ExpensesPreview): {
  headers: string[];
  rows: Array<Array<string>>;
} {
  const headers = ['rowIndex', 'personEmail', 'date', 'amount', 'category', 'reason'];
  const rows: Array<Array<string>> = [];
  for (const r of preview.rows) {
    if (r.rejectionReason === null) continue;
    rows.push([
      String(r.rowIndex),
      r.raw['personemail'] ?? '',
      r.raw['date'] ?? '',
      r.raw['amounttotaldollars'] ?? '',
      r.raw['category'] ?? '',
      r.rejectionReason,
    ]);
  }
  return { headers, rows };
}
