import Anthropic from '@anthropic-ai/sdk';

/**
 * Channel-agnostic intent classifier. Used by the WhatsApp router (and
 * available to the in-app assistant for cheap routing if we want to
 * pre-classify before reaching for tools).
 *
 * Returns "unknown" when the model isn't available or the response can't
 * be parsed — callers should treat that as "ask the user to clarify."
 *
 * Per CLAUDE.md A4 — claude-haiku for classification (cheap + fast,
 * single-word output).
 */
export type Intent =
  | 'timesheet'
  | 'availability'
  | 'expense'
  | 'status_check'
  | 'menu'
  | 'cancel'
  | 'confirm'
  | 'unknown';

const ALL_INTENTS: readonly Intent[] = [
  'timesheet',
  'availability',
  'expense',
  'status_check',
  'menu',
  'cancel',
  'confirm',
  'unknown',
];

const ROUTER_PROMPT = `You are a routing classifier for a WhatsApp bot serving a consulting firm's staff.

Classify the user's message into ONE of these intents:
  - "timesheet"      — anything about logging hours / project time
  - "availability"   — declaring hours they expect to work in coming days
  - "expense"        — submitting an expense / receipt
  - "status_check"   — asking about their current hours, available time, etc.
  - "menu"           — asking what they can do, listing options
  - "cancel"         — wanting to abort the current flow
  - "confirm"        — approving / submitting the thing we just prepared (e.g. "confirm", "yes submit", "go ahead")
  - "unknown"        — none of the above

Return ONLY the intent string, nothing else. Just one word.`;

/**
 * Keyword fallback used when ANTHROPIC_API_KEY isn't configured. Exported
 * for testing so we can pin the offline behaviour.
 */
export function classifyIntentKeyword(text: string): Intent {
  const lc = text.toLowerCase();
  if (/\b(timesheet|hours|log|logged)\b/.test(lc)) return 'timesheet';
  if (/\b(availab|forecast|next week)\b/.test(lc)) return 'availability';
  if (/\b(expense|receipt|reimburs)\b/.test(lc)) return 'expense';
  if (/\b(status|how many|this week)\b/.test(lc)) return 'status_check';
  if (/\b(menu|help|options)\b/.test(lc)) return 'menu';
  if (/\b(cancel|stop|abort)\b/.test(lc)) return 'cancel';
  // Confirm — approving a prepared prefill. Keep the standalone "yes"/"y"
  // affirmations tight so they don't swallow richer messages.
  const trimmed = lc.trim();
  if (
    /\b(confirm|submit)\b/.test(lc) ||
    /^(yes|yep|yeah|yup|ok|okay|y)\b/.test(trimmed) ||
    trimmed === 'y'
  ) {
    return 'confirm';
  }
  return 'unknown';
}

export async function classifyIntent(text: string): Promise<Intent> {
  const apiKey = process.env['ANTHROPIC_API_KEY'];
  if (!apiKey) return classifyIntentKeyword(text);

  const client = new Anthropic({ apiKey });
  const res = await client.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 32,
    system: ROUTER_PROMPT,
    messages: [{ role: 'user', content: text }],
  });
  const block = res.content.find((c) => c.type === 'text');
  const out =
    block && 'text' in block ? block.text.trim().toLowerCase() : 'unknown';
  return (ALL_INTENTS as readonly string[]).includes(out)
    ? (out as Intent)
    : 'unknown';
}
