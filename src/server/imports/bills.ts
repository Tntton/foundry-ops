import { z } from 'zod';
import { prisma } from '@/server/db';
import { writeAudit } from '@/server/audit';
import { parseCsv, requireHeaders } from './csv-parse';

export const REQUIRED_BILLS_HEADERS = [
  'suppliername',
  'issuedate',
  'duedate',
  'amounttotaldollars',
  'gstdollars',
  'category',
] as const;

const MAX_AMOUNT_DOLLARS = 10_000_000;

const BillsRowSchema = z
  .object({
    suppliername: z.string().trim().min(1).max(200),
    supplierinvoicenumber: z
      .string()
      .trim()
      .max(80)
      .optional()
      .transform((v) => (v ? v : null))
      .nullable(),
    issuedate: z.coerce.date(),
    duedate: z.coerce.date(),
    amounttotaldollars: z.coerce.number().min(0).max(MAX_AMOUNT_DOLLARS),
    gstdollars: z.coerce.number().min(0).max(MAX_AMOUNT_DOLLARS),
    category: z.string().trim().min(1).max(80),
    projectcode: z
      .string()
      .trim()
      .max(40)
      .optional()
      .transform((v) => (v ? v : null))
      .nullable(),
    attributedpersonemail: z
      .string()
      .trim()
      .toLowerCase()
      .max(200)
      .optional()
      .transform((v) => (v ? v : null))
      .nullable(),
    rebillable: z
      .union([z.literal(''), z.coerce.boolean()])
      .optional()
      .transform((v) => v === '' || v === undefined ? false : Boolean(v)),
  })
  .passthrough();

export type BillsParsedRow = {
  supplierName: string;
  supplierInvoiceNumber: string | null;
  issueDate: string; // ISO YYYY-MM-DD
  dueDate: string;
  amountTotalDollars: number;
  gstDollars: number;
  category: string;
  projectCode: string | null;
  attributedPersonEmail: string | null;
  rebillable: boolean;
};

export type BillsPreviewRow = {
  rowIndex: number;
  raw: Record<string, string>;
  parsed: BillsParsedRow | null;
  /** Resolved Supplier.id when supplierName matched a known Supplier row. */
  supplierId: string | null;
  /** Resolved Project.id when projectCode matched. Null if no project code or unmatched. */
  projectId: string | null;
  /** Resolved Person.id from attributedPersonEmail if provided. */
  attributedPersonId: string | null;
  /** Set when (supplierName, supplierInvoiceNumber) matches an existing Bill. */
  isDuplicate: boolean;
  /** Set when projectCode given but no Project matched. */
  unmatchedProjectCode: boolean;
  /** Set when attributedPersonEmail given but no Person matched. */
  unmatchedAttributedEmail: boolean;
  rejectionReason: string | null;
};

export type BillsPreview = {
  fileName: string;
  totalRows: number;
  acceptedCount: number;
  rejectedCount: number;
  duplicateCount: number;
  totalAmountDollars: number;
  perSupplier: Array<{
    supplierName: string;
    supplierMatched: boolean;
    rowCount: number;
    totalDollars: number;
  }>;
  perProject: Array<{
    projectCode: string;
    matched: boolean;
    rowCount: number;
    totalDollars: number;
  }>;
  rows: BillsPreviewRow[];
  topLevelErrors: string[];
};

export type BillsLookups = {
  /** Lowercased supplierName → Supplier.id */
  supplierByName: Map<string, string>;
  /** Lowercased projectCode → Project.id */
  projectByCode: Map<string, string>;
  /** Lowercased personEmail → Person.id */
  personByEmail: Map<string, string>;
  /** `${supplierName.lower}|${supplierInvoiceNumber.lower}` → existing Bill.id */
  existingBills: Map<string, string>;
};

/**
 * Pure builder — DB-free, so the parser can be golden-file tested without
 * mocking Prisma. The async wrapper below pre-fetches the lookups and
 * delegates here.
 */
export function buildBillsPreviewWithLookups(
  csvText: string,
  fileName: string,
  lookups: BillsLookups,
): { ok: true; preview: BillsPreview } | { ok: false; error: { message: string } } {
  const parsed = parseCsv(csvText);
  if (!parsed.ok) return { ok: false, error: { message: parsed.error.message } };
  const missing = requireHeaders(parsed.data, REQUIRED_BILLS_HEADERS);
  if (missing.length > 0) {
    return {
      ok: false,
      error: {
        message: `CSV is missing required column(s): ${missing.join(', ')}. Download the template and try again.`,
      },
    };
  }

  const previewRows: BillsPreviewRow[] = [];
  for (let i = 0; i < parsed.data.rows.length; i++) {
    const raw = parsed.data.rows[i]!;
    const rowIndex = i + 1;
    const result = BillsRowSchema.safeParse(raw);
    if (!result.success) {
      const reason = result.error.issues
        .map((iss) => `${iss.path.join('.') || '(row)'}: ${iss.message}`)
        .join(' · ');
      previewRows.push({
        rowIndex,
        raw,
        parsed: null,
        supplierId: null,
        projectId: null,
        attributedPersonId: null,
        isDuplicate: false,
        unmatchedProjectCode: false,
        unmatchedAttributedEmail: false,
        rejectionReason: reason,
      });
      continue;
    }
    const v = result.data;
    const parsedRow: BillsParsedRow = {
      supplierName: v.suppliername,
      supplierInvoiceNumber: v.supplierinvoicenumber ?? null,
      issueDate: v.issuedate.toISOString().slice(0, 10),
      dueDate: v.duedate.toISOString().slice(0, 10),
      amountTotalDollars: v.amounttotaldollars,
      gstDollars: v.gstdollars,
      category: v.category,
      projectCode: v.projectcode ?? null,
      attributedPersonEmail: v.attributedpersonemail ?? null,
      rebillable: v.rebillable,
    };

    // Lookup the supplier (loose: lowercased name)
    const supplierId =
      lookups.supplierByName.get(parsedRow.supplierName.toLowerCase()) ?? null;

    // Lookup project (only if a code was given)
    let projectId: string | null = null;
    let unmatchedProjectCode = false;
    if (parsedRow.projectCode) {
      projectId = lookups.projectByCode.get(parsedRow.projectCode.toLowerCase()) ?? null;
      if (!projectId) unmatchedProjectCode = true;
    }

    // Lookup attributed person (only if email given)
    let attributedPersonId: string | null = null;
    let unmatchedAttributedEmail = false;
    if (parsedRow.attributedPersonEmail) {
      attributedPersonId =
        lookups.personByEmail.get(parsedRow.attributedPersonEmail.toLowerCase()) ?? null;
      if (!attributedPersonId) unmatchedAttributedEmail = true;
    }

    let rejectionReason: string | null = null;
    if (parsedRow.gstDollars > parsedRow.amountTotalDollars) {
      rejectionReason = `GST $${parsedRow.gstDollars.toFixed(2)} exceeds total $${parsedRow.amountTotalDollars.toFixed(2)}`;
    } else if (unmatchedProjectCode) {
      rejectionReason = `projectCode "${parsedRow.projectCode}" doesn't match any Project — clear the column to land it as OPEX, or fix the code`;
    } else if (unmatchedAttributedEmail) {
      rejectionReason = `attributedPersonEmail "${parsedRow.attributedPersonEmail}" doesn't match any Person — clear the column or fix the email`;
    }

    // Duplicate detection — only when an invoice number is provided
    let isDuplicate = false;
    if (parsedRow.supplierInvoiceNumber) {
      const key = `${parsedRow.supplierName.toLowerCase()}|${parsedRow.supplierInvoiceNumber.toLowerCase()}`;
      if (lookups.existingBills.has(key)) isDuplicate = true;
    }

    previewRows.push({
      rowIndex,
      raw,
      parsed: parsedRow,
      supplierId,
      projectId,
      attributedPersonId,
      isDuplicate,
      unmatchedProjectCode,
      unmatchedAttributedEmail,
      rejectionReason,
    });
  }

  // Roll-ups
  const acceptedCount = previewRows.filter((r) => r.rejectionReason === null).length;
  const rejectedCount = previewRows.length - acceptedCount;
  const duplicateCount = previewRows.filter((r) => r.isDuplicate).length;
  const totalAmountDollars = previewRows
    .filter((r) => r.rejectionReason === null && r.parsed)
    .reduce((acc, r) => acc + r.parsed!.amountTotalDollars, 0);

  const perSupplierMap = new Map<
    string,
    { supplierName: string; supplierMatched: boolean; rowCount: number; totalDollars: number }
  >();
  const perProjectMap = new Map<
    string,
    { projectCode: string; matched: boolean; rowCount: number; totalDollars: number }
  >();
  for (const r of previewRows) {
    if (!r.parsed) continue;
    const supplierKey = r.parsed.supplierName;
    if (!perSupplierMap.has(supplierKey)) {
      perSupplierMap.set(supplierKey, {
        supplierName: supplierKey,
        supplierMatched: r.supplierId !== null,
        rowCount: 0,
        totalDollars: 0,
      });
    }
    const bucket = perSupplierMap.get(supplierKey)!;
    bucket.rowCount += 1;
    if (r.rejectionReason === null) bucket.totalDollars += r.parsed.amountTotalDollars;

    if (r.parsed.projectCode) {
      if (!perProjectMap.has(r.parsed.projectCode)) {
        perProjectMap.set(r.parsed.projectCode, {
          projectCode: r.parsed.projectCode,
          matched: r.projectId !== null,
          rowCount: 0,
          totalDollars: 0,
        });
      }
      const pbucket = perProjectMap.get(r.parsed.projectCode)!;
      pbucket.rowCount += 1;
      if (r.rejectionReason === null) pbucket.totalDollars += r.parsed.amountTotalDollars;
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
      totalAmountDollars: Math.round(totalAmountDollars * 100) / 100,
      perSupplier: Array.from(perSupplierMap.values()).sort((a, b) =>
        a.supplierName.localeCompare(b.supplierName),
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
 * Async wrapper — pre-fetches the supplier / project / person / existing-bill
 * lookups, then delegates to the pure builder.
 */
export async function buildBillsPreview(
  csvText: string,
  fileName: string,
): Promise<{ ok: true; preview: BillsPreview } | { ok: false; error: { message: string } }> {
  const probe = parseCsv(csvText);
  const supplierNames: string[] = [];
  const projectCodes: string[] = [];
  const emails: string[] = [];
  const invoicePairs: Array<{ supplierName: string; invoiceNumber: string }> = [];
  if (probe.ok) {
    for (const r of probe.data.rows) {
      const sn = (r['suppliername'] ?? '').trim();
      if (sn) supplierNames.push(sn);
      const pc = (r['projectcode'] ?? '').trim();
      if (pc) projectCodes.push(pc);
      const ae = (r['attributedpersonemail'] ?? '').trim().toLowerCase();
      if (ae) emails.push(ae);
      const inv = (r['supplierinvoicenumber'] ?? '').trim();
      if (sn && inv) invoicePairs.push({ supplierName: sn, invoiceNumber: inv });
    }
  }
  const uniqueSuppliers = Array.from(new Set(supplierNames.map((s) => s.toLowerCase())));
  const uniqueProjects = Array.from(new Set(projectCodes));
  const uniqueEmails = Array.from(new Set(emails));

  const [suppliers, projects, persons, bills] = await Promise.all([
    uniqueSuppliers.length > 0
      ? prisma.supplier.findMany({
          where: { name: { in: supplierNames, mode: 'insensitive' } },
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
    uniqueProjects.length > 0
      ? prisma.project.findMany({
          where: { code: { in: uniqueProjects, mode: 'insensitive' } },
          select: { id: true, code: true },
        })
      : Promise.resolve([]),
    uniqueEmails.length > 0
      ? prisma.person.findMany({
          where: { email: { in: uniqueEmails, mode: 'insensitive' } },
          select: { id: true, email: true },
        })
      : Promise.resolve([]),
    invoicePairs.length > 0
      ? prisma.bill.findMany({
          where: {
            OR: invoicePairs.map((pair) => ({
              supplierName: { equals: pair.supplierName, mode: 'insensitive' },
              supplierInvoiceNumber: { equals: pair.invoiceNumber, mode: 'insensitive' },
            })),
          },
          select: { id: true, supplierName: true, supplierInvoiceNumber: true },
        })
      : Promise.resolve([]),
  ]);

  const supplierByName = new Map<string, string>();
  for (const s of suppliers) supplierByName.set(s.name.toLowerCase(), s.id);
  const projectByCode = new Map<string, string>();
  for (const p of projects) projectByCode.set(p.code.toLowerCase(), p.id);
  const personByEmail = new Map<string, string>();
  for (const p of persons) personByEmail.set(p.email.toLowerCase(), p.id);
  const existingBills = new Map<string, string>();
  for (const b of bills) {
    if (!b.supplierName || !b.supplierInvoiceNumber) continue;
    const key = `${b.supplierName.toLowerCase()}|${b.supplierInvoiceNumber.toLowerCase()}`;
    existingBills.set(key, b.id);
  }

  return buildBillsPreviewWithLookups(csvText, fileName, {
    supplierByName,
    projectByCode,
    personByEmail,
    existingBills,
  });
}

export type CommitBillsMode = 'skip_duplicates' | 'force_create';

export type CommitBillsResult = {
  insertedCount: number;
  skippedDuplicateCount: number;
  rejectedCount: number;
};

export async function commitBillsImport(
  preview: BillsPreview,
  actorPersonId: string,
  mode: CommitBillsMode,
): Promise<CommitBillsResult> {
  const usable = preview.rows.filter((r) => r.rejectionReason === null && r.parsed);

  let inserted = 0;
  let skippedDuplicate = 0;

  await prisma.$transaction(async (tx) => {
    for (const row of usable) {
      const v = row.parsed!;
      if (row.isDuplicate && mode === 'skip_duplicates') {
        skippedDuplicate += 1;
        continue;
      }
      await tx.bill.create({
        data: {
          supplierName: v.supplierName,
          supplierId: row.supplierId ?? null,
          supplierInvoiceNumber: v.supplierInvoiceNumber,
          receivedVia: 'upload',
          issueDate: new Date(v.issueDate),
          dueDate: new Date(v.dueDate),
          amountTotal: Math.round(v.amountTotalDollars * 100),
          gst: Math.round(v.gstDollars * 100),
          category: v.category,
          projectId: row.projectId,
          attributedToPersonId: row.attributedPersonId,
          rebillable: v.rebillable,
          // Backfill convention: historical bills land already settled.
          // Reviewer can flip to a different status from the bill detail
          // page if needed.
          status: 'paid',
        },
      });
      inserted += 1;
    }
    await writeAudit(tx, {
      actor: { type: 'person', id: actorPersonId },
      action: 'bulk_imported',
      entity: {
        type: 'bill',
        id: actorPersonId,
        after: {
          fileName: preview.fileName,
          mode,
          totalRows: preview.totalRows,
          inserted,
          skippedDuplicate,
          rejected: preview.rejectedCount,
          totalAmountDollars: preview.totalAmountDollars,
        },
      },
      source: 'web',
    });
  });

  return {
    insertedCount: inserted,
    skippedDuplicateCount: skippedDuplicate,
    rejectedCount: preview.rejectedCount,
  };
}

export function billsRejectsToCsvRows(preview: BillsPreview): {
  headers: string[];
  rows: Array<Array<string>>;
} {
  const headers = ['rowIndex', 'supplierName', 'invoiceNumber', 'issueDate', 'amount', 'reason'];
  const rows: Array<Array<string>> = [];
  for (const r of preview.rows) {
    if (r.rejectionReason === null) continue;
    rows.push([
      String(r.rowIndex),
      r.raw['suppliername'] ?? '',
      r.raw['supplierinvoicenumber'] ?? '',
      r.raw['issuedate'] ?? '',
      r.raw['amounttotaldollars'] ?? '',
      r.rejectionReason,
    ]);
  }
  return { headers, rows };
}
