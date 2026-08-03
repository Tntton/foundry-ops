/**
 * Revenue attribution for multi-project invoices (feedback #12B, "Option C").
 *
 * An invoice keeps a single primary project on the header
 * (`Invoice.projectId`) for numbering / client / approvals, but each
 * `InvoiceLine` may carry its own `projectId` to draw from a sibling
 * project of the same client. Per-project revenue reports must therefore
 * attribute by LINE project (falling back to the header project when a
 * line has none), not by the header alone.
 *
 * This is the single source of truth both the reports and any future
 * surface should use, so attribution stays consistent everywhere.
 */

export type InvoiceLineForAttribution = {
  /** Line project override; null → belongs to the invoice's header project. */
  projectId: string | null;
  /** Line amount in ex-GST cents. */
  amount: number;
};

export type InvoiceForAttribution = {
  /** Header / primary project id. */
  projectId: string;
  /** Header ex-GST total in cents (== Σ line.amount at creation). */
  amountExGst: number;
  /** Line items; when absent/empty the whole header amount is attributed
   *  to the header project (legacy / agent-drafted invoices). */
  lineItems?: readonly InvoiceLineForAttribution[];
};

export type ProjectRevenueContribution = {
  projectId: string;
  amountExGstCents: number;
};

/**
 * Split an invoice's ex-GST revenue across the projects its lines belong
 * to. Lines with no `projectId` fall back to the header project.
 * Contributions for the same project are merged.
 *
 * Because `amountExGst === Σ line.amount` at creation, the returned
 * contributions sum to `amountExGst`. For a single-project invoice (no
 * line has an override) this yields exactly one contribution equal to
 * the header total — identical to the pre-#12B behaviour, so existing
 * reports are unchanged for existing data.
 *
 * Any drift between the line sum and the stored header total (rounding,
 * or a manual header edit) is reconciled onto the header project so the
 * contributions always sum to `amountExGst` and firm-wide totals stay
 * exact.
 */
export function invoiceRevenueByProject(
  inv: InvoiceForAttribution,
): ProjectRevenueContribution[] {
  const lines = inv.lineItems ?? [];
  if (lines.length === 0) {
    return [{ projectId: inv.projectId, amountExGstCents: inv.amountExGst }];
  }

  const byProject = new Map<string, number>();
  let lineSum = 0;
  for (const line of lines) {
    const pid = line.projectId ?? inv.projectId;
    byProject.set(pid, (byProject.get(pid) ?? 0) + line.amount);
    lineSum += line.amount;
  }

  const drift = inv.amountExGst - lineSum;
  if (drift !== 0) {
    byProject.set(inv.projectId, (byProject.get(inv.projectId) ?? 0) + drift);
  }

  return [...byProject.entries()].map(([projectId, amountExGstCents]) => ({
    projectId,
    amountExGstCents,
  }));
}
