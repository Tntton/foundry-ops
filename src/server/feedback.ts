import { prisma } from '@/server/db';
import type { FeedbackStatus, FeedbackUrgency, FeedbackKind } from '@prisma/client';

function feedbackAppBaseUrl(): string {
  return process.env['NEXT_PUBLIC_APP_URL'] ?? 'https://ops.foundry.health';
}

export type CriticalFeedbackWhatsAppInput = {
  title: string;
  kind: FeedbackKind;
  submitterName: string;
  appBaseUrl: string;
};

/**
 * Copy for the WhatsApp DM a Super Admin receives when a *critical*
 * feedback ticket is raised. Pure so it's unit-testable without the
 * network. Leads with the urgency marker, states what and who, and
 * deep-links to the triage surface where the action actually happens
 * (WhatsApp is the nudge; the decision stays web-only per the
 * high-value approval policy). Kept short — it renders on a phone.
 */
export function buildCriticalFeedbackWhatsApp(
  input: CriticalFeedbackWhatsAppInput,
): string {
  return (
    `🔴 Foundry Ops · CRITICAL feedback needs action` +
    `\n${input.title}` +
    `\n${input.kind} · raised by ${input.submitterName}` +
    `\nTriage: ${input.appBaseUrl}/admin/feedback`
  );
}

/**
 * WhatsApp side-channel for critical feedback (mirrors the approval
 * side-channel in notifyApproversOfNewApproval). When a ticket is
 * raised at `critical` urgency, DM every active Super Admin who has a
 * WhatsApp number on file (excluding the submitter) so it can't sit
 * unseen in the in-app feed. Fire-and-forget + best-effort: a send
 * failure is logged, never thrown — the in-app notifyAdminPool row is
 * the source of truth. No-op when WhatsApp isn't configured.
 */
export async function notifySuperAdminsOfCriticalFeedbackWhatsApp(opts: {
  title: string;
  kind: FeedbackKind;
  submitterId: string;
  submitterName: string;
}): Promise<void> {
  const supers = await prisma.person.findMany({
    where: {
      endDate: null,
      inactiveAt: null,
      roles: { has: 'super_admin' },
      id: { not: opts.submitterId },
      whatsappNumber: { not: null },
    },
    select: { id: true, whatsappNumber: true },
  });
  if (supers.length === 0) return;

  const { isWhatsAppConfigured, sendWhatsAppText } = await import(
    '@/server/integrations/whatsapp'
  );
  if (!isWhatsAppConfigured()) return;

  const message = buildCriticalFeedbackWhatsApp({
    title: opts.title,
    kind: opts.kind,
    submitterName: opts.submitterName,
    appBaseUrl: feedbackAppBaseUrl(),
  });
  for (const p of supers) {
    if (!p.whatsappNumber) continue;
    try {
      await sendWhatsAppText(p.whatsappNumber, message);
    } catch (err) {
      console.error('[whatsapp.critical-feedback] failed for', p.id, err);
    }
  }
}

export type FeedbackPipelineCard = {
  id: string;
  title: string;
  urgency: FeedbackUrgency;
  kind: FeedbackKind;
  status: FeedbackStatus;
  submitterName: string;
  updatedAt: Date;
};

export type FeedbackPipeline = {
  counts: {
    open: number;
    triaged: number;
    approved: number;
    inProgress: number;
    resolvedRecent: number; // last 7 days
    critical: number; // open or triaged, urgency=critical
    urgent: number; // open or triaged, urgency=urgent
  };
  /** Concrete tickets to render in each lane — capped at 5 per lane
   *  so the dashboard card stays compact. */
  triaged: FeedbackPipelineCard[];
  approved: FeedbackPipelineCard[];
  inProgress: FeedbackPipelineCard[];
  recentlyResolved: FeedbackPipelineCard[];
};

/**
 * Pipeline view for the dashboard widget. Returns counts across all
 * lanes plus up to 5 tickets per lane (those that admin/TT actively
 * need to act on or just shipped). Resolved cap is 7 days so the
 * card stays scannable.
 */
export async function getFeedbackPipeline(): Promise<FeedbackPipeline> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000);
  const tickets = await prisma.feedbackTicket.findMany({
    where: {
      OR: [
        { status: { in: ['open', 'triaged', 'approved', 'in_progress'] } },
        { status: 'resolved', updatedAt: { gte: sevenDaysAgo } },
      ],
    },
    orderBy: { updatedAt: 'desc' },
    include: {
      submitter: { select: { firstName: true, lastName: true } },
    },
  });

  function toCard(
    t: (typeof tickets)[number],
  ): FeedbackPipelineCard {
    return {
      id: t.id,
      title: t.title,
      urgency: t.urgency,
      kind: t.kind,
      status: t.status,
      submitterName: `${t.submitter.firstName} ${t.submitter.lastName}`,
      updatedAt: t.updatedAt,
    };
  }

  const byStatus = (s: FeedbackStatus) =>
    tickets.filter((t) => t.status === s).map(toCard);

  const open = tickets.filter((t) => t.status === 'open');
  const triaged = tickets.filter((t) => t.status === 'triaged');
  const approved = tickets.filter((t) => t.status === 'approved');
  const inProgress = tickets.filter((t) => t.status === 'in_progress');
  const resolvedRecent = tickets.filter((t) => t.status === 'resolved');

  // Critical / urgent attention counts include only un-actioned tiers
  const attentionTiers = ['open', 'triaged'] as const;
  const critical = tickets.filter(
    (t) => attentionTiers.includes(t.status as 'open' | 'triaged') && t.urgency === 'critical',
  ).length;
  const urgent = tickets.filter(
    (t) => attentionTiers.includes(t.status as 'open' | 'triaged') && t.urgency === 'urgent',
  ).length;

  return {
    counts: {
      open: open.length,
      triaged: triaged.length,
      approved: approved.length,
      inProgress: inProgress.length,
      resolvedRecent: resolvedRecent.length,
      critical,
      urgent,
    },
    triaged: byStatus('triaged').slice(0, 5),
    approved: byStatus('approved').slice(0, 5),
    inProgress: byStatus('in_progress').slice(0, 5),
    recentlyResolved: byStatus('resolved').slice(0, 5),
  };
}
