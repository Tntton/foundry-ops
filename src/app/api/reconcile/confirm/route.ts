import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { getSession } from '@/server/session';
import { hasAnyRole, type Session } from '@/server/roles';
import { writeAudit } from '@/server/audit';
import { verifyPrefillToken } from '@/server/agents/assistant/prefill/token';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const BodySchema = z.object({
  token: z.string().min(1),
  kind: z.enum([
    'reconcile_update',
    'reconcile_bulk',
    'reconcile_csv_projects',
    'reconcile_csv_people',
    'reconcile_csv_timesheets',
    'reconcile_brief',
    'reconcile_sharepoint_link',
    'reconcile_csv_contractor_invoices',
    'reconcile_csv_opex_bills',
  ]),
});

// ── Single-row update payload ────────────────────────────────────────
const UpdatePayloadSchema = z.object({
  entityType: z.enum(['project']),
  entityId: z.string().min(1),
  field: z.enum([
    'contractValue',
    'name',
    'description',
    'startDate',
    'endDate',
    'actualEndDate',
    'sharepointFolderUrl',
    'sharepointAdminFolderUrl',
    'stage',
  ]),
  valueRaw: z.string().max(2000),
});

const STAGES = ['kickoff', 'delivery', 'closing', 'archived', 'standing', 'benched'] as const;
type Stage = (typeof STAGES)[number];

function coerce(field: z.infer<typeof UpdatePayloadSchema>['field'], raw: string):
  | { ok: true; value: unknown }
  | { ok: false; reason: string } {
  const v = raw.trim();
  if (field === 'contractValue') {
    const num = Number(v.replace(/[,$]/g, ''));
    if (!Number.isFinite(num) || num < 0) return { ok: false, reason: 'contractValue must be non-negative number.' };
    return { ok: true, value: Math.round(num * 100) };
  }
  if (field === 'startDate' || field === 'endDate' || field === 'actualEndDate') {
    if (v === '' || v.toLowerCase() === 'null') return { ok: true, value: null };
    const d = new Date(v);
    if (!Number.isFinite(d.getTime())) return { ok: false, reason: `${field} unparseable.` };
    return { ok: true, value: d };
  }
  if (field === 'stage') {
    if (!(STAGES as readonly string[]).includes(v)) {
      return { ok: false, reason: `stage must be one of ${STAGES.join(', ')}.` };
    }
    return { ok: true, value: v as Stage };
  }
  if (v === '' || v.toLowerCase() === 'null') {
    if (field === 'name') return { ok: false, reason: 'name cannot be empty.' };
    return { ok: true, value: null };
  }
  return { ok: true, value: v };
}

// ── Bulk payload ─────────────────────────────────────────────────────
const BulkPayloadSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('archive_stale'),
    cutoffIso: z.string(),
    projectIds: z.array(z.string()).min(1).max(500),
  }),
  z.object({
    mode: z.literal('reconcile_actual_end'),
    source: z.enum(['today', 'endDate']),
    projectIds: z.array(z.string()).min(1).max(500),
  }),
  z.object({
    mode: z.literal('reassign_lead'),
    role: z.enum(['primaryPartner', 'manager']),
    assigneeId: z.string().min(1),
    projectIds: z.array(z.string()).min(1).max(500),
  }),
  z.object({
    mode: z.literal('stage_transition'),
    toStage: z.enum(STAGES),
    projectIds: z.array(z.string()).min(1).max(500),
  }),
]);
type BulkPayload = z.infer<typeof BulkPayloadSchema>;

/**
 * POST /api/reconcile/confirm — verifies a reconcile_update or
 * reconcile_bulk token and applies the underlying mutation inside a
 * transaction with per-row audit. Super-admin gated.
 */
export async function POST(req: Request): Promise<Response> {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }
  if (!hasAnyRole(session, ['super_admin'])) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_body', message: parsed.error.issues[0]?.message ?? 'Invalid input' },
      { status: 400 },
    );
  }

  const verify = verifyPrefillToken(parsed.data.token, {
    personId: session.person.id,
    kind: parsed.data.kind,
  });
  if (!verify.ok) {
    return NextResponse.json(
      {
        error: 'token_invalid',
        reason: verify.reason,
        message:
          verify.reason === 'expired'
            ? 'Proposal expired (15-min TTL). Ask the assistant again.'
            : verify.reason === 'wrong_person'
              ? "That proposal wasn't for your account."
              : 'Proposal invalid.',
      },
      { status: 400 },
    );
  }

  if (parsed.data.kind === 'reconcile_update') {
    return applySingleUpdate(session, verify.payload.payload);
  }
  if (parsed.data.kind === 'reconcile_bulk') {
    return applyBulk(session, verify.payload.payload);
  }
  if (parsed.data.kind === 'reconcile_csv_projects') {
    return applyCsvProjects(session, verify.payload.payload);
  }
  if (parsed.data.kind === 'reconcile_csv_people') {
    return applyCsvPeople(session, verify.payload.payload);
  }
  if (parsed.data.kind === 'reconcile_csv_timesheets') {
    return applyCsvTimesheets(session, verify.payload.payload);
  }
  if (parsed.data.kind === 'reconcile_brief') {
    return applyBrief(session, verify.payload.payload);
  }
  if (parsed.data.kind === 'reconcile_csv_contractor_invoices') {
    return applyCsvContractorInvoices(session, verify.payload.payload);
  }
  if (parsed.data.kind === 'reconcile_csv_opex_bills') {
    return applyCsvOpexBills(session, verify.payload.payload);
  }
  return applySharepointLink(session, verify.payload.payload);
}

async function applySingleUpdate(session: Session, raw: unknown): Promise<Response> {
  const payload = UpdatePayloadSchema.safeParse(raw);
  if (!payload.success) {
    return NextResponse.json({ error: 'malformed_proposal' }, { status: 400 });
  }
  const { entityType, entityId, field, valueRaw } = payload.data;
  const coerced = coerce(field, valueRaw);
  if (!coerced.ok) {
    return NextResponse.json({ error: 'invalid_value', message: coerced.reason }, { status: 400 });
  }
  if (entityType !== 'project') {
    return NextResponse.json({ error: 'unsupported_entity' }, { status: 400 });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const before = await tx.project.findUnique({
        where: { id: entityId },
        select: {
          id: true, code: true, name: true, description: true,
          contractValue: true, startDate: true, endDate: true,
          actualEndDate: true, sharepointFolderUrl: true,
          sharepointAdminFolderUrl: true, stage: true,
        },
      });
      if (!before) throw new Error('project_not_found');
      const beforeVal = (before as Record<string, unknown>)[field];
      const updated = await tx.project.update({
        where: { id: entityId },
        data: { [field]: coerced.value } as Record<string, unknown>,
        select: { id: true, code: true },
      });
      await writeAudit(tx, {
        actor: { type: 'person', id: session.person.id },
        action: 'updated',
        entity: {
          type: 'project',
          id: entityId,
          before: { [field]: beforeVal as never },
          after: { [field]: coerced.value as never },
        },
        source: 'agent',
      });
      return updated;
    });
    return NextResponse.json({
      ok: true,
      project: { id: result.id, code: result.code },
      field,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'update_failed';
    if (msg === 'project_not_found') {
      return NextResponse.json({ error: 'project_not_found' }, { status: 404 });
    }
    console.error('[reconcile/confirm] single failed:', err);
    return NextResponse.json({ error: 'update_failed' }, { status: 500 });
  }
}

// ── CSV — projects ────────────────────────────────────────────────────
const CsvProjectsPayloadSchema = z.object({
  rows: z
    .array(
      z.object({
        action: z.enum(['create', 'update']),
        code: z.string().min(1),
        data: z.object({
          code: z.string().min(1),
          clientId: z.string().min(1),
          name: z.string().min(1),
          description: z.string().nullable(),
          contractValueCents: z.number().int().nonnegative(),
          startDate: z.coerce.date().nullable(),
          endDate: z.coerce.date().nullable(),
          actualEndDate: z.coerce.date().nullable(),
          primaryPartnerId: z.string().min(1),
          managerId: z.string().min(1),
          sharepointFolderUrl: z.string().nullable(),
          sharepointAdminFolderUrl: z.string().nullable(),
          stage: z.enum(STAGES),
        }),
      }),
    )
    .min(1)
    .max(5000),
});

async function applyCsvProjects(session: Session, raw: unknown): Promise<Response> {
  const payload = CsvProjectsPayloadSchema.safeParse(raw);
  if (!payload.success) {
    return NextResponse.json({ error: 'malformed_proposal' }, { status: 400 });
  }
  const { rows } = payload.data;
  try {
    const result = await prisma.$transaction(async (tx) => {
      let created = 0;
      let updated = 0;
      for (const row of rows) {
        const d = row.data;
        if (row.action === 'create') {
          await tx.project.create({
            data: {
              code: d.code,
              clientId: d.clientId,
              name: d.name,
              description: d.description,
              contractValue: d.contractValueCents,
              startDate: d.startDate,
              endDate: d.endDate,
              actualEndDate: d.actualEndDate,
              primaryPartnerId: d.primaryPartnerId,
              managerId: d.managerId,
              sharepointFolderUrl: d.sharepointFolderUrl,
              sharepointAdminFolderUrl: d.sharepointAdminFolderUrl,
              stage: d.stage,
            },
          });
          created += 1;
        } else {
          await tx.project.update({
            where: { code: d.code },
            data: {
              name: d.name,
              description: d.description,
              contractValue: d.contractValueCents,
              startDate: d.startDate,
              endDate: d.endDate,
              actualEndDate: d.actualEndDate,
              primaryPartnerId: d.primaryPartnerId,
              managerId: d.managerId,
              sharepointFolderUrl: d.sharepointFolderUrl,
              sharepointAdminFolderUrl: d.sharepointAdminFolderUrl,
              stage: d.stage,
            },
          });
          updated += 1;
        }
        await writeAudit(tx, {
          actor: { type: 'person', id: session.person.id },
          action: row.action === 'create' ? 'created' : 'updated',
          entity: {
            type: 'project',
            id: d.code,
            after: { csvImport: true, code: d.code, action: row.action } as never,
          },
          source: 'agent',
        });
      }
      return { created, updated };
    });
    return NextResponse.json({
      ok: true,
      mode: 'csv_projects',
      created: result.created,
      updated: result.updated,
    });
  } catch (err) {
    console.error('[reconcile/confirm] csv projects failed:', err);
    return NextResponse.json({ error: 'csv_apply_failed' }, { status: 500 });
  }
}

// ── CSV — people (upsert by email) ────────────────────────────────────
const PeoplePayloadSchema = z.object({
  rows: z
    .array(
      z.object({
        action: z.enum(['create', 'update']),
        email: z.string().email(),
        data: z.object({
          email: z.string().email(),
          firstName: z.string().min(1),
          lastName: z.string().min(1),
          initials: z.string().min(1),
          band: z.enum(['MP', 'Partner', 'Associate_Partner', 'Expert', 'Consultant', 'Analyst', 'Support_Staff']),
          level: z.string().min(1),
          employment: z.enum(['ft', 'contractor']),
          roles: z
            .array(z.enum(['super_admin', 'admin', 'partner', 'associate_partner', 'manager', 'staff']))
            .min(1),
          rate: z.number().int().nonnegative(),
          rateUnit: z.enum(['hour', 'day']),
          whatsappNumber: z.string().nullable(),
          region: z.string().length(2),
          startDate: z.coerce.date(),
          endDate: z.coerce.date().nullable(),
        }),
      }),
    )
    .min(1)
    .max(5000),
});

async function applyCsvPeople(session: Session, raw: unknown): Promise<Response> {
  const payload = PeoplePayloadSchema.safeParse(raw);
  if (!payload.success) {
    return NextResponse.json({ error: 'malformed_proposal' }, { status: 400 });
  }
  const { rows } = payload.data;
  try {
    const result = await prisma.$transaction(async (tx) => {
      let created = 0;
      let updated = 0;
      for (const row of rows) {
        const d = row.data;
        if (row.action === 'create') {
          await tx.person.create({
            data: {
              email: d.email,
              firstName: d.firstName,
              lastName: d.lastName,
              initials: d.initials,
              band: d.band,
              level: d.level,
              employment: d.employment,
              roles: d.roles,
              rate: d.rate,
              rateUnit: d.rateUnit,
              whatsappNumber: d.whatsappNumber,
              region: d.region,
              startDate: d.startDate,
              endDate: d.endDate,
            },
          });
          created += 1;
        } else {
          await tx.person.update({
            where: { email: d.email },
            data: {
              firstName: d.firstName,
              lastName: d.lastName,
              initials: d.initials,
              band: d.band,
              level: d.level,
              employment: d.employment,
              roles: d.roles,
              rate: d.rate,
              rateUnit: d.rateUnit,
              whatsappNumber: d.whatsappNumber,
              region: d.region,
              startDate: d.startDate,
              endDate: d.endDate,
            },
          });
          updated += 1;
        }
        await writeAudit(tx, {
          actor: { type: 'person', id: session.person.id },
          action: row.action === 'create' ? 'created' : 'updated',
          entity: {
            type: 'person',
            id: d.email,
            after: { csvImport: true, email: d.email } as never,
          },
          source: 'agent',
        });
      }
      return { created, updated };
    });
    return NextResponse.json({ ok: true, mode: 'csv_people', created: result.created, updated: result.updated });
  } catch (err) {
    console.error('[reconcile/confirm] csv people failed:', err);
    return NextResponse.json({ error: 'csv_apply_failed' }, { status: 500 });
  }
}

// ── CSV — timesheets (write-once create) ──────────────────────────────
const TimesheetsPayloadSchema = z.object({
  rows: z
    .array(
      z.object({
        personId: z.string().min(1),
        projectId: z.string().min(1),
        dateISO: z.string(),
        hours: z.number().min(0.5).max(24),
        description: z.string().max(300).default(''),
      }),
    )
    .min(1)
    .max(5000),
});

async function applyCsvTimesheets(session: Session, raw: unknown): Promise<Response> {
  const payload = TimesheetsPayloadSchema.safeParse(raw);
  if (!payload.success) {
    return NextResponse.json({ error: 'malformed_proposal' }, { status: 400 });
  }
  const { rows } = payload.data;
  const now = new Date();
  try {
    const result = await prisma.$transaction(async (tx) => {
      // Ensure every (person, project) pair has a ProjectTeam row so
      // resourcing surfaces register the imported hours — same
      // behaviour as saveTimesheet (resource-planning checks team
      // membership, not just timesheet entries).
      const seen = new Set<string>();
      for (const r of rows) {
        const key = `${r.personId}|${r.projectId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        await tx.projectTeam.upsert({
          where: { projectId_personId: { projectId: r.projectId, personId: r.personId } },
          create: {
            projectId: r.projectId,
            personId: r.personId,
            roleOnProject: 'Imported via reconcile CSV',
            allocationPct: 0,
          },
          update: {},
        });
      }
      let created = 0;
      for (const r of rows) {
        await tx.timesheetEntry.create({
          data: {
            personId: r.personId,
            projectId: r.projectId,
            date: new Date(r.dateISO),
            hours: r.hours,
            description: r.description,
            // Super-admin imports are pre-approved historical entries
            // — same semantics as the manual /admin/import/timesheets
            // flow + saveTimesheet's super-admin auto-approve path.
            status: 'approved',
            approvedById: session.person.id,
            approvedAt: now,
          },
        });
        created += 1;
      }
      await writeAudit(tx, {
        actor: { type: 'person', id: session.person.id },
        action: 'created',
        entity: {
          type: 'timesheet_csv_import',
          id: now.toISOString(),
          after: { rows: created, source: 'reconcile_csv' } as never,
        },
        source: 'agent',
      });
      return { created };
    });
    return NextResponse.json({ ok: true, mode: 'csv_timesheets', created: result.created });
  } catch (err) {
    console.error('[reconcile/confirm] csv timesheets failed:', err);
    return NextResponse.json({ error: 'csv_apply_failed' }, { status: 500 });
  }
}

// ── CSV — contractor invoices (write-once, historical aggregates) ────
const ContractorInvoicesPayloadSchema = z.object({
  rows: z
    .array(
      z.object({
        personId: z.string().min(1),
        projectId: z.string().min(1),
        hours: z.number().nonnegative(),
        amountExGst: z.number().int().nonnegative(),
        gst: z.number().int().nonnegative(),
        periodLabel: z.string(),
        periodAnchorISO: z.string(),
        roleOnInvoice: z.string().nullable(),
        notes: z.string().nullable(),
      }),
    )
    .min(1)
    .max(5000),
});

async function applyCsvContractorInvoices(session: Session, raw: unknown): Promise<Response> {
  const payload = ContractorInvoicesPayloadSchema.safeParse(raw);
  if (!payload.success) {
    return NextResponse.json({ error: 'malformed_proposal' }, { status: 400 });
  }
  const { rows } = payload.data;
  try {
    const result = await prisma.$transaction(async (tx) => {
      // Ensure (person, project) is on the team — same reasoning as
      // the timesheet importer.
      const seen = new Set<string>();
      for (const r of rows) {
        const key = `${r.personId}|${r.projectId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        await tx.projectTeam.upsert({
          where: { projectId_personId: { projectId: r.projectId, personId: r.personId } },
          create: {
            projectId: r.projectId,
            personId: r.personId,
            roleOnProject: 'Contractor (historical)',
            allocationPct: 0,
          },
          update: {},
        });
      }
      let created = 0;
      for (const r of rows) {
        await tx.contractorInvoice.create({
          data: {
            personId: r.personId,
            projectId: r.projectId,
            hours: r.hours,
            amountExGst: r.amountExGst,
            gst: r.gst,
            periodLabel: r.periodLabel,
            periodAnchor: new Date(r.periodAnchorISO),
            roleOnInvoice: r.roleOnInvoice,
            notes: r.notes,
          },
        });
        created += 1;
      }
      await writeAudit(tx, {
        actor: { type: 'person', id: session.person.id },
        action: 'created',
        entity: {
          type: 'contractor_invoice_csv_import',
          id: new Date().toISOString(),
          after: { rows: created, source: 'reconcile_csv' } as never,
        },
        source: 'agent',
      });
      return { created };
    });
    return NextResponse.json({ ok: true, mode: 'csv_contractor_invoices', created: result.created });
  } catch (err) {
    console.error('[reconcile/confirm] contractor invoices failed:', err);
    return NextResponse.json({ error: 'csv_apply_failed' }, { status: 500 });
  }
}

// ── CSV — OPEX bills (write-once, historical) ─────────────────────────
const OpexBillsPayloadSchema = z.object({
  rows: z
    .array(
      z.object({
        projectId: z.string().min(1),
        supplierName: z.string().min(1),
        category: z.string().min(1),
        amountTotal: z.number().int(),
        gst: z.number().int().nonnegative(),
        issueDateISO: z.string(),
        dueDateISO: z.string(),
        notes: z.string().nullable(),
        status: z.enum(['pending_review', 'approved', 'scheduled_for_payment', 'paid', 'rejected']),
      }),
    )
    .min(1)
    .max(5000),
});

async function applyCsvOpexBills(session: Session, raw: unknown): Promise<Response> {
  const payload = OpexBillsPayloadSchema.safeParse(raw);
  if (!payload.success) {
    return NextResponse.json({ error: 'malformed_proposal' }, { status: 400 });
  }
  const { rows } = payload.data;
  try {
    const result = await prisma.$transaction(async (tx) => {
      let created = 0;
      for (const r of rows) {
        await tx.bill.create({
          data: {
            supplierName: r.supplierName,
            receivedVia: 'opex_import',
            issueDate: new Date(r.issueDateISO),
            dueDate: new Date(r.dueDateISO),
            amountTotal: r.amountTotal,
            gst: r.gst,
            category: r.category,
            projectId: r.projectId,
            status: r.status,
          },
        });
        created += 1;
      }
      await writeAudit(tx, {
        actor: { type: 'person', id: session.person.id },
        action: 'created',
        entity: {
          type: 'opex_bill_csv_import',
          id: new Date().toISOString(),
          after: { rows: created, source: 'reconcile_csv' } as never,
        },
        source: 'agent',
      });
      return { created };
    });
    return NextResponse.json({ ok: true, mode: 'csv_opex_bills', created: result.created });
  } catch (err) {
    console.error('[reconcile/confirm] opex bills failed:', err);
    return NextResponse.json({ error: 'csv_apply_failed' }, { status: 500 });
  }
}

// ── SharePoint link — set sharepointFolderUrl + sharepointAdminFolderUrl ──
const SharepointLinkPayloadSchema = z.object({
  projectId: z.string().min(1),
  teamUrl: z.string().nullable(),
  adminUrl: z.string().nullable(),
});

async function applySharepointLink(session: Session, raw: unknown): Promise<Response> {
  const payload = SharepointLinkPayloadSchema.safeParse(raw);
  if (!payload.success) {
    return NextResponse.json({ error: 'malformed_proposal' }, { status: 400 });
  }
  const p = payload.data;
  if (!p.teamUrl && !p.adminUrl) {
    return NextResponse.json({ error: 'no_op_proposal' }, { status: 400 });
  }
  try {
    const result = await prisma.$transaction(async (tx) => {
      const before = await tx.project.findUnique({
        where: { id: p.projectId },
        select: {
          id: true, code: true,
          sharepointFolderUrl: true, sharepointAdminFolderUrl: true,
        },
      });
      if (!before) throw new Error('project_not_found');
      const data: Record<string, string> = {};
      if (p.teamUrl) data.sharepointFolderUrl = p.teamUrl;
      if (p.adminUrl) data.sharepointAdminFolderUrl = p.adminUrl;
      const updated = await tx.project.update({
        where: { id: p.projectId },
        data,
        select: { id: true, code: true },
      });
      await writeAudit(tx, {
        actor: { type: 'person', id: session.person.id },
        action: 'updated',
        entity: {
          type: 'project',
          id: p.projectId,
          before: {
            sharepointFolderUrl: before.sharepointFolderUrl,
            sharepointAdminFolderUrl: before.sharepointAdminFolderUrl,
          } as never,
          after: { ...data, source: 'sharepoint_discovery' } as never,
        },
        source: 'agent',
      });
      return updated;
    });
    return NextResponse.json({ ok: true, mode: 'sharepoint_link', project: result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'sharepoint_link_failed';
    if (msg === 'project_not_found') {
      return NextResponse.json({ error: 'project_not_found' }, { status: 404 });
    }
    console.error('[reconcile/confirm] sharepoint link failed:', err);
    return NextResponse.json({ error: 'sharepoint_link_failed' }, { status: 500 });
  }
}

// ── Brief — creates a new Project from a PDF extraction ────────────────
const BriefPayloadSchema = z.object({
  clientId: z.string().min(1),
  clientCode: z.string().min(1),
  projectName: z.string().min(1),
  scopeSummary: z.string().nullable(),
  startDate: z.string().nullable(),
  endDate: z.string().nullable(),
  contractValueCents: z.number().int().nonnegative(),
  primaryPartnerId: z.string().min(1),
  managerId: z.string().min(1),
});

/**
 * Allocate the next free `<clientCode>NNN` project code. Bumps off
 * the max existing suffix so concurrent creates are still unique (DB
 * unique constraint on `code` is the real backstop).
 */
async function nextProjectCode(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  clientCode: string,
): Promise<string> {
  const existing = await tx.project.findMany({
    where: { code: { startsWith: clientCode } },
    select: { code: true },
  });
  let max = 0;
  for (const p of existing) {
    const m = new RegExp(`^${clientCode}(\\d{3,})$`).exec(p.code);
    if (m) {
      const n = Number(m[1]);
      if (Number.isFinite(n) && n > max) max = n;
    }
  }
  const next = max + 1;
  return `${clientCode}${next.toString().padStart(3, '0')}`;
}

async function applyBrief(session: Session, raw: unknown): Promise<Response> {
  const payload = BriefPayloadSchema.safeParse(raw);
  if (!payload.success) {
    return NextResponse.json({ error: 'malformed_proposal' }, { status: 400 });
  }
  const p = payload.data;
  try {
    const result = await prisma.$transaction(async (tx) => {
      const code = await nextProjectCode(tx, p.clientCode);
      const created = await tx.project.create({
        data: {
          code,
          clientId: p.clientId,
          name: p.projectName,
          description: p.scopeSummary,
          contractValue: p.contractValueCents,
          startDate: p.startDate ? new Date(p.startDate) : null,
          endDate: p.endDate ? new Date(p.endDate) : null,
          primaryPartnerId: p.primaryPartnerId,
          managerId: p.managerId,
          stage: 'kickoff',
        },
        select: { id: true, code: true },
      });
      await writeAudit(tx, {
        actor: { type: 'person', id: session.person.id },
        action: 'created',
        entity: {
          type: 'project',
          id: created.id,
          after: { code: created.code, source: 'brief_extraction' } as never,
        },
        source: 'agent',
      });
      return created;
    });
    return NextResponse.json({
      ok: true,
      mode: 'brief',
      project: { id: result.id, code: result.code },
    });
  } catch (err) {
    console.error('[reconcile/confirm] brief failed:', err);
    return NextResponse.json({ error: 'brief_apply_failed' }, { status: 500 });
  }
}

async function applyBulk(session: Session, raw: unknown): Promise<Response> {
  const payload = BulkPayloadSchema.safeParse(raw);
  if (!payload.success) {
    return NextResponse.json({ error: 'malformed_proposal' }, { status: 400 });
  }
  const p: BulkPayload = payload.data;

  try {
    const result = await prisma.$transaction(async (tx) => {
      // Re-fetch the affected rows so we audit a real "before" snapshot,
      // not the (potentially stale) snapshot the propose tool captured.
      const rows = await tx.project.findMany({
        where: { id: { in: p.projectIds } },
        select: {
          id: true, code: true, stage: true, endDate: true,
          actualEndDate: true, primaryPartnerId: true, managerId: true,
        },
      });
      if (rows.length === 0) {
        throw new Error('no_rows');
      }
      let updatedCount = 0;
      for (const row of rows) {
        const data: Record<string, unknown> = {};
        const before: Record<string, unknown> = {};
        const after: Record<string, unknown> = {};

        if (p.mode === 'archive_stale') {
          if (row.stage === 'archived') continue;
          before.stage = row.stage;
          after.stage = 'archived';
          data.stage = 'archived';
        } else if (p.mode === 'reconcile_actual_end') {
          if (row.actualEndDate !== null) continue;
          const value = p.source === 'today' ? new Date() : row.endDate;
          if (!value) continue;
          before.actualEndDate = null;
          after.actualEndDate = value;
          data.actualEndDate = value;
        } else if (p.mode === 'reassign_lead') {
          const field = p.role === 'primaryPartner' ? 'primaryPartnerId' : 'managerId';
          const currentId = row[field as 'primaryPartnerId' | 'managerId'];
          if (currentId === p.assigneeId) continue;
          before[field] = currentId;
          after[field] = p.assigneeId;
          data[field] = p.assigneeId;
        } else if (p.mode === 'stage_transition') {
          if (row.stage === p.toStage) continue;
          before.stage = row.stage;
          after.stage = p.toStage;
          data.stage = p.toStage;
        }

        if (Object.keys(data).length === 0) continue;

        await tx.project.update({ where: { id: row.id }, data });
        await writeAudit(tx, {
          actor: { type: 'person', id: session.person.id },
          action: 'updated',
          entity: {
            type: 'project',
            id: row.id,
            before: before as never,
            after: { ...(after as Record<string, unknown>), bulkMode: p.mode } as never,
          },
          source: 'agent',
        });
        updatedCount += 1;
      }
      return { updatedCount, totalCandidates: rows.length };
    });
    return NextResponse.json({
      ok: true,
      mode: p.mode,
      updated: result.updatedCount,
      total: result.totalCandidates,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'bulk_failed';
    if (msg === 'no_rows') {
      return NextResponse.json({ error: 'no_rows' }, { status: 404 });
    }
    console.error('[reconcile/confirm] bulk failed:', err);
    return NextResponse.json({ error: 'bulk_failed' }, { status: 500 });
  }
}
