import { prisma } from '@/server/db';
import type { FeedbackStatus, FeedbackUrgency, FeedbackKind } from '@prisma/client';

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
