import { prisma } from '@/server/db';
import { writeAudit } from '@/server/audit';
import {
  FeedbackProposalSchema,
  type FeedbackProposalPayload,
} from '@/server/agents/assistant/prefill/schemas';
import { signPrefillToken } from '@/server/agents/assistant/prefill/token';
import type { ToolDefinition } from './types';

const URGENCY_LABEL: Record<string, string> = {
  critical: 'Critical — blocking right now',
  urgent: 'Urgent — within a few days',
  routine: 'Routine — nice-to-have',
};

const KIND_LABEL: Record<string, string> = {
  bug: 'Bug',
  feature: 'Feature request',
  maintenance: 'Maintenance',
  other: 'Other',
};

/**
 * Propose a feedback / bug / feature ticket. Anyone authenticated
 * can submit feedback, so no capability gate. Widget renders a
 * confirmation card; Confirm POSTs to /api/assistant/confirm which
 * verifies + runs the existing submitFeedback action.
 */
export const proposeFeedbackTicket: ToolDefinition<FeedbackProposalPayload> = {
  spec: {
    name: 'propose_feedback_ticket',
    description:
      "Propose a feedback ticket (bug / feature / maintenance / other). Use when the user is reporting a problem with Foundry Ops itself or asking for an improvement. Returns a confirmation card — nothing is logged until the user clicks Confirm.",
    input_schema: {
      type: 'object',
      properties: {
        urgency: {
          type: 'string',
          description: 'critical | urgent | routine',
        },
        kind: {
          type: 'string',
          description: 'bug | feature | maintenance | other',
        },
        title: { type: 'string', description: 'Short title (3–200 chars)' },
        body: {
          type: 'string',
          description: 'Detailed description (5–4000 chars)',
        },
        contextPath: {
          type: 'string',
          description: 'Optional URL path the issue relates to.',
        },
      },
      required: ['urgency', 'kind', 'title', 'body'],
    },
  },
  async run(ctx, raw) {
    const parsed = FeedbackProposalSchema.safeParse(raw);
    if (!parsed.success) {
      return {
        error: `invalid_payload: ${parsed.error.issues[0]?.message ?? 'check inputs'}`,
      };
    }
    const data = parsed.data;
    const personId = ctx.session.person.id;

    const token = signPrefillToken({
      kind: 'feedback_proposal',
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
            id: `${personId}:feedback:${Date.now()}`,
            after: {
              kind: 'feedback_proposal',
              urgency: data.urgency,
              titleLength: data.title.length,
            },
          },
          source: 'agent',
        });
      });
    } catch (err) {
      console.error('[propose_feedback_ticket] audit mint failed:', err);
    }

    return {
      kind: 'proposal',
      surface: 'feedback',
      token,
      title: `Log feedback: ${data.title}`,
      fields: [
        { label: 'Urgency', value: URGENCY_LABEL[data.urgency] ?? data.urgency },
        { label: 'Type', value: KIND_LABEL[data.kind] ?? data.kind },
        { label: 'Title', value: data.title },
        { label: 'Details', value: data.body },
      ],
      confirmLabel: 'Submit feedback ticket',
      summary: `Log a ${data.kind} ticket — "${data.title}" (${data.urgency}).`,
    };
  },
};
