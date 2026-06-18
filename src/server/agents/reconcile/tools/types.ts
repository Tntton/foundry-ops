/**
 * Reconcile-assistant tool primitives. Mirrors the in-app assistant's
 * tool typing (src/server/agents/assistant/tools/types.ts) but kept in
 * a separate file so the two registries can diverge — the reconcile
 * agent's tools are all super-admin gated and mostly mutating.
 */
import type Anthropic from '@anthropic-ai/sdk';
import type { Session } from '@/server/roles';

export type ToolContext = {
  session: Session;
};

export type AnthropicTool = Anthropic.Tool;

export type ToolDefinition<Input = unknown, Output = unknown> = {
  spec: AnthropicTool;
  run(ctx: ToolContext, input: Input): Promise<Output | { error: string }>;
};
