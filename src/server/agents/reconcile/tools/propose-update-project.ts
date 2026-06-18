import { z } from 'zod';
import { prisma } from '@/server/db';
import { signPrefillToken } from '@/server/agents/assistant/prefill/token';
import type { ToolDefinition } from './types';

/**
 * Propose a single-field update on a Project. Returns a signed
 * confirmation token + a human-readable diff (current → next). The
 * widget renders this as a Confirm / Cancel card; clicking Confirm
 * POSTs to /api/reconcile/confirm which verifies the token, applies
 * the update inside a transaction, and writes an AuditEvent.
 *
 * Editable fields are an allowlist — anything outside it is rejected
 * so the model can't try to overwrite primaryPartnerId via a typo.
 * Bulk updates (multi-row) live in a separate tool; this one is
 * always single-row.
 */
const EditableField = z.enum([
  'contractValue',
  'name',
  'description',
  'startDate',
  'endDate',
  'actualEndDate',
  'sharepointFolderUrl',
  'sharepointAdminFolderUrl',
  'stage',
]);

const InputSchema = z.object({
  /** Either the project code (e.g. "FHP001") or its CUID id. Code is preferred — the model has it from find_gaps. */
  projectRef: z.string().min(1),
  field: EditableField,
  /** New value as a string — server coerces into the right type based on the field. */
  value: z.string().min(0).max(2000),
});

const STAGES = ['kickoff', 'delivery', 'closing', 'archived', 'standing', 'benched'] as const;

function coerceValue(field: z.infer<typeof EditableField>, raw: string):
  | { ok: true; parsed: unknown; display: string }
  | { ok: false; error: string } {
  const v = raw.trim();
  if (field === 'contractValue') {
    // Accept "50000", "50,000", "$50,000", "50000.00"
    const num = Number(v.replace(/[,$]/g, ''));
    if (!Number.isFinite(num) || num < 0) {
      return { ok: false, error: 'contractValue must be a non-negative number in dollars.' };
    }
    // Store cents
    const cents = Math.round(num * 100);
    return { ok: true, parsed: cents, display: `AUD ${num.toLocaleString('en-AU')}` };
  }
  if (field === 'startDate' || field === 'endDate' || field === 'actualEndDate') {
    if (v === '' || v.toLowerCase() === 'null') {
      return { ok: true, parsed: null, display: '— (cleared)' };
    }
    const d = new Date(v);
    if (!Number.isFinite(d.getTime())) {
      return { ok: false, error: `${field} must be a parseable date (e.g. 2026-07-01).` };
    }
    return { ok: true, parsed: d, display: d.toISOString().slice(0, 10) };
  }
  if (field === 'stage') {
    if (!(STAGES as readonly string[]).includes(v)) {
      return { ok: false, error: `stage must be one of: ${STAGES.join(', ')}.` };
    }
    return { ok: true, parsed: v, display: v };
  }
  // name, description, sharepointFolderUrl, sharepointAdminFolderUrl — plain string.
  if (v === '' || v.toLowerCase() === 'null') {
    if (field === 'name') {
      return { ok: false, error: 'name cannot be empty.' };
    }
    return { ok: true, parsed: null, display: '— (cleared)' };
  }
  return { ok: true, parsed: v, display: v };
}

function formatCurrent(field: z.infer<typeof EditableField>, val: unknown): string {
  if (val === null || val === undefined) return '—';
  if (val instanceof Date) return val.toISOString().slice(0, 10);
  if (field === 'contractValue' && typeof val === 'number') {
    return `AUD ${(val / 100).toLocaleString('en-AU')}`;
  }
  return String(val);
}

export const proposeUpdateProject: ToolDefinition = {
  spec: {
    name: 'propose_update_project',
    description:
      'Propose updating a single field on a Project. Returns a confirmation card with the current value vs. the proposed value; the user must click Confirm before the change applies. Use this for one-off fixes (e.g. "set the contract value on FHP002 to 50000"). Allowed fields: contractValue, name, description, startDate, endDate, actualEndDate, sharepointFolderUrl, sharepointAdminFolderUrl, stage.',
    input_schema: {
      type: 'object',
      required: ['projectRef', 'field', 'value'],
      properties: {
        projectRef: {
          type: 'string',
          description: 'Project code (e.g. "FHP001") OR project id (CUID).',
        },
        field: {
          type: 'string',
          enum: [
            'contractValue',
            'name',
            'description',
            'startDate',
            'endDate',
            'actualEndDate',
            'sharepointFolderUrl',
            'sharepointAdminFolderUrl',
            'stage',
          ],
        },
        value: {
          type: 'string',
          description:
            'New value as a string. For contractValue pass dollars (e.g. "50000"). For dates pass ISO (e.g. "2026-07-01") or "" to clear. For stage pass one of kickoff/delivery/closing/archived/standing/benched.',
        },
      },
    },
  },
  async run(ctx, input) {
    const parsed = InputSchema.safeParse(input);
    if (!parsed.success) {
      return { error: `invalid_input: ${parsed.error.issues[0]?.message ?? 'bad shape'}` };
    }
    const { projectRef, field, value } = parsed.data;

    const project = await prisma.project.findFirst({
      where: { OR: [{ code: projectRef }, { id: projectRef }] },
      select: {
        id: true,
        code: true,
        name: true,
        description: true,
        contractValue: true,
        startDate: true,
        endDate: true,
        actualEndDate: true,
        sharepointFolderUrl: true,
        sharepointAdminFolderUrl: true,
        stage: true,
      },
    });
    if (!project) {
      return { error: `project_not_found: no Project matches "${projectRef}".` };
    }

    const coerced = coerceValue(field, value);
    if (!coerced.ok) {
      return { error: `invalid_value: ${coerced.error}` };
    }

    const currentVal = project[field as keyof typeof project];
    const currentDisplay = formatCurrent(field, currentVal);

    // Mint a 15-minute token carrying the proposed change. Confirm route
    // decodes, re-checks the project exists, applies the update inside
    // a transaction + audit row.
    const token = signPrefillToken({
      kind: 'reconcile_update',
      personId: ctx.session.person.id,
      payload: {
        entityType: 'project' as const,
        entityId: project.id,
        field,
        // We store the raw string + the coerced shape; confirm route
        // re-coerces from the raw string to keep one source of truth.
        valueRaw: value,
      },
    });

    return {
      kind: 'proposal' as const,
      surface: 'reconcile_update_project',
      token,
      title: `Update ${project.code}: ${field}`,
      fields: [
        { label: 'Project', value: `${project.code} — ${project.name}` },
        { label: 'Field', value: field },
        { label: 'Current', value: currentDisplay },
        { label: 'Proposed', value: coerced.display },
      ],
      confirmLabel: 'Apply update',
      summary: `${project.code}.${field}: ${currentDisplay} → ${coerced.display}`,
    };
  },
};
