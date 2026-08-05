import { notFound } from 'next/navigation';
import { getSession } from '@/server/session';
import { hasAnyRole } from '@/server/roles';
import { prisma } from '@/server/db';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { feedbackLane } from '@/server/feedback';
import { TriageForm } from './triage-form';
import { ArchiveButton } from './archive-button';

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

  // Three lanes (feedbackLane): active (in flight), ready_to_archive
  // (completed but not archived — stays visible so nothing finished
  // silently disappears), and archived (cleared from the active view).
  const URGENCY_ORDER = { critical: 0, urgent: 1, routine: 2 } as const;
  const open = tickets
    .filter((t) => feedbackLane(t.status, t.archivedAt) === 'active')
    .sort((a, b) => {
      const u = URGENCY_ORDER[a.urgency] - URGENCY_ORDER[b.urgency];
      if (u !== 0) return u;
      return b.createdAt.getTime() - a.createdAt.getTime();
    });
  // Completed, awaiting archive — newest completion first.
  const readyToArchive = tickets
    .filter((t) => feedbackLane(t.status, t.archivedAt) === 'ready_to_archive')
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  const archived = tickets
    .filter((t) => feedbackLane(t.status, t.archivedAt) === 'archived')
    .sort(
      (a, b) => (b.archivedAt?.getTime() ?? 0) - (a.archivedAt?.getTime() ?? 0),
    );

  const counts = {
    critical: open.filter((t) => t.urgency === 'critical' && t.status === 'open').length,
    urgent: open.filter((t) => t.urgency === 'urgent' && t.status === 'open').length,
    readyToArchive: readyToArchive.length,
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
        <SummaryTile
          label="Ready to archive"
          value={counts.readyToArchive}
          tone={counts.readyToArchive > 0 ? 'green' : undefined}
        />
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

      {/* Completed — ready to archive. Kept EXPANDED (not tucked into a
          collapsible) so what's been finished is always visible; each
          shows its resolution + commit/PR and an Archive button to clear
          it once TT has seen it. */}
      {readyToArchive.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">
              Completed · ready to archive
              <span className="ml-2 text-xs tabular-nums text-ink-3">
                {readyToArchive.length}
              </span>
            </CardTitle>
            <p className="text-[11px] text-ink-3">
              Finished work. A green <span className="text-status-green">✓ Shipped</span>{' '}
              with a commit/PR link means it&apos;s been actioned and verified —
              archive to clear it. Amber means no code link is attached yet;
              confirm before archiving.
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            {readyToArchive.map((t) => (
              <TicketRow key={t.id} t={t} archivable />
            ))}
          </CardContent>
        </Card>
      )}

      {archived.length > 0 && (
        <details className="rounded-lg border border-line bg-card">
          <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-ink">
            Archived
            <span className="ml-2 text-xs tabular-nums text-ink-3">{archived.length}</span>
          </summary>
          <div className="space-y-3 border-t border-line px-4 py-3">
            {archived.map((t) => (
              <TicketRow key={t.id} t={t} archivable />
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

function TicketRow({ t, archivable = false }: { t: Ticket; archivable?: boolean }) {
  const urgencyVariant: 'red' | 'amber' | 'outline' =
    t.urgency === 'critical' ? 'red' : t.urgency === 'urgent' ? 'amber' : 'outline';
  const isArchived = t.archivedAt !== null;
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
      <ActionEvidence status={t.status} commitRef={t.commitRef} />
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
      {archivable && (
        <div className="mt-2 flex items-center justify-end gap-2 border-t border-line pt-2">
          {isArchived && t.archivedAt && (
            <span className="text-[10px] text-ink-4">
              Archived {t.archivedAt.toLocaleDateString('en-AU')}
            </span>
          )}
          <ArchiveButton id={t.id} archived={isArchived} />
        </div>
      )}
    </div>
  );
}

const REPO_URL = 'https://github.com/Tntton/foundry-ops';

/**
 * Turn a commit/PR reference into a clickable URL so "properly actioned"
 * is verifiable in one click. A full URL passes through; a bare SHA links
 * to the commit on the repo; anything else (free-text) has no link.
 */
function commitRefHref(ref: string): string | null {
  const r = ref.trim();
  if (/^https?:\/\//iu.test(r)) return r;
  if (/^[0-9a-f]{7,40}$/iu.test(r)) return `${REPO_URL}/commit/${r}`;
  return null;
}

/**
 * The at-a-glance "has this been properly actioned?" signal that makes an
 * archive decision confident:
 *   - resolved + commit/PR  → green "Shipped" with a clickable link (proof)
 *   - resolved + no ref     → amber "verify before archiving" (no proof yet)
 *   - declined / duplicate  → neutral "no code change" (nothing to verify)
 *   - in-flight + a ref     → plain link to the work in progress
 */
function ActionEvidence({
  status,
  commitRef,
}: {
  status: string;
  commitRef: string | null;
}) {
  const href = commitRef ? commitRefHref(commitRef) : null;
  const refNode = commitRef ? (
    href ? (
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className="font-mono text-ink-2 underline hover:text-ink"
      >
        {commitRef}
      </a>
    ) : (
      <code className="text-ink-3">{commitRef}</code>
    )
  ) : null;

  if (status === 'resolved') {
    return (
      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px]">
        {commitRef ? (
          <>
            <span className="rounded-sm bg-status-green-soft px-1.5 py-0.5 font-medium uppercase tracking-wide text-status-green">
              ✓ Shipped
            </span>
            {refNode}
          </>
        ) : (
          <span className="rounded-sm bg-status-amber-soft px-1.5 py-0.5 font-medium uppercase tracking-wide text-status-amber">
            Resolved · no commit/PR link — verify before archiving
          </span>
        )}
      </div>
    );
  }
  if (status === 'declined' || status === 'duplicate') {
    return (
      <div className="mt-1 text-[10px] capitalize text-ink-4">
        {status} — no code change
      </div>
    );
  }
  // In-flight: surface a linked ref if one's already attached.
  return commitRef ? (
    <div className="mt-1 text-[10px] text-ink-4">Commit / PR: {refNode}</div>
  ) : null;
}

function SummaryTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: 'red' | 'amber' | 'green';
}) {
  const valueClass =
    tone === 'red'
      ? 'text-status-red'
      : tone === 'amber'
        ? 'text-status-amber'
        : tone === 'green'
          ? 'text-status-green'
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
