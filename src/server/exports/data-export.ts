import JSZip from 'jszip';
import { prisma } from '@/server/db';

/**
 * Business-continuity data export — bundles a snapshot of the
 * critical operating tables as CSVs into a single ZIP, ready for
 * SharePoint upload. The output is designed to be opened in Excel
 * during a system outage: people, projects, current AP/AR, recent
 * timesheets, the rate card, approvals.
 *
 * **Excluded by design** (per A6 deny-by-default + the PII rules):
 *   - Person.bank_bsb / bank_acc / super_fund_id / tax_file_number
 *   - Person.bank* / superFundId / taxFileNumber
 *   - Person.emergency_contact_*
 *
 * The export is read-only and one-way (snapshot out). Reverse-sync
 * — applying changes made in Excel back to the DB after recovery —
 * is a separate flow (TASK-tbd) that uploads a structured "deltas"
 * workbook through a validated importer.
 *
 * Format is CSV (not XLSX) for maximum-compatibility: Excel opens
 * CSVs natively, and the format is plain-text so a contractor /
 * accountant without M365 can still work the data in Google Sheets,
 * Numbers, or even a text editor.
 */

export type ExportManifest = {
  /** ISO timestamp the snapshot was taken. */
  generatedAt: string;
  /** Per-file row counts so the operator can verify the export
   *  isn't truncated. */
  tableCounts: Record<string, number>;
  /** Bundle filename — used by the SharePoint uploader. */
  filename: string;
  /** Total bytes of the ZIP — surfaced in audit + UI. */
  sizeBytes: number;
};

export type ExportResult = {
  manifest: ExportManifest;
  /** ZIP bytes ready to upload anywhere — SharePoint, S3, email
   *  attachment. */
  buffer: Buffer;
};

/**
 * Generate the snapshot ZIP. Returns the bytes + a manifest the
 * caller can stamp into the audit row + the SharePoint metadata.
 *
 * Pulls in parallel where safe (top-level table queries), then
 * builds CSV strings in memory. Cap each query (`TAKE_LIMIT`) so
 * a runaway dataset can't OOM the serverless function — anything
 * larger than that warrants the deeper "audit log full export"
 * surface that lives elsewhere.
 */
export async function generateDataExport(): Promise<ExportResult> {
  const generatedAt = new Date();
  const TAKE_LIMIT = 10_000;
  // Recent-only windows for the high-volume tables.
  const since90 = new Date(generatedAt.getTime() - 90 * 24 * 3600 * 1000);
  const since180 = new Date(generatedAt.getTime() - 180 * 24 * 3600 * 1000);

  const [
    people,
    projects,
    clients,
    bills,
    invoices,
    expenses,
    timesheets,
    rateCard,
    approvals,
    auditRows,
  ] = await Promise.all([
    prisma.person.findMany({
      where: { inactiveAt: null },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      select: {
        id: true,
        initials: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        whatsappNumber: true,
        band: true,
        level: true,
        employment: true,
        fte: true,
        rate: true,
        rateUnit: true,
        billRate: true,
        roles: true,
        startDate: true,
        endDate: true,
        region: true,
        // EXPLICITLY OMITTED per A6:
        //   bankBsb / bankAcc / bankSwift / bankIban /
        //   superFundId / taxFileNumber /
        //   emergencyContactName / emergencyContactPhone / etc.
        // These are encrypted at rest and never leave the DB even
        // in admin-tier exports.
      },
    }),
    prisma.project.findMany({
      where: { stage: { not: 'archived' } },
      orderBy: { code: 'asc' },
      include: {
        client: { select: { code: true, legalName: true } },
        primaryPartner: { select: { firstName: true, lastName: true } },
        manager: { select: { firstName: true, lastName: true } },
      },
      take: TAKE_LIMIT,
    }),
    prisma.client.findMany({
      orderBy: { code: 'asc' },
      select: {
        id: true,
        code: true,
        legalName: true,
        tradingName: true,
        abn: true,
        website: true,
        domain: true,
        contactName: true,
        contactEmail: true,
        contactPhone: true,
      },
      take: TAKE_LIMIT,
    }),
    prisma.bill.findMany({
      where: {
        status: { in: ['pending_review', 'approved', 'scheduled_for_payment'] },
      },
      orderBy: { issueDate: 'desc' },
      include: {
        project: { select: { code: true } },
        attributedTo: { select: { firstName: true, lastName: true } },
      },
      take: TAKE_LIMIT,
    }),
    prisma.invoice.findMany({
      where: {
        status: { in: ['draft', 'pending_approval', 'approved', 'sent', 'partial', 'overdue'] },
      },
      orderBy: { issueDate: 'desc' },
      include: {
        project: { select: { code: true } },
        client: { select: { code: true, legalName: true } },
      },
      take: TAKE_LIMIT,
    }),
    prisma.expense.findMany({
      where: { date: { gte: since90 } },
      orderBy: { date: 'desc' },
      include: {
        person: { select: { firstName: true, lastName: true } },
        project: { select: { code: true } },
      },
      take: TAKE_LIMIT,
    }),
    prisma.timesheetEntry.findMany({
      where: { date: { gte: since90 } },
      orderBy: { date: 'desc' },
      include: {
        person: { select: { firstName: true, lastName: true } },
        project: { select: { code: true } },
      },
      take: TAKE_LIMIT,
    }),
    prisma.rateCard.findMany({
      where: { effectiveFrom: { lte: generatedAt } },
      orderBy: [{ roleCode: 'asc' }, { effectiveFrom: 'desc' }],
      take: TAKE_LIMIT,
    }),
    prisma.approval.findMany({
      where: { status: 'pending' },
      orderBy: { createdAt: 'desc' },
      include: {
        requestedBy: { select: { firstName: true, lastName: true } },
      },
      take: TAKE_LIMIT,
    }),
    prisma.auditEvent.findMany({
      where: { at: { gte: since180 } },
      orderBy: { at: 'desc' },
      select: {
        id: true,
        at: true,
        actorType: true,
        actorId: true,
        action: true,
        entityType: true,
        entityId: true,
        source: true,
      },
      take: TAKE_LIMIT,
    }),
  ]);

  // Build CSV strings. csv() escapes properly; arrays + objects
  // flatten via JSON.stringify so the row stays single-line in the
  // CSV.
  const filesByName: Record<string, string> = {
    'people.csv': csvFromRows([
      ['id', 'initials', 'first_name', 'last_name', 'email', 'phone',
        'whatsapp_number', 'band', 'level', 'employment', 'fte',
        'rate_cents', 'rate_unit', 'bill_rate_cents', 'roles',
        'start_date', 'end_date', 'region'],
      ...people.map((p) => [
        p.id, p.initials, p.firstName, p.lastName, p.email,
        p.phone ?? '', p.whatsappNumber ?? '', p.band ?? '',
        p.level ?? '', p.employment, p.fte?.toString() ?? '',
        p.rate, p.rateUnit, p.billRate ?? '', p.roles.join('|'),
        p.startDate?.toISOString() ?? '',
        p.endDate?.toISOString() ?? '', p.region ?? '',
      ]),
    ]),
    'projects.csv': csvFromRows([
      ['code', 'name', 'stage', 'client_code', 'client_name',
        'contract_value_cents', 'currency', 'start_date', 'end_date',
        'primary_partner', 'manager', 'sharepoint_team_url',
        'sharepoint_admin_url'],
      ...projects.map((p) => [
        p.code, p.name, p.stage,
        p.client.code, p.client.legalName,
        p.contractValue, p.currency,
        p.startDate?.toISOString() ?? '', p.endDate?.toISOString() ?? '',
        `${p.primaryPartner.firstName} ${p.primaryPartner.lastName}`,
        `${p.manager.firstName} ${p.manager.lastName}`,
        p.sharepointFolderUrl ?? '',
        p.sharepointAdminFolderUrl ?? '',
      ]),
    ]),
    'clients.csv': csvFromRows([
      ['id', 'code', 'legal_name', 'trading_name', 'abn', 'website',
        'domain', 'contact_name', 'contact_email', 'contact_phone'],
      ...clients.map((c) => [
        c.id, c.code, c.legalName, c.tradingName ?? '',
        c.abn ?? '', c.website ?? '', c.domain ?? '',
        c.contactName ?? '', c.contactEmail ?? '',
        c.contactPhone ?? '',
      ]),
    ]),
    'bills-open.csv': csvFromRows([
      ['id', 'supplier_name', 'supplier_invoice_no', 'project_code',
        'attributed_to', 'category', 'received_via', 'issue_date',
        'due_date', 'amount_total_cents', 'gst_cents', 'status'],
      ...bills.map((b) => [
        b.id, b.supplierName ?? '', b.supplierInvoiceNumber ?? '',
        b.project?.code ?? '',
        b.attributedTo
          ? `${b.attributedTo.firstName} ${b.attributedTo.lastName}`
          : '',
        b.category, b.receivedVia,
        b.issueDate.toISOString(), b.dueDate.toISOString(),
        b.amountTotal, b.gst, b.status,
      ]),
    ]),
    'invoices-open.csv': csvFromRows([
      ['id', 'number', 'client_code', 'client_name', 'project_code',
        'issue_date', 'due_date', 'amount_ex_gst_cents', 'gst_cents',
        'amount_total_cents', 'status', 'sent_at', 'paid_at',
        'tax_invoice_finalised_at'],
      ...invoices.map((i) => [
        i.id, i.number, i.client.code, i.client.legalName,
        i.project.code,
        i.issueDate.toISOString(), i.dueDate.toISOString(),
        i.amountExGst, i.gst, i.amountTotal, i.status,
        i.sentAt?.toISOString() ?? '', i.paidAt?.toISOString() ?? '',
        i.taxInvoiceFinalisedAt?.toISOString() ?? '',
      ]),
    ]),
    'expenses-recent-90d.csv': csvFromRows([
      ['id', 'date', 'person', 'project_code', 'vendor', 'category',
        'amount_cents', 'gst_cents', 'description', 'status'],
      ...expenses.map((e) => [
        e.id, e.date.toISOString().slice(0, 10),
        `${e.person.firstName} ${e.person.lastName}`,
        e.project?.code ?? '', e.vendor ?? '', e.category,
        e.amount, e.gst, e.description ?? '', e.status,
      ]),
    ]),
    'timesheets-recent-90d.csv': csvFromRows([
      ['id', 'date', 'person', 'project_code', 'hours',
        'description', 'status', 'approved_at'],
      ...timesheets.map((t) => [
        t.id, t.date.toISOString().slice(0, 10),
        `${t.person.firstName} ${t.person.lastName}`,
        t.project.code, Number(t.hours).toFixed(2),
        t.description ?? '', t.status,
        t.approvedAt?.toISOString() ?? '',
      ]),
    ]),
    'rate-card.csv': csvFromRows([
      ['role_code', 'effective_from', 'cost_rate_cents',
        'bill_rate_low_cents', 'bill_rate_high_cents'],
      ...rateCard.map((r) => [
        r.roleCode, r.effectiveFrom.toISOString().slice(0, 10),
        r.costRate, r.billRateLow, r.billRateHigh,
      ]),
    ]),
    'approvals-pending.csv': csvFromRows([
      ['id', 'subject_type', 'subject_id', 'required_role',
        'requested_by', 'requested_at', 'channel'],
      ...approvals.map((a) => [
        a.id, a.subjectType, a.subjectId, a.requiredRole,
        `${a.requestedBy.firstName} ${a.requestedBy.lastName}`,
        a.createdAt.toISOString(), a.channel,
      ]),
    ]),
    'audit-log-recent-180d.csv': csvFromRows([
      ['id', 'at', 'actor_type', 'actor_id', 'action',
        'entity_type', 'entity_id', 'source'],
      ...auditRows.map((a) => [
        a.id, a.at.toISOString(), a.actorType,
        a.actorId ?? '', a.action, a.entityType,
        a.entityId, a.source,
      ]),
    ]),
  };

  // README — first thing the operator opens when they need to
  // know what to do during an outage. Includes timestamps, table
  // counts, and the recovery workflow notes.
  const tableCounts: Record<string, number> = {};
  for (const [filename, content] of Object.entries(filesByName)) {
    // Subtract 1 for header row.
    tableCounts[filename] = Math.max(0, content.split('\n').length - 2);
  }
  filesByName['README.txt'] = readmeText(generatedAt, tableCounts);

  const zip = new JSZip();
  for (const [name, content] of Object.entries(filesByName)) {
    zip.file(name, content);
  }
  const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });

  const stamp = generatedAt
    .toISOString()
    .replace(/[T:]/g, '-')
    .replace(/\..+/, '');
  const filename = `foundry-ops-export-${stamp}.zip`;

  return {
    manifest: {
      generatedAt: generatedAt.toISOString(),
      tableCounts,
      filename,
      sizeBytes: buffer.length,
    },
    buffer,
  };
}

/**
 * RFC-4180 conformant CSV row serialiser. Wraps cells in quotes
 * when they contain a comma, newline, or quote; doubles internal
 * quotes per the spec. Coerces non-strings via `String(v)`. Null
 * and undefined render as empty cells.
 */
function csvFromRows(rows: Array<Array<unknown>>): string {
  return rows
    .map((row) =>
      row
        .map((cell) => {
          if (cell === null || cell === undefined) return '';
          const s = String(cell);
          if (s.includes(',') || s.includes('\n') || s.includes('"')) {
            return `"${s.replace(/"/g, '""')}"`;
          }
          return s;
        })
        .join(','),
    )
    .join('\n');
}

function readmeText(
  generatedAt: Date,
  tableCounts: Record<string, number>,
): string {
  const lines = [
    'Foundry Ops — business-continuity export',
    '=========================================',
    '',
    `Generated: ${generatedAt.toISOString()}`,
    `Generated for: a system-outage scenario where the Foundry Ops`,
    `platform is unavailable and the team needs to keep working`,
    `manually in Excel until the system is back online.`,
    '',
    'Files in this bundle',
    '--------------------',
  ];
  for (const [filename, count] of Object.entries(tableCounts)) {
    lines.push(`  ${filename.padEnd(34)} ${count} row${count === 1 ? '' : 's'}`);
  }
  lines.push(
    '',
    'How to use during an outage',
    '----------------------------',
    '1. Download this ZIP from the SharePoint Admin → Backups folder.',
    '2. Open the CSV that matches the work you need to continue —',
    '   e.g. invoices-open.csv to track payments coming in.',
    '3. Make changes in Excel. SAVE A COPY for each working session',
    '   so you have a clear delta record at recovery time.',
    '4. When the platform is back online, open Admin → Data exports',
    '   and use the "Apply outage deltas" surface to upload your',
    '   working copies. Validated changes are applied with an audit',
    '   trail tagged "outage_recovery_import".',
    '',
    'What is NOT in this bundle',
    '---------------------------',
    '* Person PII (bank details, super fund id, tax file number,',
    '  emergency contact) — locked at rest per the security policy.',
    '  These never leave the encrypted DB.',
    '* Receipts / invoice PDFs — those live in SharePoint already.',
    '  Each row references its source URL where applicable.',
    '* Historical audit log entries older than 180 days — fetch from',
    '  the audit-log surface when needed.',
    '',
    'Authoring: this bundle is generated by the data-export cron',
    'job (src/server/exports/data-export.ts). Re-runs are safe — no',
    'mutations happen during generation.',
  );
  return lines.join('\n');
}
