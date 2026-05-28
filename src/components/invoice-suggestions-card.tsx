import Link from 'next/link';
import type { InvoiceSuggestion } from '@/server/invoice-suggestions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

function formatMoney(cents: number): string {
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

/**
 * Display card for the "Invoices to generate" queue. Renders the
 * suggestions surfaced by `listInvoiceSuggestions` as a compact
 * table with a per-row "Draft invoice" CTA that deep-links into the
 * new-invoice form with the project pre-selected.
 *
 * Shared between `/invoices` (top section) and the super-admin
 * dashboard so both surfaces stay in lockstep.
 *
 * Empty state collapses to a single line — no "no suggestions"
 * empty-state card stays on screen burning real estate.
 */
export function InvoiceSuggestionsCard({
  suggestions,
  canCreate,
  emptyHint,
}: {
  suggestions: InvoiceSuggestion[];
  /** When false, the per-row CTA renders as a disabled link. Lets a
   *  manager (who can see the queue but not draft) still observe
   *  what's pending without an enticing-but-broken button. */
  canCreate: boolean;
  /** Override the empty-state line. Defaults work for the /invoices
   *  page; the dashboard surface uses its own phrasing. */
  emptyHint?: string;
}) {
  if (suggestions.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Invoices to generate</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-ink-3">
          {emptyHint ??
            'Nothing pending — every active project either has invoices in flight or no overdue milestone.'}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle>
          Invoices to generate{' '}
          <span className="ml-1 text-xs font-normal text-ink-3">
            {suggestions.length} pending
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {suggestions.map((s) => (
          <div
            key={s.id}
            className="flex flex-wrap items-center gap-3 rounded-md border border-line bg-surface-subtle/40 px-3 py-2 text-sm"
          >
            <KindBadge kind={s.kind} />
            <Link
              href={`/projects/${s.project.code}`}
              className="font-mono text-xs text-ink-2 hover:text-brand hover:underline"
            >
              {s.project.code}
            </Link>
            <span className="text-ink">{s.project.name}</span>
            <span className="text-xs text-ink-3">· {s.client.legalName}</span>
            <span className="text-xs text-ink-3">{s.reason}</span>
            {s.amountCents !== null && (
              <span className="ml-auto tabular-nums text-ink">
                {formatMoney(s.amountCents)}
              </span>
            )}
            <Button
              asChild={canCreate}
              size="sm"
              variant="outline"
              disabled={!canCreate}
              className={s.amountCents === null ? '' : 'ml-2'}
            >
              {canCreate ? (
                <Link href={`/invoices/new?projectId=${s.project.id}`}>
                  Draft invoice →
                </Link>
              ) : (
                <span>Draft invoice →</span>
              )}
            </Button>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function KindBadge({
  kind,
}: {
  kind: InvoiceSuggestion['kind'];
}) {
  // Variant choices mirror the urgency: overdue = red (must act
  // now), delivered = amber (action expected today/this week),
  // initiation = blue (process reminder, less urgent).
  if (kind === 'milestone_overdue') {
    return <Badge variant="red">overdue</Badge>;
  }
  if (kind === 'milestone_delivered') {
    return <Badge variant="amber">delivered</Badge>;
  }
  return <Badge variant="blue">initiation</Badge>;
}
