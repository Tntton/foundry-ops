import { z } from 'zod';
import type { ProjectStage } from '@prisma/client';
import { prisma } from '@/server/db';
import { signPrefillToken } from '@/server/agents/assistant/prefill/token';
import { startOfCurrentAuFy } from '@/lib/au-fy';
import type { ToolDefinition } from './types';

/**
 * Bulk-update tools for the reconcile assistant. Four modes that
 * cover the patterns TT picked in the scoping:
 *
 *   1. archive_stale       — projects in closing/delivery whose
 *                            actualEndDate (or endDate, fallback) is
 *                            before the FY cutoff → stage='archived'.
 *   2. reconcile_actual_end — projects past their endDate with no
 *                            actualEndDate → actualEndDate := endDate.
 *   3. reassign_lead       — bulk-set primaryPartnerId / managerId on a
 *                            filtered set of projects.
 *   4. stage_transition    — bulk-move projects from a `from` stage to a
 *                            `to` stage on a filtered set.
 *
 * Every mode follows the same agent loop:
 *   - Tool computes the affected row set (capped at PREVIEW_CAP for the
 *     diff card) and returns a signed `reconcile_bulk` token whose
 *     payload describes the operation.
 *   - The confirm endpoint at /api/reconcile/confirm decodes the token,
 *     re-runs the filter (avoids confirming a snapshot that's drifted),
 *     applies the update in a single transaction, and writes one
 *     AuditEvent per affected row.
 */

const PREVIEW_CAP = 30;
/** Hard cap on rows touched by a single bulk operation — guard against
 *  agent confusion. The agent can split into multiple proposals if more
 *  is genuinely needed. */
const BULK_HARD_CAP = 200;

// Shared filter helpers ──────────────────────────────────────────────

/** Restrict every bulk op to real engagements unless the user explicitly
 *  opts FH-* in. Bucket projects (FHB000/FHO000/FHX000/FHP*) should
 *  almost never be subject to bulk mutations. */
function excludeInternalFh<T extends Record<string, unknown>>(where: T): T {
  return {
    ...where,
    code: { not: { startsWith: 'FH' } },
  };
}

// ────────────────────────────────────────────────────────────────────
// 1. propose_bulk_archive_stale
// ────────────────────────────────────────────────────────────────────

const ArchiveInputSchema = z.object({
  /** Cut-off in ISO format (YYYY-MM-DD). Projects whose actualEndDate
   *  (or endDate fallback) is BEFORE this date are flagged. Defaults
   *  to the start of the current AU FY. */
  cutoffIso: z.string().optional(),
  /** Optional FY label override — agent can pass "FY24" and we resolve
   *  it to 2023-07-01. Takes precedence over cutoffIso. */
  fyLabel: z.string().optional(),
});

function resolveCutoff(input: z.infer<typeof ArchiveInputSchema>): Date {
  if (input.fyLabel) {
    const m = /^FY(\d{2})$/.exec(input.fyLabel);
    if (m) {
      // FY24 = year ending 2024 = starts 1 Jul 2023.
      const yearEnding = 2000 + Number(m[1]);
      return new Date(Date.UTC(yearEnding - 1, 6, 1));
    }
  }
  if (input.cutoffIso) {
    const d = new Date(input.cutoffIso);
    if (Number.isFinite(d.getTime())) return d;
  }
  return startOfCurrentAuFy();
}

export const proposeBulkArchiveStale: ToolDefinition = {
  spec: {
    name: 'propose_bulk_archive_stale',
    description:
      'Propose archiving client projects that are still in closing or delivery but whose end date (actual or planned) is before a cutoff. Defaults to the start of the current AU financial year — i.e. "archive everything that should have wrapped by now". FH-* internal projects are excluded by default.',
    input_schema: {
      type: 'object',
      properties: {
        cutoffIso: {
          type: 'string',
          description:
            'ISO date (YYYY-MM-DD). Projects ending before this are flagged. Default: start of current AU FY.',
        },
        fyLabel: {
          type: 'string',
          description:
            'Short FY label like "FY24" or "FY26". Resolves to 1 Jul of (FY year - 1). Takes precedence over cutoffIso.',
        },
      },
    },
  },
  async run(ctx, input) {
    const parsed = ArchiveInputSchema.safeParse(input);
    if (!parsed.success) {
      return { error: `invalid_input: ${parsed.error.issues[0]?.message ?? 'bad shape'}` };
    }
    const cutoff = resolveCutoff(parsed.data);
    const rows = await prisma.project.findMany({
      where: excludeInternalFh({
        stage: { in: ['closing', 'delivery'] as ProjectStage[] },
        OR: [
          { actualEndDate: { lt: cutoff } },
          { actualEndDate: null, endDate: { lt: cutoff } },
        ],
      }),
      orderBy: { code: 'asc' },
      take: BULK_HARD_CAP,
      select: {
        id: true,
        code: true,
        name: true,
        stage: true,
        endDate: true,
        actualEndDate: true,
      },
    });
    if (rows.length === 0) {
      return {
        kind: 'no_op' as const,
        message: `No client projects to archive — every closing/delivery project has a current (or future) end date relative to ${cutoff.toISOString().slice(0, 10)}.`,
      };
    }
    const cutoffStr = cutoff.toISOString().slice(0, 10);
    const token = signPrefillToken({
      kind: 'reconcile_bulk',
      personId: ctx.session.person.id,
      payload: {
        mode: 'archive_stale' as const,
        cutoffIso: cutoffStr,
        projectIds: rows.map((r) => r.id),
      },
    });
    const preview = rows.slice(0, PREVIEW_CAP);
    return {
      kind: 'proposal' as const,
      surface: 'reconcile_bulk_archive_stale',
      token,
      title: `Archive ${rows.length} stale ${rows.length === 1 ? 'project' : 'projects'}`,
      fields: [
        { label: 'Cutoff', value: cutoffStr },
        { label: 'Affected', value: `${rows.length} project${rows.length === 1 ? '' : 's'}` },
        ...preview.map((r) => ({
          label: r.code,
          value: `${r.name} · ${r.stage} · ended ${(r.actualEndDate ?? r.endDate)?.toISOString().slice(0, 10) ?? '—'}`,
        })),
        ...(rows.length > PREVIEW_CAP
          ? [{ label: '…', value: `${rows.length - PREVIEW_CAP} more not shown` }]
          : []),
      ],
      confirmLabel: `Archive ${rows.length}`,
      summary: `Archive ${rows.length} client projects ended before ${cutoffStr}.`,
    };
  },
};

// ────────────────────────────────────────────────────────────────────
// 2. propose_bulk_reconcile_actual_end
// ────────────────────────────────────────────────────────────────────

const ReconcileEndInputSchema = z.object({
  /** "today" (default) — set actualEndDate to today. "endDate" — copy
   *  endDate value across. Picking endDate is the more honest record
   *  but only works when endDate is populated. */
  source: z.enum(['today', 'endDate']).default('endDate'),
});

export const proposeBulkReconcileActualEnd: ToolDefinition = {
  spec: {
    name: 'propose_bulk_reconcile_actual_end',
    description:
      'Propose setting actualEndDate on every project past its planned endDate that has no actualEndDate. Two modes: "endDate" copies the planned end across (default, more honest), "today" stamps the reconciliation date. FH-* internal projects excluded. Stage must be active (kickoff/delivery/closing) — archived rows are skipped.',
    input_schema: {
      type: 'object',
      properties: {
        source: {
          type: 'string',
          enum: ['today', 'endDate'],
          description: 'Where actualEndDate comes from. Default: endDate.',
        },
      },
    },
  },
  async run(ctx, input) {
    const parsed = ReconcileEndInputSchema.safeParse(input);
    if (!parsed.success) {
      return { error: `invalid_input: ${parsed.error.issues[0]?.message ?? 'bad shape'}` };
    }
    const source = parsed.data.source;
    const now = new Date();
    const rows = await prisma.project.findMany({
      where: excludeInternalFh({
        actualEndDate: null,
        endDate: { not: null, lt: now },
        stage: { in: ['kickoff', 'delivery', 'closing'] as ProjectStage[] },
      }),
      orderBy: { code: 'asc' },
      take: BULK_HARD_CAP,
      select: { id: true, code: true, name: true, endDate: true },
    });
    if (rows.length === 0) {
      return {
        kind: 'no_op' as const,
        message: 'No active projects are past their endDate without an actualEndDate.',
      };
    }
    const token = signPrefillToken({
      kind: 'reconcile_bulk',
      personId: ctx.session.person.id,
      payload: {
        mode: 'reconcile_actual_end' as const,
        source,
        projectIds: rows.map((r) => r.id),
      },
    });
    const preview = rows.slice(0, PREVIEW_CAP);
    return {
      kind: 'proposal' as const,
      surface: 'reconcile_bulk_actual_end',
      token,
      title: `Reconcile actualEndDate on ${rows.length} ${rows.length === 1 ? 'project' : 'projects'}`,
      fields: [
        {
          label: 'Source',
          value: source === 'today' ? `today (${now.toISOString().slice(0, 10)})` : 'endDate (planned)',
        },
        { label: 'Affected', value: `${rows.length}` },
        ...preview.map((r) => ({
          label: r.code,
          value: `${r.name} · planned end ${r.endDate?.toISOString().slice(0, 10) ?? '—'}`,
        })),
        ...(rows.length > PREVIEW_CAP
          ? [{ label: '…', value: `${rows.length - PREVIEW_CAP} more not shown` }]
          : []),
      ],
      confirmLabel: `Set ${rows.length} actualEndDate${rows.length === 1 ? '' : 's'}`,
      summary: `Set actualEndDate (${source}) on ${rows.length} overdue projects.`,
    };
  },
};

// ────────────────────────────────────────────────────────────────────
// 3. propose_bulk_reassign_lead
// ────────────────────────────────────────────────────────────────────

const ReassignInputSchema = z.object({
  role: z.enum(['primaryPartner', 'manager']),
  /** Email or full name of the person to assign. Server resolves to id. */
  assigneeRef: z.string().min(1),
  /** Optional filters — restricts which projects get reassigned.
   *  Combined with AND. Skip both → ALL non-FH active projects. */
  codePrefix: z.string().optional(),
  currentLeadEmail: z.string().optional(),
});

export const proposeBulkReassignLead: ToolDefinition = {
  spec: {
    name: 'propose_bulk_reassign_lead',
    description:
      'Propose bulk-reassigning the primary partner OR the manager on a filtered set of projects. Filter by code prefix (e.g. "FHP" for internal projects) and/or by the current lead\'s email (useful for handover when a partner leaves). FH-* projects are included when code prefix targets them explicitly; otherwise excluded.',
    input_schema: {
      type: 'object',
      required: ['role', 'assigneeRef'],
      properties: {
        role: {
          type: 'string',
          enum: ['primaryPartner', 'manager'],
        },
        assigneeRef: {
          type: 'string',
          description: 'New assignee — full email (preferred) or full name to resolve.',
        },
        codePrefix: {
          type: 'string',
          description: 'Restrict to projects whose code starts with this prefix (e.g. "FHP" or "CAC").',
        },
        currentLeadEmail: {
          type: 'string',
          description: 'Restrict to projects currently led by this person (their email).',
        },
      },
    },
  },
  async run(ctx, input) {
    const parsed = ReassignInputSchema.safeParse(input);
    if (!parsed.success) {
      return { error: `invalid_input: ${parsed.error.issues[0]?.message ?? 'bad shape'}` };
    }
    const { role, assigneeRef, codePrefix, currentLeadEmail } = parsed.data;
    // Resolve assignee.
    const isEmail = assigneeRef.includes('@');
    const assignee = await prisma.person.findFirst({
      where: isEmail
        ? { email: { equals: assigneeRef, mode: 'insensitive' } }
        : {
            OR: [
              { initials: { equals: assigneeRef, mode: 'insensitive' } },
              {
                AND: [
                  {
                    firstName: {
                      contains: assigneeRef.split(' ')[0] ?? '',
                      mode: 'insensitive',
                    },
                  },
                  {
                    lastName: {
                      contains: assigneeRef.split(' ').slice(1).join(' ') || '',
                      mode: 'insensitive',
                    },
                  },
                ],
              },
            ],
          },
      select: { id: true, firstName: true, lastName: true, email: true, endDate: true, inactiveAt: true },
    });
    if (!assignee) {
      return { error: `assignee_not_found: no Person matches "${assigneeRef}".` };
    }
    if (assignee.endDate !== null || assignee.inactiveAt !== null) {
      return { error: 'assignee_inactive: cannot reassign to an inactive or end-dated person.' };
    }
    // Resolve currentLead (if filter set).
    let currentLeadId: string | null = null;
    if (currentLeadEmail) {
      const cur = await prisma.person.findFirst({
        where: { email: { equals: currentLeadEmail, mode: 'insensitive' } },
        select: { id: true },
      });
      if (!cur) {
        return { error: `current_lead_not_found: no Person matches "${currentLeadEmail}".` };
      }
      currentLeadId = cur.id;
    }
    // If codePrefix targets FH-* explicitly, allow it through; otherwise exclude.
    const targetsFh = codePrefix?.toUpperCase().startsWith('FH') ?? false;
    const baseWhere: Record<string, unknown> = {
      stage: { not: 'archived' },
      ...(codePrefix
        ? { code: { startsWith: codePrefix.toUpperCase() } }
        : targetsFh
          ? {}
          : { code: { not: { startsWith: 'FH' } } }),
      ...(currentLeadId
        ? role === 'primaryPartner'
          ? { primaryPartnerId: currentLeadId }
          : { managerId: currentLeadId }
        : {}),
    };
    const rows = await prisma.project.findMany({
      where: baseWhere,
      orderBy: { code: 'asc' },
      take: BULK_HARD_CAP,
      select: {
        id: true,
        code: true,
        name: true,
        primaryPartnerId: true,
        managerId: true,
      },
    });
    // Filter out rows already assigned to the target — nothing to do.
    const targetField = role === 'primaryPartner' ? 'primaryPartnerId' : 'managerId';
    const toUpdate = rows.filter((r) => r[targetField as keyof typeof r] !== assignee.id);
    if (toUpdate.length === 0) {
      return {
        kind: 'no_op' as const,
        message: `No projects to reassign — every match is already led by ${assignee.firstName} ${assignee.lastName}.`,
      };
    }
    const token = signPrefillToken({
      kind: 'reconcile_bulk',
      personId: ctx.session.person.id,
      payload: {
        mode: 'reassign_lead' as const,
        role,
        assigneeId: assignee.id,
        projectIds: toUpdate.map((r) => r.id),
      },
    });
    const preview = toUpdate.slice(0, PREVIEW_CAP);
    return {
      kind: 'proposal' as const,
      surface: 'reconcile_bulk_reassign_lead',
      token,
      title: `Reassign ${role} on ${toUpdate.length} ${toUpdate.length === 1 ? 'project' : 'projects'}`,
      fields: [
        { label: 'New assignee', value: `${assignee.firstName} ${assignee.lastName} <${assignee.email ?? '—'}>` },
        { label: 'Role', value: role },
        ...(codePrefix ? [{ label: 'Code prefix', value: codePrefix.toUpperCase() }] : []),
        ...(currentLeadEmail ? [{ label: 'Replacing', value: currentLeadEmail }] : []),
        { label: 'Affected', value: `${toUpdate.length}` },
        ...preview.map((r) => ({ label: r.code, value: r.name })),
        ...(toUpdate.length > PREVIEW_CAP
          ? [{ label: '…', value: `${toUpdate.length - PREVIEW_CAP} more not shown` }]
          : []),
      ],
      confirmLabel: `Reassign ${toUpdate.length}`,
      summary: `Reassign ${role} → ${assignee.firstName} ${assignee.lastName} on ${toUpdate.length} projects.`,
    };
  },
};

// ────────────────────────────────────────────────────────────────────
// 4. propose_bulk_stage_transition
// ────────────────────────────────────────────────────────────────────

const ProjectStageEnum = z.enum([
  'kickoff',
  'delivery',
  'closing',
  'archived',
  'standing',
  'benched',
]);

const StageTransitionInputSchema = z.object({
  fromStage: ProjectStageEnum,
  toStage: ProjectStageEnum,
  codePrefix: z.string().optional(),
  /** Only flag projects whose endDate is before this cutoff. Useful for
   *  "move every delivery → closing if past endDate" sweeps. */
  endedBeforeIso: z.string().optional(),
});

export const proposeBulkStageTransition: ToolDefinition = {
  spec: {
    name: 'propose_bulk_stage_transition',
    description:
      'Propose moving projects from one stage to another in bulk. Optionally filter by code prefix and/or by endDate cutoff. Example: move every "delivery" project past its endDate into "closing".',
    input_schema: {
      type: 'object',
      required: ['fromStage', 'toStage'],
      properties: {
        fromStage: {
          type: 'string',
          enum: ['kickoff', 'delivery', 'closing', 'archived', 'standing', 'benched'],
        },
        toStage: {
          type: 'string',
          enum: ['kickoff', 'delivery', 'closing', 'archived', 'standing', 'benched'],
        },
        codePrefix: {
          type: 'string',
          description: 'Restrict to project codes starting with this prefix.',
        },
        endedBeforeIso: {
          type: 'string',
          description: 'Restrict to projects with endDate before this ISO date.',
        },
      },
    },
  },
  async run(ctx, input) {
    const parsed = StageTransitionInputSchema.safeParse(input);
    if (!parsed.success) {
      return { error: `invalid_input: ${parsed.error.issues[0]?.message ?? 'bad shape'}` };
    }
    const { fromStage, toStage, codePrefix, endedBeforeIso } = parsed.data;
    if (fromStage === toStage) {
      return { error: `noop_transition: fromStage and toStage are both "${fromStage}".` };
    }
    let endedBefore: Date | null = null;
    if (endedBeforeIso) {
      const d = new Date(endedBeforeIso);
      if (!Number.isFinite(d.getTime())) {
        return { error: `invalid_input: endedBeforeIso "${endedBeforeIso}" unparseable.` };
      }
      endedBefore = d;
    }
    const targetsFh = codePrefix?.toUpperCase().startsWith('FH') ?? false;
    const where: Record<string, unknown> = {
      stage: fromStage,
      ...(codePrefix
        ? { code: { startsWith: codePrefix.toUpperCase() } }
        : targetsFh
          ? {}
          : { code: { not: { startsWith: 'FH' } } }),
      ...(endedBefore ? { endDate: { lt: endedBefore } } : {}),
    };
    const rows = await prisma.project.findMany({
      where,
      orderBy: { code: 'asc' },
      take: BULK_HARD_CAP,
      select: { id: true, code: true, name: true, endDate: true },
    });
    if (rows.length === 0) {
      return {
        kind: 'no_op' as const,
        message: `No "${fromStage}" projects match the filter.`,
      };
    }
    const token = signPrefillToken({
      kind: 'reconcile_bulk',
      personId: ctx.session.person.id,
      payload: {
        mode: 'stage_transition' as const,
        toStage,
        projectIds: rows.map((r) => r.id),
      },
    });
    const preview = rows.slice(0, PREVIEW_CAP);
    return {
      kind: 'proposal' as const,
      surface: 'reconcile_bulk_stage_transition',
      token,
      title: `Move ${rows.length} ${rows.length === 1 ? 'project' : 'projects'}: ${fromStage} → ${toStage}`,
      fields: [
        { label: 'From → To', value: `${fromStage} → ${toStage}` },
        ...(codePrefix ? [{ label: 'Code prefix', value: codePrefix.toUpperCase() }] : []),
        ...(endedBeforeIso ? [{ label: 'endDate before', value: endedBeforeIso }] : []),
        { label: 'Affected', value: `${rows.length}` },
        ...preview.map((r) => ({
          label: r.code,
          value: `${r.name}${r.endDate ? ` · end ${r.endDate.toISOString().slice(0, 10)}` : ''}`,
        })),
        ...(rows.length > PREVIEW_CAP
          ? [{ label: '…', value: `${rows.length - PREVIEW_CAP} more not shown` }]
          : []),
      ],
      confirmLabel: `Move ${rows.length}`,
      summary: `Move ${rows.length} projects ${fromStage} → ${toStage}.`,
    };
  },
};
