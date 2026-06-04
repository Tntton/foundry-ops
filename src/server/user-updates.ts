/**
 * Per-person notification feed. Sits alongside (not on top of) the
 * audit log:
 *
 *   - AuditEvent  → firm-wide, immutable, "what happened to which
 *                   entity, by whom" — read by admins for compliance.
 *   - UserUpdate  → per-person, opinionated, "things that changed
 *                   about you / your work" — read by the dashboard
 *                   "Latest updates for me" card and the nav badge.
 *
 * Mutating actions write to BOTH where it makes sense — e.g. approving
 * an expense writes one AuditEvent (firm log) and one UserUpdate to
 * the requester (so they see "Your expense was approved").
 *
 * Helpers below are intentionally tx-scoped: emits go inside the same
 * Prisma transaction that performs the mutation, so the feed entry can
 * never get out of sync with the underlying state change.
 */
import type {
  ApprovalSubjectType,
  Prisma,
  Role,
  UserUpdateKind,
} from '@prisma/client';
import { prisma } from '@/server/db';

export type EmitUserUpdateInput = {
  personId: string;
  kind: UserUpdateKind;
  /** Short imperative-headline string — under ~80 chars. Rendered as
   *  the bold line in the dashboard card. */
  title: string;
  /** Optional sub-line: who did it, the entity ref, the £ amount.
   *  Plain text — no markdown rendering. */
  body?: string | null;
  /** Optional click-through. Relative path preferred so we can render
   *  with `<Link>` rather than an external anchor. */
  href?: string | null;
  /** When the update is about a domain entity (project, expense,
   *  invoice…), capture its type/id so future "mark related as read"
   *  flows can find them. */
  entityType?: string | null;
  entityId?: string | null;
};

/**
 * Write a UserUpdate row. Pass the active Prisma transaction client
 * so the feed entry shares the mutation's atomic boundary.
 */
export async function emitUserUpdate(
  tx: Prisma.TransactionClient,
  input: EmitUserUpdateInput,
): Promise<void> {
  await tx.userUpdate.create({
    data: {
      personId: input.personId,
      kind: input.kind,
      title: input.title,
      body: input.body ?? null,
      href: input.href ?? null,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
    },
  });
}

/**
 * Emit the same update to many people in one go (e.g. notifying every
 * project team member when a checklist item flips). Empty `personIds`
 * is a no-op so callers don't need to gate.
 */
export async function emitUserUpdateMany(
  tx: Prisma.TransactionClient,
  personIds: string[],
  input: Omit<EmitUserUpdateInput, 'personId'>,
): Promise<void> {
  if (personIds.length === 0) return;
  await tx.userUpdate.createMany({
    data: personIds.map((personId) => ({
      personId,
      kind: input.kind,
      title: input.title,
      body: input.body ?? null,
      href: input.href ?? null,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
    })),
  });
}

export type UserUpdateRow = {
  id: string;
  kind: UserUpdateKind;
  title: string;
  body: string | null;
  href: string | null;
  entityType: string | null;
  entityId: string | null;
  readAt: Date | null;
  createdAt: Date;
};

/**
 * Latest-N feed for a person, newest first. Capped at 50 by default —
 * the dashboard card only ever shows the top dozen with a "see all"
 * link to a full page later.
 */
export async function listUserUpdates(
  personId: string,
  limit = 50,
): Promise<UserUpdateRow[]> {
  return prisma.userUpdate.findMany({
    where: { personId },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      id: true,
      kind: true,
      title: true,
      body: true,
      href: true,
      entityType: true,
      entityId: true,
      readAt: true,
      createdAt: true,
    },
  });
}

/**
 * Count of unread updates for a person — drives the nav-bar bubble
 * next to "Dashboard". Zero is a fine return value (the layout hides
 * the bubble when count === 0).
 */
export async function countUnreadUpdates(personId: string): Promise<number> {
  return prisma.userUpdate.count({
    where: { personId, readAt: null },
  });
}

/**
 * Mark every unread update as read for a person. Called when the user
 * opens the dashboard (or explicitly clicks "Mark all read"). Idempotent.
 */
export async function markAllUpdatesRead(personId: string): Promise<number> {
  const result = await prisma.userUpdate.updateMany({
    where: { personId, readAt: null },
    data: { readAt: new Date() },
  });
  return result.count;
}

/**
 * Fan-out helper for admin-pool feed entries.
 *
 * Resolves every active person whose roles include `super_admin` or
 * `admin` (skipping the actor so the person who just performed the
 * action doesn't get a chime for their own work) and emits the same
 * UserUpdate row to each. Shared by:
 *
 *   - person_created / person_archived — directory lifecycle
 *   - rate_card_updated — pricing changes
 *   - project_created / project_stage_changed — project lifecycle
 *
 * Runs inside the caller's transaction so the feed entries can never
 * drift from the underlying mutation.
 */
export async function notifyAdminPool(
  tx: Prisma.TransactionClient,
  opts: {
    actorPersonId: string;
    kind: UserUpdateKind;
    title: string;
    body?: string | null;
    href?: string | null;
    entityType?: string | null;
    entityId?: string | null;
  },
): Promise<void> {
  const admins = await tx.person.findMany({
    where: {
      endDate: null,
      roles: { hasSome: ['super_admin', 'admin'] },
      id: { not: opts.actorPersonId },
    },
    select: { id: true },
  });
  if (admins.length === 0) return;
  await tx.userUpdate.createMany({
    data: admins.map((p) => ({
      personId: p.id,
      kind: opts.kind,
      title: opts.title,
      body: opts.body ?? null,
      href: opts.href ?? null,
      entityType: opts.entityType ?? null,
      entityId: opts.entityId ?? null,
    })),
  });
}

/**
 * Notify the approver pool when a new approval lands in the queue.
 *
 * The approver pool is every active person whose roles overlap with
 * the approval's `requiredRole` PLUS every super_admin (super_admin is
 * authorized for every required role per `canActOnApproval`). The
 * requester is excluded so they don't get notified about their own
 * submission.
 *
 * Runs inside the same Prisma transaction as the `approval.create` so
 * the feed entry can never get out of step with the queue. Errors
 * surface to the caller — bubble up unless the calling action wants to
 * tolerate notification failures.
 */
export async function notifyApproversOfNewApproval(
  tx: Prisma.TransactionClient,
  opts: {
    approvalId: string;
    subjectType: ApprovalSubjectType;
    subjectId: string;
    requiredRole: Role;
    requestedById: string;
    /** Short human-friendly description of what's awaiting decision —
     *  e.g. "$1,250 expense from Sohyb Basir" or "Invoice IFM001-INV-04
     *  for $42,000". Surfaces as the feed body. */
    summary?: string | null;
  },
): Promise<void> {
  const approverPool = await tx.person.findMany({
    where: {
      endDate: null,
      // requiredRole OR super_admin (super_admin can act on any
      // approval per canActOnApproval).
      roles: { hasSome: [opts.requiredRole, 'super_admin'] },
      // Skip the requester themselves.
      id: { not: opts.requestedById },
    },
    select: { id: true, whatsappNumber: true },
  });
  if (approverPool.length === 0) return;
  const subjectLabel =
    opts.subjectType === 'expense'
      ? 'expense'
      : opts.subjectType === 'invoice'
        ? 'invoice'
        : opts.subjectType === 'bill'
          ? 'bill'
          : opts.subjectType.replace(/_/g, ' ');
  const href =
    opts.subjectType === 'expense'
      ? '/approvals'
      : opts.subjectType === 'invoice'
        ? '/approvals'
        : opts.subjectType === 'bill'
          ? '/approvals'
          : '/approvals';
  await tx.userUpdate.createMany({
    data: approverPool.map((p) => ({
      personId: p.id,
      kind: 'approval_requested' as const,
      title: `New ${subjectLabel} awaits your approval`,
      body: opts.summary ?? null,
      href,
      entityType: 'approval',
      entityId: opts.approvalId,
    })),
  });

  // WhatsApp side-channel — DM each approver who has a number on file.
  // Fire-and-forget: failures here don't roll back the tx (the in-app
  // update is the source of truth; WA is best-effort notification).
  // Only attempts when WhatsApp is configured; silent no-op otherwise.
  // Dynamic import to keep the WhatsApp module out of cold-start paths
  // for tx flows that don't need it.
  const targets = approverPool.filter((p) => p.whatsappNumber);
  if (targets.length > 0) {
    void (async () => {
      const { isWhatsAppConfigured, sendWhatsAppText } = await import(
        '@/server/integrations/whatsapp'
      );
      if (!isWhatsAppConfigured()) return;
      const baseUrl =
        process.env['NEXT_PUBLIC_APP_URL'] ?? 'https://ops.foundry.health';
      const message =
        `Foundry Ops · new ${subjectLabel} awaits your approval` +
        (opts.summary ? `\n${opts.summary}` : '') +
        `\nOpen: ${baseUrl}/approvals`;
      for (const p of targets) {
        if (!p.whatsappNumber) continue;
        try {
          await sendWhatsAppText(p.whatsappNumber, message);
        } catch (err) {
          console.error('[whatsapp.approval-notify] failed for', p.id, err);
        }
      }
    })();
  }
}
