import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { getSession } from '@/server/session';
import { hasAnyRole } from '@/server/roles';
import { writeAudit, computeDelta } from '@/server/audit';
import { verifyPrefillToken } from '@/server/agents/assistant/prefill/token';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const BodySchema = z.object({
  token: z.string().min(1),
  kind: z.enum(['reconcile_update']),
});

const PayloadSchema = z.object({
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

/**
 * Coerce the raw string back into a typed value. Kept here (not shared
 * with the propose tool) so the confirm endpoint is the single source
 * of truth for what actually lands in the DB.
 */
function coerce(field: z.infer<typeof PayloadSchema>['field'], raw: string):
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

/**
 * POST /api/reconcile/confirm — applies a propose_update_project change
 * after verifying the signed token. Super-admin-gated. Writes an
 * AuditEvent capturing before/after for the field.
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

  const payloadCheck = PayloadSchema.safeParse(verify.payload.payload);
  if (!payloadCheck.success) {
    return NextResponse.json({ error: 'malformed_proposal' }, { status: 400 });
  }
  const { entityType, entityId, field, valueRaw } = payloadCheck.data;

  const coerced = coerce(field, valueRaw);
  if (!coerced.ok) {
    return NextResponse.json({ error: 'invalid_value', message: coerced.reason }, { status: 400 });
  }

  if (entityType !== 'project') {
    // Other entity types arrive in follow-up commits.
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
      // Prisma will reject illegal cross-type assignments, e.g. setting
      // contractValue to a Date — coerce above already constrains this.
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
      void computeDelta; // imported for symmetry; not used directly here
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
    console.error('[reconcile/confirm] failed:', err);
    return NextResponse.json({ error: 'update_failed' }, { status: 500 });
  }
}
