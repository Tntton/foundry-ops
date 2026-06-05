import type Anthropic from '@anthropic-ai/sdk';
import type { Capability } from '@/server/capabilities';
import type { Session } from '@/server/roles';

/**
 * Shape every assistant tool exports. The registry composes them into
 * the `tools` array passed to Anthropic + a name→runner map used in the
 * tool-result loop.
 *
 * Tools never escalate privilege. The `session` carried in `ToolContext`
 * is the same session that authenticated the SSE request, and every
 * tool that reads sensitive data must check capabilities the same way
 * a regular route handler would.
 */

export type ToolContext = {
  session: Session;
};

/**
 * JSON-Schema-typed parameter spec — using Anthropic's `Tool` type
 * from the SDK so the shape matches what the Messages API expects.
 */
export type AnthropicTool = Anthropic.Tool;

export type ToolDefinition<Input = unknown, Output = unknown> = {
  /** Anthropic tool spec — name + description + input_schema. */
  spec: AnthropicTool;
  /**
   * Optional capability gate. If set and the user lacks it, `run`
   * returns a `{ ok: false, error }` shape that the loop surfaces back
   * to the model rather than throwing — so the model can apologise
   * politely instead of crashing the turn.
   */
  capability?: Capability;
  /**
   * Validate + run. Input is the raw JSON the model produced; the
   * tool is responsible for Zod-validating it. Return value is
   * serialised to JSON and fed back to the model as `tool_result`.
   */
  run(ctx: ToolContext, input: Input): Promise<Output | { error: string }>;
};
