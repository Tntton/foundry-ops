import { NextResponse } from 'next/server';
import { prisma } from '@/server/db';
import { getSession } from '@/server/session';
import { hasAnyRole } from '@/server/roles';
import { signPrefillToken } from '@/server/agents/assistant/prefill/token';
import { planProjectImport } from '@/server/reconcile/csv-projects';
import { planPeopleImport } from '@/server/reconcile/csv-people';
import { planTimesheetImport } from '@/server/reconcile/csv-timesheets';
import { planContractorInvoiceImport } from '@/server/reconcile/csv-contractor-invoices';
import { planOpexBillImport } from '@/server/reconcile/csv-opex-bills';
import { extractProjectBrief } from '@/server/reconcile/extract-brief';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAX_FILE_BYTES = 2 * 1024 * 1024; // 2MB — CSVs are tiny; reject anything that smells like a misclick.
const MAX_BRIEF_BYTES = 8 * 1024 * 1024; // 8MB — practical ceiling for claude-sonnet PDF vision.

/**
 * POST /api/reconcile/import — multipart upload of a CSV file.
 *
 * Body:
 *   file: File (CSV, ≤2MB)
 *   type: 'projects' (today). 'people' and 'timesheets' arrive next.
 *
 * Returns a proposal card payload identical in shape to the agent's
 * tool proposals so the chat panel can render it the same way. The
 * dry-run plan is signed into the `reconcile_csv_projects` token; the
 * confirm endpoint re-parses the CSV (to ensure no drift) and applies
 * the writes.
 */
export async function POST(req: Request): Promise<Response> {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }
  if (!hasAnyRole(session, ['super_admin'])) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const contentType = req.headers.get('content-type') ?? '';
  if (!contentType.startsWith('multipart/form-data')) {
    return NextResponse.json({ error: 'expected_multipart' }, { status: 400 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: 'invalid_multipart' }, { status: 400 });
  }
  const type = String(form.get('type') ?? '');
  const file = form.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'missing_file' }, { status: 400 });
  }
  // ── Brief (PDF) extraction branch ────────────────────────────────
  if (type === 'brief') {
    if (file.size > MAX_BRIEF_BYTES) {
      return NextResponse.json(
        { error: 'file_too_large', message: `Brief PDF must be ≤ ${Math.round(MAX_BRIEF_BYTES / 1024 / 1024)}MB.` },
        { status: 413 },
      );
    }
    const buf = Buffer.from(await file.arrayBuffer());
    const base64 = buf.toString('base64');
    const ext = await extractProjectBrief({ base64, mimeType: file.type });
    if (!ext.ok) {
      return NextResponse.json({ error: 'extract_failed', message: ext.reason }, { status: 400 });
    }
    const b = ext.data;
    // Try to match the client by legalName (case-insensitive contains).
    let matchedClient: { id: string; code: string; legalName: string } | null = null;
    if (b.clientName) {
      matchedClient = await prisma.client.findFirst({
        where: {
          archivedAt: null,
          legalName: { contains: b.clientName, mode: 'insensitive' },
        },
        select: { id: true, code: true, legalName: true },
      });
    }
    if (!matchedClient) {
      return NextResponse.json({
        ok: true,
        kind: 'no_op',
        message: b.clientName
          ? `Couldn't match a Client to "${b.clientName}". Create the client first, then re-drop the brief.`
          : "Brief didn't mention a client name. Create the project manually.",
        extracted: b,
      });
    }
    const token = signPrefillToken({
      kind: 'reconcile_brief',
      personId: session.person.id,
      payload: {
        clientId: matchedClient.id,
        clientCode: matchedClient.code,
        projectName: b.projectName ?? '(untitled brief)',
        scopeSummary: b.scopeSummary,
        startDate: b.startDate,
        endDate: b.endDate,
        contractValueCents: b.contractValueDollars !== null ? Math.round(b.contractValueDollars * 100) : 0,
        primaryPartnerId: session.person.id,
        managerId: session.person.id,
      },
    });
    return NextResponse.json({
      ok: true,
      kind: 'proposal',
      surface: 'reconcile_brief',
      token,
      title: `Create project from brief — ${b.projectName ?? '(untitled)'}`,
      fields: [
        { label: 'Client', value: `${matchedClient.code} · ${matchedClient.legalName}` },
        { label: 'Project name', value: b.projectName ?? '—' },
        {
          label: 'Contract value',
          value: b.contractValueDollars !== null
            ? `AUD ${b.contractValueDollars.toLocaleString('en-AU')}`
            : '—',
        },
        { label: 'Start', value: b.startDate ?? '—' },
        { label: 'End', value: b.endDate ?? '—' },
        ...(b.scopeSummary ? [{ label: 'Scope', value: b.scopeSummary }] : []),
        { label: 'Confidence', value: `${b.confidence}%` },
        { label: 'Lead', value: 'You (defaults — change later if needed)' },
      ],
      confirmLabel: 'Create project',
      summary: `Create ${matchedClient.code} project from brief.`,
    });
  }

  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json(
      { error: 'file_too_large', message: `CSV must be ≤ ${Math.round(MAX_FILE_BYTES / 1024 / 1024)}MB.` },
      { status: 413 },
    );
  }

  let text: string;
  try {
    text = await file.text();
  } catch {
    return NextResponse.json({ error: 'unreadable_file' }, { status: 400 });
  }

  // Auto-detect the CSV type from its header signature when the client
  // doesn't pin one. Cheaper UX than a "what kind?" dropdown.
  let resolvedType = type;
  if (!resolvedType || resolvedType === 'auto' || resolvedType === 'csv') {
    const headerLine = text.split(/\r?\n/, 1)[0]?.toLowerCase() ?? '';
    const has = (h: string) => headerLine.split(',').map((s) => s.trim()).includes(h);
    if (has('personemail') && has('projectcode') && has('date') && has('hours')) {
      resolvedType = 'timesheets';
    } else if (has('consultant') && has('projectcode') && has('billablehours') && has('invoicedexgst')) {
      resolvedType = 'contractor_invoices';
    } else if (has('chargecode') && has('item') && has('amount')) {
      resolvedType = 'opex_bills';
    } else if (has('email') && has('firstname') && has('lastname')) {
      resolvedType = 'people';
    } else if (has('code') && has('clientcode')) {
      resolvedType = 'projects';
    } else {
      return NextResponse.json(
        {
          error: 'unknown_csv_shape',
          message:
            'Could not auto-detect CSV type. Expected one of: projects (code, clientCode, …), people (email, firstName, lastName, …), timesheets (personEmail, projectCode, date, hours), contractor invoices (consultant, projectCode, billableHours, invoicedExGst), or OPEX bills (chargeCode, item, amount).',
        },
        { status: 400 },
      );
    }
  }

  if (resolvedType === 'projects') {
    const result = await planProjectImport(text, session.person.id);
    if (!result.ok) {
      return NextResponse.json({ error: 'parse_failed', message: result.error }, { status: 400 });
    }
    const { plan } = result;
    const { create, update, skip, total } = plan.counts;
    if (create + update === 0) {
      return NextResponse.json({
        ok: true,
        kind: 'no_op',
        message: `Parsed ${total} rows but nothing to write — ${skip} skipped. Check the notes column for reasons.`,
        plan,
      });
    }
    // Only sign the writable rows. Skipped rows aren't transmitted.
    const writable = plan.rows.filter((r): r is typeof r & { data: NonNullable<typeof r.data> } =>
      r.action !== 'skip' && r.data !== undefined,
    );
    const token = signPrefillToken({
      kind: 'reconcile_csv_projects',
      personId: session.person.id,
      payload: {
        rows: writable.map((r) => ({
          action: r.action,
          code: r.code,
          // Strip the heavy preview note to keep token size small.
          data: r.data,
        })),
      },
    });
    const PREVIEW = 30;
    return NextResponse.json({
      ok: true,
      kind: 'proposal',
      surface: 'reconcile_csv_projects',
      token,
      title: `Import ${create + update} projects (${create} new, ${update} updated)`,
      fields: [
        { label: 'Parsed', value: `${total} rows` },
        { label: 'Create', value: String(create) },
        { label: 'Update', value: String(update) },
        ...(skip > 0 ? [{ label: 'Skip', value: String(skip) }] : []),
        ...plan.rows.slice(0, PREVIEW).map((r) => ({
          label: `${r.action} · ${r.code || `(row ${r.lineNo})`}`,
          value: r.note,
        })),
        ...(plan.rows.length > PREVIEW
          ? [{ label: '…', value: `${plan.rows.length - PREVIEW} more rows not shown` }]
          : []),
      ],
      confirmLabel: `Write ${create + update}`,
      summary: `Projects CSV: ${create} create, ${update} update, ${skip} skip.`,
    });
  }

  if (resolvedType === 'people') {
    const result = await planPeopleImport(text);
    if (!result.ok) {
      return NextResponse.json({ error: 'parse_failed', message: result.error }, { status: 400 });
    }
    const { plan } = result;
    const { create, update, skip, total } = plan.counts;
    if (create + update === 0) {
      return NextResponse.json({
        ok: true,
        kind: 'no_op',
        message: `Parsed ${total} rows but nothing to write — ${skip} skipped.`,
        plan,
      });
    }
    const writable = plan.rows.filter((r): r is typeof r & { data: NonNullable<typeof r.data> } =>
      r.action !== 'skip' && r.data !== undefined,
    );
    const token = signPrefillToken({
      kind: 'reconcile_csv_people',
      personId: session.person.id,
      payload: {
        rows: writable.map((r) => ({ action: r.action, email: r.email, data: r.data })),
      },
    });
    const PREVIEW = 30;
    return NextResponse.json({
      ok: true,
      kind: 'proposal',
      surface: 'reconcile_csv_people',
      token,
      title: `Import ${create + update} people (${create} new, ${update} updated)`,
      fields: [
        { label: 'Parsed', value: `${total} rows` },
        { label: 'Create', value: String(create) },
        { label: 'Update', value: String(update) },
        ...(skip > 0 ? [{ label: 'Skip', value: String(skip) }] : []),
        ...plan.rows.slice(0, PREVIEW).map((r) => ({
          label: `${r.action} · ${r.email || `(row ${r.lineNo})`}`,
          value: r.note,
        })),
        ...(plan.rows.length > PREVIEW
          ? [{ label: '…', value: `${plan.rows.length - PREVIEW} more rows not shown` }]
          : []),
      ],
      confirmLabel: `Write ${create + update}`,
      summary: `People CSV: ${create} create, ${update} update, ${skip} skip.`,
    });
  }

  if (resolvedType === 'timesheets') {
    const result = await planTimesheetImport(text);
    if (!result.ok) {
      return NextResponse.json({ error: 'parse_failed', message: result.error }, { status: 400 });
    }
    const { plan } = result;
    const { create, skip, total } = plan.counts;
    if (create === 0) {
      return NextResponse.json({
        ok: true,
        kind: 'no_op',
        message: `Parsed ${total} rows but nothing to write — ${skip} skipped (likely duplicates or unknown person/project).`,
        plan,
      });
    }
    const writable = plan.rows.filter((r): r is typeof r & { data: NonNullable<typeof r.data> } =>
      r.action === 'create' && r.data !== undefined,
    );
    const token = signPrefillToken({
      kind: 'reconcile_csv_timesheets',
      personId: session.person.id,
      payload: {
        rows: writable.map((r) => ({
          ...r.data,
          // dateISO for serialisation safety — Dates round-trip through JSON.
          dateISO: r.data.date.toISOString(),
        })).map(({ date: _date, ...rest }) => rest),
      },
    });
    const PREVIEW = 20;
    return NextResponse.json({
      ok: true,
      kind: 'proposal',
      surface: 'reconcile_csv_timesheets',
      token,
      title: `Import ${create} timesheet entries (skip ${skip})`,
      fields: [
        { label: 'Parsed', value: `${total} rows` },
        { label: 'Create', value: String(create) },
        ...(skip > 0 ? [{ label: 'Skip', value: String(skip) }] : []),
        ...plan.rows.slice(0, PREVIEW).map((r) => ({
          label: `${r.action} · row ${r.lineNo}`,
          value: r.note,
        })),
        ...(plan.rows.length > PREVIEW
          ? [{ label: '…', value: `${plan.rows.length - PREVIEW} more rows not shown` }]
          : []),
      ],
      confirmLabel: `Write ${create}`,
      summary: `Timesheets CSV: ${create} create, ${skip} skip. Auto-approved on apply.`,
    });
  }

  if (resolvedType === 'contractor_invoices') {
    const result = await planContractorInvoiceImport(text);
    if (!result.ok) {
      return NextResponse.json({ error: 'parse_failed', message: result.error }, { status: 400 });
    }
    const { plan } = result;
    const { create, skip, total } = plan.counts;
    if (create === 0) {
      return NextResponse.json({
        ok: true,
        kind: 'no_op',
        message: `Parsed ${total} rows but nothing to write — ${skip} skipped. Common cause: people CSV not yet imported.`,
        plan,
      });
    }
    const writable = plan.rows.filter((r): r is typeof r & { data: NonNullable<typeof r.data> } =>
      r.action === 'create' && r.data !== undefined,
    );
    const token = signPrefillToken({
      kind: 'reconcile_csv_contractor_invoices',
      personId: session.person.id,
      payload: {
        rows: writable.map((r) => ({
          ...r.data,
          periodAnchorISO: r.data.periodAnchor.toISOString(),
        })).map(({ periodAnchor: _pa, ...rest }) => rest),
      },
    });
    const PREVIEW = 25;
    return NextResponse.json({
      ok: true,
      kind: 'proposal',
      surface: 'reconcile_csv_contractor_invoices',
      token,
      title: `Import ${create} contractor invoices`,
      fields: [
        { label: 'Parsed', value: `${total} rows` },
        { label: 'Create', value: String(create) },
        ...(skip > 0 ? [{ label: 'Skip', value: String(skip) }] : []),
        { label: 'Total hours', value: plan.totals.hours.toLocaleString('en-AU') },
        { label: 'Total ex-GST', value: `AUD ${(plan.totals.amountExGst / 100).toLocaleString('en-AU')}` },
        ...plan.rows.slice(0, PREVIEW).map((r) => ({
          label: `${r.action} · row ${r.lineNo}`,
          value: r.note,
        })),
        ...(plan.rows.length > PREVIEW
          ? [{ label: '…', value: `${plan.rows.length - PREVIEW} more rows not shown` }]
          : []),
      ],
      confirmLabel: `Write ${create}`,
      summary: `Contractor invoices: ${create} create, ${skip} skip. Lands in project P&L as consultant cost.`,
    });
  }

  if (resolvedType === 'opex_bills') {
    const result = await planOpexBillImport(text);
    if (!result.ok) {
      return NextResponse.json({ error: 'parse_failed', message: result.error }, { status: 400 });
    }
    const { plan } = result;
    const { create, skip, total } = plan.counts;
    if (create === 0) {
      return NextResponse.json({
        ok: true,
        kind: 'no_op',
        message: `Parsed ${total} rows but nothing to write — ${skip} skipped.`,
        plan,
      });
    }
    const writable = plan.rows.filter((r): r is typeof r & { data: NonNullable<typeof r.data> } =>
      r.action === 'create' && r.data !== undefined,
    );
    const token = signPrefillToken({
      kind: 'reconcile_csv_opex_bills',
      personId: session.person.id,
      payload: {
        rows: writable.map((r) => ({
          ...r.data,
          issueDateISO: r.data.issueDate.toISOString(),
          dueDateISO: r.data.dueDate.toISOString(),
        })).map(({ issueDate: _id, dueDate: _dd, ...rest }) => rest),
      },
    });
    const PREVIEW = 25;
    return NextResponse.json({
      ok: true,
      kind: 'proposal',
      surface: 'reconcile_csv_opex_bills',
      token,
      title: `Import ${create} OPEX bills`,
      fields: [
        { label: 'Parsed', value: `${total} rows` },
        { label: 'Create', value: String(create) },
        ...(skip > 0 ? [{ label: 'Skip', value: String(skip) }] : []),
        { label: 'Total amount', value: `AUD ${(plan.totals.amount / 100).toLocaleString('en-AU')}` },
        ...plan.rows.slice(0, PREVIEW).map((r) => ({
          label: `${r.action} · row ${r.lineNo}`,
          value: r.note,
        })),
        ...(plan.rows.length > PREVIEW
          ? [{ label: '…', value: `${plan.rows.length - PREVIEW} more rows not shown` }]
          : []),
      ],
      confirmLabel: `Write ${create}`,
      summary: `OPEX bills: ${create} create, ${skip} skip. Marked paid; cross-references project codes from charge codes.`,
    });
  }

  return NextResponse.json(
    { error: 'unsupported_type', message: `Type "${type}" not supported. Use projects | people | timesheets | contractor_invoices | opex_bills | brief.` },
    { status: 400 },
  );
}
