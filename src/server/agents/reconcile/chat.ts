import Anthropic from '@anthropic-ai/sdk';
import type { Session } from '@/server/roles';
import { buildReconcileSystemPrompt } from './system-prompt';
import { cropHistory, type StoredMessage } from '@/server/agents/assistant/threads';
import { reconcileToolSpecs, runReconcileTool } from './tools';

export const RECONCILE_MODEL = 'claude-sonnet-4-5';
export const RECONCILE_MAX_TOKENS = 4000;
const MAX_TOOL_ROUNDTRIPS = 5;

export type StreamChunk =
  | { kind: 'text'; text: string }
  | { kind: 'tool_call'; id: string; name: string; input: unknown }
  | { kind: 'tool_result'; id: string; name: string; ok: boolean }
  | {
      kind: 'proposal_card';
      surface: string;
      token: string;
      title: string;
      fields: Array<{ label: string; value: string }>;
      confirmLabel: string;
      summary: string;
    }
  | { kind: 'error'; message: string }
  | { kind: 'done'; finalText: string };

type ToolUseBlock = { id: string; name: string; input: unknown };

/**
 * Stream Claude's response with tool-use support. Structure mirrors the
 * in-app assistant's streaming loop (src/server/agents/assistant/chat.ts);
 * the divergence is the tool registry + system prompt.
 *
 * Streaming never throws — errors are yielded as `{ kind: 'error' }`
 * followed by `{ kind: 'done' }` so the route always sees a terminal
 * event.
 */
export async function* streamReconcileReply(input: {
  session: Session;
  history: readonly StoredMessage[];
  newUserMessage: string;
}): AsyncGenerator<StreamChunk, void, unknown> {
  const apiKey = process.env['ANTHROPIC_API_KEY'];
  if (!apiKey) {
    const msg =
      "The reconcile assistant isn't configured — ANTHROPIC_API_KEY is missing.";
    yield { kind: 'text', text: msg };
    yield { kind: 'done', finalText: msg };
    return;
  }

  const client = new Anthropic({ apiKey });
  const system = buildReconcileSystemPrompt(input.session);
  const tools = reconcileToolSpecs();

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
      const requestTools = round < MAX_TOOL_ROUNDTRIPS;
      const stream = client.messages.stream({
        model: RECONCILE_MODEL,
        max_tokens: RECONCILE_MAX_TOKENS,
        system,
        messages: messages as Anthropic.MessageParam[],
        ...(requestTools ? { tools } : {}),
      });

      const turnTextParts: string[] = [];
      const toolUses: ToolUseBlock[] = [];
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

      if (final.stop_reason !== 'tool_use' || toolUses.length === 0) break;

      const assistantBlocks: Block[] = final.content
        .map((c): Block | null => {
          if (c.type === 'text') return { type: 'text', text: c.text };
          if (c.type === 'tool_use')
            return { type: 'tool_use', id: c.id, name: c.name, input: c.input };
          return null;
        })
        .filter((b): b is Block => b !== null);
      messages.push({ role: 'assistant', content: assistantBlocks });

      const toolResults: Block[] = [];
      for (const tu of toolUses) {
        yield { kind: 'tool_call', id: tu.id, name: tu.name, input: tu.input };
        const out = await runReconcileTool(
          { session: input.session },
          tu.name,
          tu.input,
        );
        const ok =
          out !== null &&
          typeof out === 'object' &&
          !('error' in (out as Record<string, unknown>));
        yield { kind: 'tool_result', id: tu.id, name: tu.name, ok };

        if (
          ok &&
          out &&
          typeof out === 'object' &&
          (out as Record<string, unknown>)['kind'] === 'proposal'
        ) {
          const p = out as {
            surface: string;
            token: string;
            title: string;
            fields: Array<{ label: string; value: string }>;
            confirmLabel: string;
            summary: string;
          };
          if (typeof p.token === 'string' && Array.isArray(p.fields)) {
            yield {
              kind: 'proposal_card',
              surface: p.surface,
              token: p.token,
              title: p.title,
              fields: p.fields,
              confirmLabel: p.confirmLabel,
              summary: p.summary,
            };
          }
        }

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
    console.error('[reconcile.streamReconcileReply] failed:', err);
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
