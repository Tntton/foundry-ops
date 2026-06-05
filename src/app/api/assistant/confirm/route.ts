import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { getSession } from '@/server/session';
import { hasCapability } from '@/server/capabilities';
import { writeAudit } from '@/server/audit';
import { verifyPrefillToken } from '@/server/agents/assistant/prefill/token';
import {
  RecruitProposalSchema,
  FeedbackProposalSchema,
} from '@/server/agents/assistant/prefill/schemas';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const BodySchema = z.object({
  token: z.string().min(1),
  kind: z.enum(['recruit_proposal', 'feedback_proposal']),
});

/**
 * POST /api/assistant/confirm — verifies a propose_* token + runs
 * the underlying create action. Capability checks live here (the
 * server is the only place that can be trusted to enforce them) +
 * are duplicated from the originating tool so a forwarded token
 * still can't escalate privilege.
 *
 * Single-use: the verify path doesn't dedupe (token nonce is
 * available but we don't track redemptions). For MVP this is fine —
 * confirming twice would just create two rows, and the audit trail
 * surfaces that. Add a one-time-use ledger if it proves a real
 * concern.
 */
export async function POST(req: Request): Promise<Response> {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
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
            ? 'Proposal link expired (15-min TTL). Ask the assistant again.'
            : verify.reason === 'wrong_person'
              ? "That proposal wasn't for your account."
              : 'Proposal link invalid.',
      },
      { status: 400 },
    );
  }

  // Dispatch per kind. Each branch:
  //  1. Re-validates the payload Zod-wise (defense in depth).
  //  2. Re-checks the capability that the tool also gates on.
  //  3. Runs the existing create action in a transaction + audits.
  if (parsed.data.kind === 'recruit_proposal') {
    if (!hasCapability(session, 'recruit.manage')) {
      return NextResponse.json({ error: 'permission_denied' }, { status: 403 });
    }
    const payloadCheck = RecruitProposalSchema.safeParse(verify.payload.payload);
    if (!payloadCheck.success) {
      return NextResponse.json({ error: 'malformed_proposal' }, { status: 400 });
    }
    const p = payloadCheck.data;
    try {
      const recruit = await prisma.$transaction(async (tx) => {
        const row = await tx.recruitProspect.create({
          data: {
            firstName: p.firstName,
            lastName: p.lastName,
            targetBand: p.targetBand,
            ownerId: p.ownerId ?? session.person.id,
            status: 'active',
          },
        });
        await writeAudit(tx, {
          actor: { type: 'person', id: session.person.id },
          action: 'created',
          entity: {
            type: 'recruit_prospect',
            id: row.id,
            after: {
              name: `${p.firstName} ${p.lastName}`,
              targetBand: p.targetBand,
              via: 'assistant_proposal',
              jti: verify.payload.jti,
            },
          },
          source: 'agent',
        });
        return row;
      });
      return NextResponse.json({
        ok: true,
        kind: 'recruit_proposal',
        entityType: 'recruit_prospect',
        entityId: recruit.id,
        link: `/talent`,
        summary: `Added ${p.firstName} ${p.lastName} to the talent pipeline.`,
      });
    } catch (err) {
      console.error('[assistant.confirm] recruit failed:', err);
      return NextResponse.json({ error: 'create_failed' }, { status: 500 });
    }
  }

  if (parsed.data.kind === 'feedback_proposal') {
    const payloadCheck = FeedbackProposalSchema.safeParse(verify.payload.payload);
    if (!payloadCheck.success) {
      return NextResponse.json({ error: 'malformed_proposal' }, { status: 400 });
    }
    const p = payloadCheck.data;
    try {
      const ticket = await prisma.$transaction(async (tx) => {
        const t = await tx.feedbackTicket.create({
          data: {
            submitterId: session.person.id,
            urgency: p.urgency,
            kind: p.kind,
            title: p.title,
            body: p.body,
            contextPath: p.contextPath ?? null,
          },
        });
        await writeAudit(tx, {
          actor: { type: 'person', id: session.person.id },
          action: 'created',
          entity: {
            type: 'feedback_ticket',
            id: t.id,
            after: {
              urgency: t.urgency,
              kind: t.kind,
              title: t.title,
              via: 'assistant_proposal',
              jti: verify.payload.jti,
            },
          },
          source: 'agent',
        });
        return t;
      });
      return NextResponse.json({
        ok: true,
        kind: 'feedback_proposal',
        entityType: 'feedback_ticket',
        entityId: ticket.id,
        link: '/admin/feedback',
        summary: `Logged feedback ticket "${p.title}" (${p.urgency}).`,
      });
    } catch (err) {
      console.error('[assistant.confirm] feedback failed:', err);
      return NextResponse.json({ error: 'create_failed' }, { status: 500 });
    }
  }

  return NextResponse.json({ error: 'unknown_kind' }, { status: 400 });
}
