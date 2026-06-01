import Link from 'next/link';
import type { FeedbackPipeline, FeedbackPipelineCard } from '@/server/feedback';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * Feedback pipeline summary for the dashboard. Shows counts across
 * lanes (open / triaged / approved / in-progress / resolved-last-7d)
 * plus the actual ticket titles per lane. One-click jump to the full
 * triage queue at /admin/feedback. Visible only to super_admin +
 * admin (caller decides the gate).
 */
export function FeedbackPipelineCardView({
  pipeline,
}: {
  pipeline: FeedbackPipeline;
}) {
  const { counts } = pipeline;
  const totalAttention = counts.open + counts.triaged;
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="text-sm">
          Feedback pipeline
          {totalAttention > 0 && (
            <Badge
              variant={counts.critical > 0 ? 'red' : counts.urgent > 0 ? 'amber' : 'outline'}
              className="ml-2 text-[10px]"
            >
              {totalAttention} need{totalAttention === 1 ? 's' : ''} attention
            </Badge>
          )}
        </CardTitle>
        <Link
          href="/admin/feedback"
          className="text-xs text-brand hover:underline"
        >
          Open queue →
        </Link>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          <StatTile label="Open" value={counts.open} tone={counts.critical > 0 ? 'red' : counts.urgent > 0 ? 'amber' : undefined} />
          <StatTile label="Triaged" value={counts.triaged} sub="pending you" />
          <StatTile label="Approved" value={counts.approved} sub="waiting work" />
          <StatTile label="In progress" value={counts.inProgress} />
          <StatTile label="Resolved · 7d" value={counts.resolvedRecent} tone={counts.resolvedRecent > 0 ? 'green' : undefined} />
        </div>

        {pipeline.triaged.length > 0 && (
          <Lane title="Pending your decision" tickets={pipeline.triaged} />
        )}
        {pipeline.approved.length > 0 && (
          <Lane title="Approved · waiting for work" tickets={pipeline.approved} />
        )}
        {pipeline.inProgress.length > 0 && (
          <Lane title="In progress" tickets={pipeline.inProgress} />
        )}
        {pipeline.recentlyResolved.length > 0 && (
          <Lane title="Resolved (last 7 days)" tickets={pipeline.recentlyResolved} />
        )}
      </CardContent>
    </Card>
  );
}

function Lane({
  title,
  tickets,
}: {
  title: string;
  tickets: FeedbackPipelineCard[];
}) {
  return (
    <div>
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-ink-3">
        {title}
      </div>
      <ul className="space-y-1">
        {tickets.map((t) => (
          <li key={t.id} className="flex items-center justify-between gap-2 text-xs">
            <Link
              href="/admin/feedback"
              className="flex min-w-0 flex-1 items-center gap-1.5 hover:underline"
            >
              <Badge
                variant={
                  t.urgency === 'critical'
                    ? 'red'
                    : t.urgency === 'urgent'
                      ? 'amber'
                      : 'outline'
                }
                className="text-[9px] uppercase shrink-0"
              >
                {t.urgency}
              </Badge>
              <span className="truncate text-ink-2">{t.title}</span>
            </Link>
            <span className="shrink-0 text-[10px] text-ink-4">
              {t.submitterName.split(' ')[0]}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function StatTile({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: number;
  sub?: string;
  tone?: 'red' | 'amber' | 'green';
}) {
  const valueColor =
    tone === 'red'
      ? 'text-status-red'
      : tone === 'amber'
        ? 'text-status-amber'
        : tone === 'green'
          ? 'text-status-green'
          : 'text-ink';
  return (
    <div className="rounded-md border border-line bg-surface-elev px-2.5 py-1.5">
      <div className="text-[10px] uppercase tracking-wide text-ink-3">{label}</div>
      <div className={`mt-0.5 text-lg font-semibold tabular-nums ${valueColor}`}>
        {value}
      </div>
      {sub && <div className="text-[9px] text-ink-4">{sub}</div>}
    </div>
  );
}
