/**
 * Formats an approved feedback ticket into a self-contained
 * implementation brief — the paste-ready prompt that goes into a
 * Claude Code chat so the issue can be built immediately, with no
 * back-reference to the app needed.
 *
 * Kept dependency-free (pure string) so it can run in a server action
 * or be unit-tested without a DB.
 */
export type FeedbackBriefInput = {
  id: string;
  title: string;
  body: string;
  kind: string;
  urgency: string;
  contextPath: string | null;
  triageNotes: string | null;
  submitterName: string;
};

export function buildFeedbackBrief(t: FeedbackBriefInput): string {
  const lines = [
    `Implement this Foundry Ops feedback ticket.`,
    ``,
    `Ticket: ${t.id}`,
    `Title: ${t.title}`,
    `Type: ${t.kind} · Urgency: ${t.urgency}`,
    `Raised by: ${t.submitterName}`,
    t.contextPath ? `Screen: ${t.contextPath}` : null,
    ``,
    `What was asked:`,
    t.body.trim(),
    t.triageNotes && t.triageNotes.trim().length > 0
      ? `\nTriage notes (assessment + proposed path):\n${t.triageNotes.trim()}`
      : null,
    ``,
    `When done: commit the change, then mark ticket ${t.id} resolved in`,
    `/admin/feedback with a one-line resolution summary and the commit SHA.`,
  ].filter((l): l is string => l !== null);
  return lines.join('\n');
}
