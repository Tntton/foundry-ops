/**
 * External-source reference prefixes on `Expense.description`.
 *
 * The Uber email/SFTP intake and the Navan sync both dedupe by writing a
 * machine reference into the FRONT of the description and then querying
 * `description: { startsWith: ref }` before creating anything:
 *
 *   uber:trip:R-8841 · Uber receipt (email) · Surry Hills → Mascot
 *   navan:expense:9f21 · Qantas · SYD-MEL return
 *
 * That makes the description a load-bearing idempotency key, which was
 * safe only while nobody could edit it. TASK-516 lets the submitter
 * rewrite the description — and a human who deletes "uber:trip:R-8841"
 * silently destroys the dedupe key, so the next sync re-imports the same
 * trip as a second expense.
 *
 * The fix is to treat the reference as metadata rather than prose: strip
 * it before showing the description to a human, and re-attach it on save.
 * The human never sees it, never has to preserve it, and cannot drop it.
 *
 * Keep this list in sync with the `startsWith` dedupe queries in
 * `src/server/integrations/uber-email-intake.ts`, `uber-sync.ts` and
 * `navan-sync.ts`.
 */
const EXTERNAL_REF_PREFIXES = ['uber:trip:', 'navan:expense:'] as const;

/** `<prefix><id>` optionally followed by the ` · ` separator the intakes use. */
const EXTERNAL_REF_PATTERN = new RegExp(
  `^((?:${EXTERNAL_REF_PREFIXES.join('|')})[^\\s·]+)(?:\\s*·\\s*)?`,
);

export type SplitDescription = {
  /** The machine reference, without the trailing separator. Null when the
   *  expense didn't come from an external sync. */
  ref: string | null;
  /** The human-facing remainder — what the edit form shows and accepts. */
  text: string;
};

/** Split a stored description into its sync reference and the human text. */
export function splitExternalRef(description: string | null | undefined): SplitDescription {
  const raw = description ?? '';
  const match = EXTERNAL_REF_PATTERN.exec(raw);
  if (!match) return { ref: null, text: raw };
  return { ref: match[1] ?? null, text: raw.slice(match[0].length) };
}

/**
 * Re-attach a sync reference to human-edited text, in the same
 * `<ref> · <text>` shape the intakes write so the `startsWith` dedupe
 * keeps matching. Returns null for a description that is empty on both
 * halves, since `Expense.description` is nullable.
 */
export function joinExternalRef(ref: string | null, text: string | null | undefined): string | null {
  const body = (text ?? '').trim();
  if (!ref) return body === '' ? null : body;
  // Guard against a human pasting the ref back in themselves — otherwise
  // a round-trip would double it.
  const { text: stripped } = splitExternalRef(body);
  return (stripped === '' ? ref : `${ref} · ${stripped}`).slice(0, 1000);
}
