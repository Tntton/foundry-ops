import Anthropic from '@anthropic-ai/sdk';
import type { Session } from '@/server/roles';
import { buildSystemPrompt } from './system-prompt';
import type { StoredMessage } from './threads';
import { cropHistory } from './threads';

/**
 * Per A4 in CLAUDE.md — `claude-sonnet` for primary reasoning. We pin
 * to 4-5 so we match the rest of the codebase (receipt OCR, Uber email
 * intake, WhatsApp router all use claude-sonnet-4-5). Centralised here
 * so model bumps land in one place.
 */
export const ASSISTANT_MODEL = 'claude-sonnet-4-5';
export const ASSISTANT_MAX_TOKENS = 4000;

/** Stream chunks the caller writes to the SSE response. */
export type StreamChunk =
  | { kind: 'text'; text: string }
  | { kind: 'error'; message: string }
  | { kind: 'done'; finalText: string };

/**
 * Stream a Claude response for the in-app assistant. Yields text deltas
 * as they arrive, plus a final `done` chunk carrying the full
 * concatenated text (so the SSE route can persist it without
 * re-stitching on the client).
 *
 * The function never throws — errors are yielded as a single `error`
 * chunk followed by `done` so the client receives a terminal event in
 * every case. Anthropic SDK exceptions (network blip, 5xx) become an
 * "I'm having trouble reaching the model — try again" message that the
 * route handler persists like any other assistant reply.
 */
export async function* streamAssistantReply(input: {
  session: Session;
  history: readonly StoredMessage[];
  newUserMessage: string;
}): AsyncGenerator<StreamChunk, void, unknown> {
  const apiKey = process.env['ANTHROPIC_API_KEY'];
  if (!apiKey) {
    const msg =
      "Sorry — the assistant isn't configured (ANTHROPIC_API_KEY is missing). TT needs to set the env var.";
    yield { kind: 'text', text: msg };
    yield { kind: 'done', finalText: msg };
    return;
  }

  const client = new Anthropic({ apiKey });
  const system = buildSystemPrompt(input.session);

  // Build the message list — Claude expects role + string content for
  // a basic conversation. `tool` rows are skipped for Phase 1 (they
  // can't exist yet; the schema reserves the role for Phase 2/3).
  const trimmed = cropHistory(input.history);
  const messages = trimmed
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));
  messages.push({ role: 'user', content: input.newUserMessage });

  let collected = '';

  try {
    const stream = client.messages.stream({
      model: ASSISTANT_MODEL,
      max_tokens: ASSISTANT_MAX_TOKENS,
      system,
      messages,
    });

    for await (const event of stream) {
      if (
        event.type === 'content_block_delta' &&
        event.delta.type === 'text_delta'
      ) {
        const delta = event.delta.text;
        collected += delta;
        yield { kind: 'text', text: delta };
      }
    }

    yield { kind: 'done', finalText: collected };
  } catch (err) {
    console.error('[assistant.streamAssistantReply] failed:', err);
    const fallback =
      "Sorry — I couldn't reach the model just now. Try again in a moment.";
    // If we partially streamed text, surface the error inline; otherwise
    // emit fallback as the entire response so the user sees something.
    if (collected.length === 0) {
      yield { kind: 'text', text: fallback };
      collected = fallback;
    } else {
      yield { kind: 'error', message: fallback };
    }
    yield { kind: 'done', finalText: collected };
  }
}
