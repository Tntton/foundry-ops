import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { getSession } from '@/server/session';
import { streamAssistantReply } from '@/server/agents/assistant/chat';
import { checkAssistantRateLimit } from '@/server/agents/assistant/rate-limit';
import {
  appendMessage,
  getOrCreateActiveThread,
  listThreadMessages,
  maybeArchiveIfFull,
  ASSISTANT_MAX_TURNS,
} from '@/server/agents/assistant/threads';

// Streaming responses must not be cached at the edge.
export const dynamic = 'force-dynamic';
// Keep us on Node — the Anthropic SDK uses Node globals (Buffer, streams).
export const runtime = 'nodejs';

const BodySchema = z.object({
  message: z.string().trim().min(1, 'Message is empty').max(4000),
});

/**
 * POST /api/assistant/chat — accepts a single user message + streams the
 * assistant's reply as Server-Sent Events. Each SSE event is a JSON
 * object: `{ kind: 'text', text }`, `{ kind: 'error', message }`, or
 * `{ kind: 'done', finalText }`. The widget consumes these events and
 * appends text deltas to the rendered message in real time.
 *
 * Persistence model: user message is written before the stream opens
 * (so a reload mid-stream still shows the user's question). Assistant
 * reply is written once the stream finishes, using the `done` chunk's
 * `finalText` so we don't reconstruct on the client.
 */
export async function POST(req: Request): Promise<Response> {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  // Rate-limit per person.
  const limit = checkAssistantRateLimit(session.person.id);
  if (limit) {
    return NextResponse.json(
      {
        error: 'rate_limited',
        message: `You've hit the assistant rate limit (100 messages / hour). Try again in ${limit.retryAfterSeconds}s.`,
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

  // Active thread + existing history.
  const thread = await getOrCreateActiveThread(session.person.id);
  if (thread.turnCount >= ASSISTANT_MAX_TURNS) {
    return NextResponse.json(
      {
        error: 'thread_full',
        message: `This conversation hit the ${ASSISTANT_MAX_TURNS}-turn cap. Hit the reset button to start a fresh thread.`,
      },
      { status: 409 },
    );
  }

  const history = await listThreadMessages(thread.id);

  // Persist user message before streaming opens so a refresh mid-stream
  // still shows the question.
  await prisma.$transaction(async (tx) => {
    await appendMessage(tx, {
      threadId: thread.id,
      personId: session.person.id,
      role: 'user',
      content: parsed.data.message,
    });
  });

  const encoder = new TextEncoder();
  const sse = new ReadableStream({
    async start(controller) {
      // Initial frame carries the thread id so the client can hydrate
      // its message list with the user message it just sent.
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify({ kind: 'meta', threadId: thread.id })}\n\n`),
      );
      let finalText = '';
      try {
        for await (const chunk of streamAssistantReply({
          session,
          history,
          newUserMessage: parsed.data.message,
        })) {
          if (chunk.kind === 'done') {
            finalText = chunk.finalText;
          }
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
        }
      } catch (err) {
        console.error('[assistant.chat] stream failed:', err);
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              kind: 'error',
              message: "Stream failed. Try again.",
            })}\n\n`,
          ),
        );
      } finally {
        controller.close();
        // Persist the assistant reply after the stream closes.
        if (finalText.trim().length > 0) {
          try {
            await prisma.$transaction(async (tx) => {
              await appendMessage(tx, {
                threadId: thread.id,
                personId: session.person.id,
                role: 'assistant',
                content: finalText,
              });
            });
          } catch (err) {
            console.error('[assistant.chat] persist reply failed:', err);
          }
        }
        await maybeArchiveIfFull(thread.id, session.person.id);
      }
    },
  });

  return new Response(sse, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Disable proxy buffering so chunks reach the client immediately.
      'X-Accel-Buffering': 'no',
    },
  });
}
