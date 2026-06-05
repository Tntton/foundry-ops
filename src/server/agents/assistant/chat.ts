import Anthropic from '@anthropic-ai/sdk';
import type { Session } from '@/server/roles';
import { buildSystemPrompt } from './system-prompt';
import type { StoredMessage } from './threads';
import { cropHistory } from './threads';
import { assistantToolSpecs, runAssistantTool } from './tools';

/**
 * Per A4 in CLAUDE.md — `claude-sonnet` for primary reasoning. We pin
 * to 4-5 so we match the rest of the codebase (receipt OCR, Uber email
 * intake, WhatsApp router all use claude-sonnet-4-5).
 */
export const ASSISTANT_MODEL = 'claude-sonnet-4-5';
export const ASSISTANT_MAX_TOKENS = 4000;
/**
 * Cap on tool-use roundtrips per user message. Anthropic doesn't enforce
 * one and a confused model can loop. 5 covers every realistic chain
 * ("find_project → list_my_projects → ...") with headroom; the 6th
 * iteration force-stops by removing tools from the next request.
 */
const MAX_TOOL_ROUNDTRIPS = 5;

/** Stream chunks the caller writes to the SSE response. */
export type StreamChunk =
  | { kind: 'text'; text: string }
  | { kind: 'tool_call'; id: string; name: string; input: unknown }
  | { kind: 'tool_result'; id: string; name: string; ok: boolean }
  | { kind: 'error'; message: string }
  | { kind: 'done'; finalText: string };

type ToolUseBlock = {
  id: string;
  name: string;
  input: unknown;
};

/**
 * Stream a Claude response with tool-use support.
 *
 * The flow per turn:
 *   1. Send the conversation + tool catalogue.
 *   2. Stream text + tool_use blocks back.
 *   3. If the turn ended because the model wants tools, run them
 *      server-side, append the tool_use + tool_result blocks to the
 *      working messages array, and start a new streaming turn.
 *   4. Repeat until the model's stop_reason is no longer 'tool_use'
 *      or we hit MAX_TOOL_ROUNDTRIPS.
 *
 * Streaming never throws — errors are yielded as `{ kind: 'error' }`
 * followed by `{ kind: 'done' }` so the route always sees a terminal
 * event.
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
  const tools = assistantToolSpecs();

  // Build the working messages array. Seed history (cropped) + the
  // user's new turn. As tool-use rounds happen we append to this
  // array; each round sends the whole thing to Anthropic.
  type Block =
    | { type: 'text'; text: string }
    | { type: 'tool_use'; id: string; name: string; input: unknown }
    | { type: 'tool_result'; tool_use_id: string; content: string };

  type Msg = { role: 'user' | 'assistant'; content: string | Block[] };

  const trimmed = cropHistory(input.history);
  const messages: Msg[] = trimmed
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));
  messages.push({ role: 'user', content: input.newUserMessage });

  let finalText = '';

  try {
    for (let round = 0; round < MAX_TOOL_ROUNDTRIPS + 1; round++) {
      // Strip tool catalogue on the FORCED last round so the model
      // can't request more — this terminates a runaway tool loop with
      // a clean text answer instead of an error.
      const requestTools = round < MAX_TOOL_ROUNDTRIPS;

      const stream = client.messages.stream({
        model: ASSISTANT_MODEL,
        max_tokens: ASSISTANT_MAX_TOKENS,
        system,
        messages: messages as Anthropic.MessageParam[],
        ...(requestTools ? { tools } : {}),
      });

      const turnTextParts: string[] = [];
      const toolUses: ToolUseBlock[] = [];
      // Track partial json per content_block index so deltas stream
      // into the right tool_use as the SDK emits them.
      const activeToolJson = new Map<number, { id: string; name: string; json: string }>();

      for await (const event of stream) {
        if (event.type === 'content_block_start') {
          if (event.content_block.type === 'tool_use') {
            activeToolJson.set(event.index, {
              id: event.content_block.id,
              name: event.content_block.name,
              json: '',
            });
          }
        } else if (event.type === 'content_block_delta') {
          if (event.delta.type === 'text_delta') {
            const delta = event.delta.text;
            turnTextParts.push(delta);
            yield { kind: 'text', text: delta };
          } else if (event.delta.type === 'input_json_delta') {
            const active = activeToolJson.get(event.index);
            if (active) active.json += event.delta.partial_json;
          }
        } else if (event.type === 'content_block_stop') {
          const active = activeToolJson.get(event.index);
          if (active) {
            let parsed: unknown = {};
            try {
              parsed = active.json.length > 0 ? JSON.parse(active.json) : {};
            } catch {
              parsed = { _raw: active.json };
            }
            toolUses.push({ id: active.id, name: active.name, input: parsed });
            activeToolJson.delete(event.index);
          }
        }
      }

      const final = await stream.finalMessage();
      const turnText = turnTextParts.join('');
      finalText += turnText;

      // If the model stopped because it wants tools, run them and
      // continue. Otherwise we're done.
      if (final.stop_reason !== 'tool_use' || toolUses.length === 0) {
        break;
      }

      // Persist the assistant turn (text + tool_use blocks) into the
      // working messages array so the next request can reference them.
      const assistantBlocks: Block[] = final.content
        .map((c): Block | null => {
          if (c.type === 'text') return { type: 'text', text: c.text };
          if (c.type === 'tool_use')
            return {
              type: 'tool_use',
              id: c.id,
              name: c.name,
              input: c.input,
            };
          return null;
        })
        .filter((b): b is Block => b !== null);
      messages.push({ role: 'assistant', content: assistantBlocks });

      // Run each tool sequentially. Could parallelise — sequential
      // keeps the SSE stream tidy and audit ordering deterministic.
      const toolResults: Block[] = [];
      for (const tu of toolUses) {
        yield { kind: 'tool_call', id: tu.id, name: tu.name, input: tu.input };
        const out = await runAssistantTool(
          { session: input.session },
          tu.name,
          tu.input,
        );
        const ok =
          out !== null &&
          typeof out === 'object' &&
          !('error' in (out as Record<string, unknown>));
        yield { kind: 'tool_result', id: tu.id, name: tu.name, ok };
        toolResults.push({
          type: 'tool_result',
          tool_use_id: tu.id,
          content: JSON.stringify(out),
        });
      }
      messages.push({ role: 'user', content: toolResults });
    }

    yield { kind: 'done', finalText };
  } catch (err) {
    console.error('[assistant.streamAssistantReply] failed:', err);
    const fallback =
      "Sorry — I couldn't reach the model just now. Try again in a moment.";
    if (finalText.length === 0) {
      yield { kind: 'text', text: fallback };
      finalText = fallback;
    } else {
      yield { kind: 'error', message: fallback };
    }
    yield { kind: 'done', finalText };
  }
}
