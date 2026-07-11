import { notFound } from 'next/navigation';
import { getSession } from '@/server/session';
import { hasAnyRole } from '@/server/roles';
import { prisma } from '@/server/db';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { TriageForm } from './triage-form';

/**
 * Feedback triage queue — super_admin + admin. Lists every
 * FeedbackTicket newest first, grouped by status. Each row has an
 * inline triage form to set status + append notes. Critical and
 * urgent open tickets pinned at the top.
 *
 * The workflow: pilot users submit via the floating widget. Claude
 * reviews open tickets in autonomous sessions and proposes responses
 * (writing to triageNotes + flipping status to 'triaged'). TT then
 * reviews here, approving (status='approved') or declining
 * (status='declined') before any code lands.
 */
export default async function AdminFeedbackPage() {
  const session = await getSession();
  if (!hasAnyRole(session, ['super_admin', 'admin'])) notFound();

  const tickets = await prisma.feedbackTicket.findMany({
    orderBy: [
      // Urgency desc (critical first via custom order), then newest first
      { createdAt: 'desc' },
    ],
    include: {
      submitter: {
        select: { id: true, initials: true, firstName: true, lastName: true },
      },
      decidedBy: {
        select: { id: true, initials: true, firstName: true, lastName: true },
      },
    },
  });

  // Re-sort: critical first, then urgent, then routine, then by date
  const URGENCY_ORDER = { critical: 0, urgent: 1, routine: 2 } as const;
  const open = tickets
    .filter(
      (t) =>
        t.status === 'open' ||
        t.status === 'triaged' ||
        t.status === 'approved' ||
        t.status === 'in_progress',
    )
    .sort((a, b) => {
      const u = URGENCY_ORDER[a.urgency] - URGENCY_ORDER[b.urgency];
      if (u !== 0) return u;
      return b.createdAt.getTime() - a.createdAt.getTime();
    });
  const closed = tickets.filter(
    (t) => t.status === 'resolved' || t.status === 'declined' || t.status === 'duplicate',
  );

  const counts = {
    critical: open.filter((t) => t.urgency === 'critical' && t.status === 'open').length,
    urgent: open.filter((t) => t.urgency === 'urgent' && t.status === 'open').length,
    routine: open.filter((t) => t.urgency === 'routine' && t.status === 'open').length,
    total: tickets.length,
  };

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-ink">Feedback queue</h1>
        <p className="text-sm text-ink-3">
          Pilot users submit via the floating widget. Triage here:
          set status, add notes, approve or decline. Claude reviews
          the queue in autonomous sessions and proposes responses
          before any code lands.
        </p>
      </header>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <SummaryTile
          label="Critical · open"
          value={counts.critical}
          tone={counts.critical > 0 ? 'red' : undefined}
        />
        <SummaryTile
          label="Urgent · open"
          value={counts.urgent}
          tone={counts.urgent > 0 ? 'amber' : undefined}
        />
        <SummaryTile label="Routine · open" value={counts.routine} />
        <SummaryTile label="Total ever" value={counts.total} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">
            Open queue
            <span className="ml-2 text-xs tabular-nums text-ink-3">{open.length}</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {open.length === 0 ? (
            <p className="py-6 text-center text-sm text-ink-3">
              No open tickets. Pilot users haven&apos;t submitted anything yet, or
              everything&apos;s been resolved.
            </p>
          ) : (
            open.map((t) => <TicketRow key={t.id} t={t} />)
          )}
        </CardContent>
      </Card>

      {closed.length > 0 && (
        <details className="rounded-lg border border-line bg-card">
          <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-ink">
            Closed
            <span className="ml-2 text-xs tabular-nums text-ink-3">{closed.length}</span>
          </summary>
          <div className="space-y-3 border-t border-line px-4 py-3">
            {closed.map((t) => (
              <TicketRow key={t.id} t={t} />
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

type Ticket = Awaited<ReturnType<typeof prisma.feedbackTicket.findMany>>[number] & {
  submitter: { initials: string; firstName: string; lastName: string };
  decidedBy: { initials: string; firstName: string; lastName: string } | null;
};

function TicketRow({ t }: { t: Ticket }) {
  const urgencyVariant: 'red' | 'amber' | 'outline' =
    t.urgency === 'critical' ? 'red' : t.urgency === 'urgent' ? 'amber' : 'outline';
  return (
    <div className="rounded-md border border-line bg-surface-elev px-3 py-2">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant={urgencyVariant} className="text-[10px] uppercase">
              {t.urgency}
            </Badge>
            <Badge variant="outline" className="text-[10px]">
              {t.kind}
            </Badge>
            <Badge variant="outline" className="text-[10px] capitalize">
              {t.status.replace('_', ' ')}
            </Badge>
            <span className="text-[11px] text-ink-3">
              {t.submitter.firstName} {t.submitter.lastName} ·{' '}
              {t.createdAt.toLocaleDateString('en-AU', {
                day: 'numeric',
                month: 'short',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
            {t.contextPath && (
              <code className="text-[10px] text-ink-4">{t.contextPath}</code>
            )}
          </div>
          <div className="mt-1.5 font-medium text-ink">{t.title}</div>
          <p className="mt-0.5 whitespace-pre-wrap text-xs text-ink-2">{t.body}</p>
          {t.triageNotes && (
            <div className="mt-2 rounded-md border-l-2 border-brand bg-surface-subtle/30 px-2 py-1 text-[11px] text-ink-2">
              <div className="mb-0.5 font-semibold text-ink-3">Triage notes</div>
              <p className="whitespace-pre-wrap">{t.triageNotes}</p>
            </div>
          )}
          {t.resolutionSummary && (
            <div className="mt-1 rounded-md border-l-2 border-status-green bg-status-green-soft/20 px-2 py-1 text-[11px] text-ink-2">
              <div className="mb-0.5 font-semibold text-status-green">Resolution</div>
              <p className="whitespace-pre-wrap">{t.resolutionSummary}</p>
            </div>
          )}
          {t.decidedBy && t.decidedAt && (
            <div className="mt-1 text-[10px] text-ink-4">
              Decided by {t.decidedBy.firstName} {t.decidedBy.lastName} on{' '}
              {t.decidedAt.toLocaleDateString('en-AU')}
            </div>
          )}
        </div>
      </div>
      <div className="mt-2 border-t border-line pt-2">
        <TriageForm
          id={t.id}
          currentStatus={t.status}
          currentNotes={t.triageNotes ?? ''}
          currentResolution={t.resolutionSummary ?? ''}
          currentCommitRef={t.commitRef ?? ''}
          routedToDevAt={t.routedToDevAt ? t.routedToDevAt.toISOString() : null}
        />
      </div>
    </div>
  );
}

function SummaryTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: 'red' | 'amber';
}) {
  const valueClass =
    tone === 'red'
      ? 'text-status-red'
      : tone === 'amber'
        ? 'text-status-amber'
        : 'text-ink';
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-[11px] uppercase tracking-wide text-ink-3">{label}</div>
        <div className={`mt-1 text-2xl font-semibold tabular-nums ${valueClass}`}>
          {value}
        </div>
      </CardContent>
    </Card>
  );
}
