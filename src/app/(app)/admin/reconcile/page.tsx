import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSession } from '@/server/session';
import { hasAnyRole } from '@/server/roles';
import { computeReconcileQueue, summariseGaps } from '@/server/reconcile/gap-finder';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

/**
 * Reconcile assistant — super-admin-only back-end-population workspace.
 *
 * Two panes:
 *   - Left: deterministic "open questions" queue from the gap finder.
 *     Re-computed on every load so stale gaps disappear as you fix
 *     them. Sorted highest-impact first.
 *   - Right: chat with the reconcile agent (Phase 2 — Claude with
 *     tool use). Drop zone for CSV / PDF / Word uploads.
 *
 * Why a separate assistant: the general in-app helper at /assistant is
 * scoped to "help me do my own work" and writes nothing destructive.
 * The reconcile assistant is scoped to "fix the data the firm depends
 * on", with bulk updates + CSV imports + doc extraction tools that
 * only TT-level access should be able to call.
 */
export default async function ReconcilePage() {
  const session = await getSession();
  if (!hasAnyRole(session, ['super_admin'])) notFound();

  const gaps = await computeReconcileQueue();
  const summary = summariseGaps(gaps);

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink">Reconcile</h1>
          <p className="text-sm text-ink-3">
            Super-admin workspace for getting the back end populated. Open questions,
            blanket updates, and file drops — all in one place.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-ink-3">
          <Badge variant="outline">
            {summary.total} open
          </Badge>
          {summary.byImpact[3] > 0 && (
            <Badge variant="red">{summary.byImpact[3]} blocking</Badge>
          )}
          {summary.byImpact[2] > 0 && (
            <Badge variant="amber">{summary.byImpact[2]} stale</Badge>
          )}
          {summary.byImpact[1] > 0 && (
            <Badge variant="outline">{summary.byImpact[1]} nice-to-have</Badge>
          )}
        </div>
      </header>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {/* ── Left: open questions queue ─────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Open questions</CardTitle>
            <p className="text-xs text-ink-3">
              Deterministic gap rules over the schema. Click into the page to fix,
              or answer in the chat to the right.
            </p>
          </CardHeader>
          <CardContent className="space-y-2 p-0">
            {gaps.length === 0 ? (
              <div className="p-8 text-center text-sm text-ink-3">
                Nothing to reconcile — the back end is clean. Refresh after data
                imports to surface new gaps.
              </div>
            ) : (
              <ul className="divide-y divide-line">
                {gaps.map((g) => (
                  <li
                    key={g.key}
                    className="flex items-start justify-between gap-3 px-4 py-2.5 hover:bg-surface-hover"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <Badge
                          variant={
                            g.impact === 3
                              ? 'red'
                              : g.impact === 2
                                ? 'amber'
                                : 'outline'
                          }
                          className="shrink-0 text-[10px] uppercase"
                        >
                          {g.category}
                        </Badge>
                        <span className="truncate text-sm text-ink">{g.title}</span>
                      </div>
                      {g.detail && (
                        <p className="mt-0.5 text-xs text-ink-3">{g.detail}</p>
                      )}
                    </div>
                    {g.href && (
                      <Link
                        href={g.href}
                        className="shrink-0 self-center rounded-md border border-line px-2 py-1 text-xs text-ink-2 hover:bg-surface-elev hover:text-ink"
                      >
                        Fix →
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* ── Right: chat + drop zone (Phase 2 — Claude agent loop) ──── */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Reconcile chat</CardTitle>
            <p className="text-xs text-ink-3">
              Conversational interface to bulk update projects, import CSVs, and
              extract project briefs. Claude routes to typed tools — every
              destructive call shows a confirm step before applying.
            </p>
          </CardHeader>
          <CardContent>
            <div className="flex h-[480px] flex-col items-center justify-center rounded-md border border-dashed border-line bg-surface-subtle/40 text-center">
              <p className="text-sm text-ink-2">Chat + drop zone coming next.</p>
              <p className="mt-2 max-w-sm text-xs text-ink-3">
                The agent loop, bulk update tools, CSV importers, and PDF/Word
                extraction land in follow-up commits. The gap queue at left is
                already live — start chipping through it in the existing UI.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
