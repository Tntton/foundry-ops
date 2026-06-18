import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { getSession } from '@/server/session';
import { hasAnyRole } from '@/server/roles';
import { streamReconcileReply } from '@/server/agents/reconcile/chat';
import {
  appendMessage,
  getOrCreateActiveThread,
  listThreadMessages,
  maybeArchiveIfFull,
} from '@/server/agents/assistant/threads';
import { checkAssistantRateLimit } from '@/server/agents/assistant/rate-limit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const BodySchema = z.object({
  message: z.string().trim().min(1, 'Message is empty').max(4000),
});

/**
 * POST /api/reconcile/chat — text-only SSE chat with the reconcile
 * assistant. Mirrors /api/assistant/chat (same SSE event shapes) but:
 *   - Threads are scoped to kind='reconcile' so history doesn't mix
 *     with the general in-app helper at /assistant.
 *   - Restricted to super_admin.
 *   - Uses the reconcile tool registry (find_gaps, propose_update_project, ...).
 *
 * File-drop multipart support arrives with the doc-extraction tool
 * (TASKS.md #25 — PDF/Word project briefs).
 *
 * SSE shapes:
 *   { kind: 'meta', threadId }
 *   { kind: 'text', text }
 *   { kind: 'tool_call' | 'tool_result' | 'proposal_card' | 'error' }
 *   { kind: 'done', finalText }
 */
export async function POST(req: Request): Promise<Response> {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }
  if (!hasAnyRole(session, ['super_admin'])) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const limit = checkAssistantRateLimit(session.person.id);
  if (limit) {
    return NextResponse.json(
      {
        error: 'rate_limited',
        message: `Reconcile chat rate limit hit (100/hour). Try again in ${limit.retryAfterSeconds}s.`,
      },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } },
    );
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
  const userMessage = parsed.data.message;

  // Thread under the reconcile namespace.
  const thread = await getOrCreateActiveThread(session.person.id, 'reconcile');

  // Persist the user's turn first so transient model failures still
  // leave a clean history record.
  await prisma.$transaction(async (tx) => {
    await appendMessage(tx, {
      threadId: thread.id,
      personId: session.person.id,
      role: 'user',
      content: userMessage,
    });
  });
  const history = await listThreadMessages(thread.id);

  // Slice off the just-persisted user message — streamReconcileReply
  // appends it itself from `newUserMessage`.
  const priorHistory = history.slice(0, -1);

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (obj: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      };
      emit({ kind: 'meta', threadId: thread.id });

      let assembled = '';
      try {
        for await (const chunk of streamReconcileReply({
          session,
          history: priorHistory,
          newUserMessage: userMessage,
        })) {
          if (chunk.kind === 'text') assembled += chunk.text;
          if (chunk.kind === 'done') assembled = chunk.finalText || assembled;
          emit(chunk);
          if (chunk.kind === 'done') break;
        }
      } catch (err) {
        console.error('[reconcile/chat] stream failed:', err);
        emit({ kind: 'error', message: 'Stream failed.' });
        emit({ kind: 'done', finalText: assembled });
      }

      controller.close();

      // Persist the assistant turn outside the SSE so the response is
      // already complete by the time we land in the DB.
      try {
        await prisma.$transaction(async (tx) => {
          await appendMessage(tx, {
            threadId: thread.id,
            personId: session.person.id,
            role: 'assistant',
            content: assembled || '(no response)',
          });
        });
        await maybeArchiveIfFull(thread.id, session.person.id);
      } catch (err) {
        console.error('[reconcile/chat] persist assistant turn failed:', err);
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
