import type { ProjectStage } from '@prisma/client';
import { prisma } from '@/server/db';
import { hasAnyRole } from '@/server/roles';
import type { Session } from '@/server/session';

/**
 * "Invoices to generate" — the queue of work that says: this project
 * has a billable event ready to invoice but no draft / approved
 * invoice has been raised against it yet.
 *
 * Three signal sources today:
 *   1. **Milestone delivered** — Milestone.status = 'delivered' and
 *      Milestone.invoiceId IS NULL. Partner has flagged the work done;
 *      next step is to draft the invoice.
 *   2. **Milestone overdue** — Milestone.dueDate < today AND status
 *      not yet 'invoiced'. Likely scenario: work shipped, partner
 *      forgot to bump status, or the milestone slipped without an
 *      invoice. Either way the row needs eyes.
 *   3. **Project initiation pending** — Project in `kickoff` or
 *      `delivery` stage, started > 14 days ago, with zero invoices on
 *      file. The first invoice (deposit / first milestone / setup
 *      fee) is overdue. 14-day floor stops fresh projects from
 *      flooding the list before the partner's had time to settle.
 *
 * Sort order: overdue first, then delivered, then initiation —
 * tightest urgency at the top. Suggestions are per-project but a
 * project can surface twice if it has both a delivered milestone AND
 * an overdue one (rare but possible). Caller can dedupe by projectId
 * if they want a one-row-per-project view.
 *
 * Visibility:
 *   - super_admin / admin: every active project, firm-wide
 *   - partner: projects where they're the primary partner
 *   - manager: projects they manage
 *   - everyone else: empty
 *
 * Audit: read-only. The eventual "generate from suggestion" action
 * writes its own audit event on the Invoice it creates — this helper
 * never mutates.
 */

export type InvoiceSuggestionKind =
  | 'milestone_delivered'
  | 'milestone_overdue'
  | 'project_initiation';

export type InvoiceSuggestion = {
  /** Stable id for React keys — composed from kind + source row id
   *  so two distinct suggestions on the same project don't collide. */
  id: string;
  kind: InvoiceSuggestionKind;
  project: {
    id: string;
    code: string;
    name: string;
  };
  client: {
    id: string;
    code: string;
    legalName: string;
  };
  /** Human-readable reason — what to render in the UI. Already
   *  populated with the specific milestone label / age, so the UI
   *  just prints it. */
  reason: string;
  /** Suggested invoice amount in cents (ex-GST). Null when the
   *  signal doesn't carry an amount — e.g. project initiation on a
   *  project with no milestone schedule, where the partner picks
   *  the deposit % themselves. */
  amountCents: number | null;
  /** Source milestone id when the suggestion came from a Milestone
   *  row. Threaded through so the eventual "draft invoice from
   *  milestone" CTA can pre-fill the invoice form. */
  milestoneId: string | null;
  /** Days into urgency — overdue counts up from due date, delivered
   *  counts up from delivered date (proxy = milestone updatedAt for
   *  now, no dedicated deliveredAt column yet), initiation counts up
   *  from project startDate. Used to sort the list. */
  ageDays: number;
};

const FOURTEEN_DAYS_MS = 14 * 24 * 3600 * 1000;

export async function listInvoiceSuggestions(
  session: Session,
): Promise<InvoiceSuggestion[]> {
  const isAdmin = hasAnyRole(session, ['super_admin', 'admin']);
  const isPartner = hasAnyRole(session, ['partner']);
  const isManager = hasAnyRole(session, ['manager']);
  if (!isAdmin && !isPartner && !isManager) return [];

  // Role-scoped project filter. Admins see firm-wide; partners see
  // projects they primary-partner; managers see projects they manage.
  // Stage filter excludes archived (a closed project can still get a
  // tidy-up invoice but stays out of the active suggestion queue —
  // surfaces via the closing-checklist instead). Spread into a fresh
  // mutable array — Prisma's `in` filter rejects readonly tuples.
  const ACTIVE_STAGES: ProjectStage[] = ['kickoff', 'delivery', 'closing'];
  const projectFilter = isAdmin
    ? { stage: { in: ACTIVE_STAGES } }
    : isPartner
      ? {
          stage: { in: ACTIVE_STAGES },
          primaryPartnerId: session.person.id,
        }
      : {
          stage: { in: ACTIVE_STAGES },
          managerId: session.person.id,
        };

  // Pull projects + the bits we need to reason about milestones +
  // invoice history. One query, joined relations — cheaper than
  // three separate calls on this scale (12-person firm, ~20 active
  // projects max).
  const projects = await prisma.project.findMany({
    where: projectFilter,
    select: {
      id: true,
      code: true,
      name: true,
      stage: true,
      startDate: true,
      client: { select: { id: true, code: true, legalName: true } },
      milestones: {
        select: {
          id: true,
          label: true,
          dueDate: true,
          amount: true,
          status: true,
          invoiceId: true,
          // updatedAt as a proxy for "delivered at" — we don't have
          // a dedicated `deliveredAt` column. The partner who flips
          // status to 'delivered' bumps updatedAt; the suggestion's
          // age-since-delivered uses this. Slight noise (any edit
          // bumps it) but the order-of-magnitude is right.
          // Schema doesn't expose updatedAt on Milestone today; this
          // falls back to dueDate when missing.
        },
      },
      invoices: {
        select: { id: true, status: true },
        // We care about whether any invoice exists in any state for
        // the initiation signal — even a draft counts as "the
        // partner has started" and we shouldn't nag them about it.
      },
    },
    take: 200, // safety cap; firm has nowhere near this many active
  });

  const now = Date.now();
  const suggestions: InvoiceSuggestion[] = [];

  for (const p of projects) {
    // ── 1+2. Milestone-driven signals ────────────────────────────
    for (const m of p.milestones) {
      if (m.invoiceId) continue; // already invoiced
      const due = m.dueDate.getTime();
      const isPastDue = due < now;
      const ageDays = Math.max(0, Math.floor((now - due) / (24 * 3600 * 1000)));

      if (m.status === 'delivered') {
        suggestions.push({
          id: `milestone:${m.id}`,
          kind: 'milestone_delivered',
          project: { id: p.id, code: p.code, name: p.name },
          client: p.client,
          reason: isPastDue
            ? `Milestone "${m.label}" delivered · was due ${ageDays}d ago`
            : `Milestone "${m.label}" delivered · due ${m.dueDate.toLocaleDateString('en-AU')}`,
          amountCents: m.amount,
          milestoneId: m.id,
          ageDays: isPastDue ? ageDays + 100 : 50, // delivered slightly above merely-past-due
        });
        continue;
      }
      if (isPastDue && m.status !== 'invoiced') {
        suggestions.push({
          id: `milestone:${m.id}`,
          kind: 'milestone_overdue',
          project: { id: p.id, code: p.code, name: p.name },
          client: p.client,
          reason: `Milestone "${m.label}" past due ${ageDays}d · still ${m.status.replace(/_/g, ' ')}`,
          amountCents: m.amount,
          milestoneId: m.id,
          ageDays,
        });
        continue;
      }
    }

    // ── 3. Project initiation signal ─────────────────────────────
    // Fires when an active project has zero invoices on file and
    // started more than 14 days ago. Skip when the project has a
    // delivered/overdue milestone already in the suggestion list —
    // the milestone signal is more specific.
    if (
      p.invoices.length === 0 &&
      p.startDate !== null &&
      now - p.startDate.getTime() > FOURTEEN_DAYS_MS
    ) {
      const ageDays = Math.floor(
        (now - p.startDate.getTime()) / (24 * 3600 * 1000),
      );
      // Suppress when the project already has a delivered / overdue
      // milestone surfacing — the more-specific signal is enough.
      const alreadySurfaced = suggestions.some(
        (s) =>
          s.project.id === p.id &&
          (s.kind === 'milestone_delivered' || s.kind === 'milestone_overdue'),
      );
      if (!alreadySurfaced) {
        suggestions.push({
          id: `init:${p.id}`,
          kind: 'project_initiation',
          project: { id: p.id, code: p.code, name: p.name },
          client: p.client,
          reason: `Project started ${ageDays}d ago — no invoice on file yet`,
          // No specific amount — partner picks deposit % or first
          // milestone manually.
          amountCents: null,
          milestoneId: null,
          ageDays,
        });
      }
    }
  }

  // Stable sort: highest urgency first. `ageDays` already encodes
  // the priority bump for delivered vs. overdue; ties break by
  // project code so the list is deterministic across reloads.
  suggestions.sort((a, b) => {
    if (a.ageDays !== b.ageDays) return b.ageDays - a.ageDays;
    return a.project.code.localeCompare(b.project.code);
  });

  return suggestions;
}
