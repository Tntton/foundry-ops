import { prisma } from '@/server/db';
import { writeAudit } from '@/server/audit';
import { hasCapability } from '@/server/capabilities';
import {
  RecruitProposalSchema,
  type RecruitProposalPayload,
} from '@/server/agents/assistant/prefill/schemas';
import { signPrefillToken } from '@/server/agents/assistant/prefill/token';
import type { ToolDefinition } from './types';

function humaniseBand(b: string): string {
  return b === 'senior_leader'
    ? 'Senior Leader'
    : b.charAt(0).toUpperCase() + b.slice(1);
}

/**
 * Propose a quick-add recruit prospect. Unlike prefill, there's no
 * "form to inspect" — the underlying action takes 3-4 fields. So the
 * widget renders a confirmation card with those fields + a Confirm
 * button; clicking Confirm POSTs to /api/assistant/confirm which
 * verifies the token, capability-checks, and runs createRecruitQuick
 * server-side.
 */
export const proposeQuickRecruit: ToolDefinition<RecruitProposalPayload> = {
  spec: {
    name: 'propose_quick_recruit',
    description:
      "Propose adding a recruit prospect to the talent pipeline. Returns a confirmation card the widget renders inline with a Confirm button — no row is created until the user clicks it. Gated on recruit.manage. Use only when the user explicitly asks to add a prospect ('add Jane Smith as an Expert candidate').",
    input_schema: {
      type: 'object',
      properties: {
        firstName: { type: 'string' },
        lastName: { type: 'string' },
        targetBand: {
          type: 'string',
          description:
            'Recruit pool band — one of: senior_leader | expert | fellow | manager | consultant | analyst (lowercase snake_case).',
        },
        ownerId: {
          type: 'string',
          description:
            'Optional Person id of the responsible partner. If omitted, defaults to the confirming user.',
        },
      },
      required: ['firstName', 'lastName', 'targetBand'],
    },
  },
  capability: 'recruit.manage',
  async run(ctx, raw) {
    const parsed = RecruitProposalSchema.safeParse(raw);
    if (!parsed.success) {
      return {
        error: `invalid_payload: ${parsed.error.issues[0]?.message ?? 'check inputs'}`,
      };
    }
    if (!hasCapability(ctx.session, 'recruit.manage')) {
      return { error: 'permission_denied' };
    }
    const data = parsed.data;
    const personId = ctx.session.person.id;

    const token = signPrefillToken({
      kind: 'recruit_proposal',
      personId,
      payload: data,
    });

    try {
      await prisma.$transaction(async (tx) => {
        await writeAudit(tx, {
          actor: { type: 'person', id: personId },
          action: 'proposed',
          entity: {
            type: 'assistant_proposal',
            id: `${personId}:recruit:${data.firstName}-${data.lastName}`,
            after: {
              kind: 'recruit_proposal',
              targetBand: data.targetBand,
            },
          },
          source: 'agent',
        });
      });
    } catch (err) {
      console.error('[propose_quick_recruit] audit mint failed:', err);
    }

    return {
      kind: 'proposal',
      surface: 'recruit',
      token,
      title: `Add ${data.firstName} ${data.lastName}`,
      fields: [
        { label: 'Name', value: `${data.firstName} ${data.lastName}` },
        { label: 'Target band', value: humaniseBand(data.targetBand) },
      ],
      confirmLabel: 'Add to talent pipeline',
      summary: `Add ${data.firstName} ${data.lastName} as a ${humaniseBand(data.targetBand)} prospect.`,
    };
  },
};
