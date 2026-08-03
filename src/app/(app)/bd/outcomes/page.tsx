import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSession } from '@/server/session';
import { hasAnyRole } from '@/server/roles';
import { prisma } from '@/server/db';
import { auFyOf, auFyLabel, currentAuFyLabel } from '@/lib/au-fy';
import { readCommercialsVisible } from '@/server/commercials-visible';
import { CommercialsToggle } from '@/components/commercials-toggle';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { OutcomeInlineEdit } from './inline-edit';

/**
 * BD outcomes review — lost-deal post-mortems + won-deal pattern
 * recognition, grouped by AU fiscal year. Cross-references Project
 * data on the won side so each FY shows actual revenue won + engagement-
 * type breakdown alongside the lost cohort.
 *
 * Editable inline: reason / notes and "so what / lessons learned"
 * per row so partners can append insights during BD post-mortems
 * without bouncing through the detail page.
 *
 * Gated on partner+ via the layout; commercial-values toggle hides
 * $ amounts when off so the page is safe to share-screen in team
 * discussions.
 */
function formatMoney(cents: number): string {
  if (cents === 0) return '—';
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

export default async function BdOutcomesPage() {
  const session = await getSession();
  if (!hasAnyRole(session, ['super_admin', 'admin', 'partner', 'associate_partner', 'manager'])) notFound();

  const commercialsVisible = await readCommercialsVisible();

  // Pull lost deals + won projects in parallel. Won "deals" are
  // effectively projects — when a deal converts, it lives on as the
  // Project. So the won-side analysis is a Project query.
  const [lostDeals, wonProjects] = await Promise.all([
    prisma.deal.findMany({
      where: { stage: 'lost' },
      include: {
        client: { select: { id: true, code: true, legalName: true } },
        owner: { select: { id: true, initials: true, firstName: true, lastName: true } },
      },
      orderBy: [{ archivedAt: 'desc' }],
    }),
    prisma.project.findMany({
      where: {
        // All projects (excluding the FH overhead buckets) — every
        // project represents a won engagement.
        code: { notIn: ['FHB000', 'FHO000', 'FHX000'] },
      },
      select: {
        id: true,
        code: true,
        name: true,
        description: true,
        contractValue: true,
        startDate: true,
        stage: true,
        client: { select: { code: true, legalName: true } },
      },
      orderBy: [{ startDate: 'desc' }],
    }),
  ]);

  const currentFy = auFyOf(new Date());
  const FIRST_FY = 2021;

  // Bucket both lost + won by FY (use startDate for projects, archivedAt
  // or firstConversationAt for deals).
  type Bucket = {
    lost: typeof lostDeals;
    won: typeof wonProjects;
  };
  const buckets = new Map<number | 'no-date', Bucket>();
  for (let fy = FIRST_FY; fy <= currentFy; fy++) {
    buckets.set(fy, { lost: [], won: [] });
  }
  buckets.set('no-date', { lost: [], won: [] });
  for (const d of lostDeals) {
    const ref = d.firstConversationAt ?? d.archivedAt;
    const fy = ref ? auFyOf(ref) : 'no-date';
    const bucket = buckets.get(fy) ?? buckets.get('no-date')!;
    bucket.lost.push(d);
  }
  for (const p of wonProjects) {
    const fy = p.startDate ? auFyOf(p.startDate) : currentFy;
    const bucket = buckets.get(fy);
    if (bucket) bucket.won.push(p);
  }

  // Top-line tiles (current FY only).
  const cur = buckets.get(currentFy)!;
  const totalLostCur = cur.lost.length;
  const totalWonCur = cur.won.length;
  const totalValueWonCur = cur.won.reduce((s, p) => s + p.contractValue, 0);
  const winRateCur =
    totalLostCur + totalWonCur === 0
      ? null
      : Math.round((totalWonCur / (totalLostCur + totalWonCur)) * 100);

  // Engagement-type breakdown across all-time lost deals
  const lostByType = new Map<string, number>();
  for (const d of lostDeals) {
    const t = (d.engagementType ?? 'Other').trim() || 'Other';
    lostByType.set(t, (lostByType.get(t) ?? 0) + 1);
  }
  const lostTypeRanked = [...lostByType.entries()].sort((a, b) => b[1] - a[1]);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink">BD outcomes</h1>
          <p className="text-sm text-ink-3">
            Won + lost engagements by fiscal year — post-mortems on losses,
            pattern recognition on wins. Edit reason and lessons learned
            inline so the analysis stays with the deal.
          </p>
        </div>
        <CommercialsToggle visible={commercialsVisible} path="/bd/outcomes" />
      </header>

      {/* Top-line summary tiles for the current FY */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label={`${currentAuFyLabel()} won`} value={String(totalWonCur)} sub="engagements" />
        <StatTile
          label={`${currentAuFyLabel()} won value`}
          value={commercialsVisible ? formatMoney(totalValueWonCur) : '—'}
          sub="contract ex GST"
        />
        <StatTile label={`${currentAuFyLabel()} lost`} value={String(totalLostCur)} sub="opportunities" />
        <StatTile
          label="Win rate"
          value={winRateCur === null ? '—' : `${winRateCur}%`}
          sub="this FY"
          tone={winRateCur !== null && winRateCur >= 60 ? 'green' : winRateCur !== null && winRateCur < 40 ? 'red' : undefined}
        />
      </div>

      {/* All-time lost-deal engagement-type breakdown */}
      {lostTypeRanked.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">
              Lost deals by engagement type
              <span className="ml-2 text-xs tabular-nums text-ink-3">all FYs</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1.5">
              {lostTypeRanked.map(([type, n]) => {
                const max = lostTypeRanked[0]?.[1] ?? 1;
                const pct = Math.round((n / max) * 100);
                return (
                  <div key={type} className="flex items-center gap-2 text-xs">
                    <span className="w-44 shrink-0 text-ink-2">{type}</span>
                    <div className="relative h-3 flex-1 overflow-hidden rounded-full bg-surface-subtle">
                      <div
                        className="h-full bg-status-amber"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="w-8 shrink-0 text-right tabular-nums text-ink-3">{n}</span>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Per-FY collapsible sections, newest first */}
      <section className="space-y-3">
        <header>
          <h2 className="text-sm font-semibold text-ink">Outcomes by fiscal year</h2>
          <p className="text-[11px] text-ink-3">
            Current FY expanded; older years collapse. Click any deal/project
            to open its detail page.
          </p>
        </header>
        {([...buckets.keys()] as Array<number | 'no-date'>)
          .sort((a, b) => {
            if (a === 'no-date') return 1;
            if (b === 'no-date') return -1;
            return (b as number) - (a as number);
          })
          .map((fy) => {
            const b = buckets.get(fy)!;
            if (b.lost.length === 0 && b.won.length === 0 && fy !== currentFy) return null;
            const label = fy === 'no-date' ? 'No date recorded' : auFyLabel(fy as number);
            const isCurrent = fy === currentFy;
            const totalValue = b.won.reduce((s, p) => s + p.contractValue, 0);
            return (
              <details
                key={String(fy)}
                open={isCurrent}
                className="rounded-lg border border-line bg-card"
              >
                <summary className="flex cursor-pointer flex-wrap items-baseline justify-between gap-2 px-4 py-3 text-sm">
                  <span className="font-semibold text-ink">
                    {label}
                    {isCurrent && (
                      <span className="ml-2 text-[10px] uppercase tracking-wide text-ink-3">
                        current
                      </span>
                    )}
                  </span>
                  <span className="text-[11px] text-ink-3">
                    {b.won.length} won
                    {commercialsVisible && totalValue > 0 ? (
                      <>
                        {' '}({formatMoney(totalValue)})
                      </>
                    ) : null}
                    {' · '}
                    {b.lost.length} lost
                  </span>
                </summary>
                <div className="space-y-3 border-t border-line p-4">
                  {b.won.length > 0 && (
                    <div>
                      <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-status-green">
                        Won · {b.won.length}
                      </div>
                      <div className="space-y-1.5">
                        {b.won.map((p) => (
                          <div
                            key={p.id}
                            className="rounded-md border border-line bg-surface-elev px-3 py-1.5"
                          >
                            <div className="flex flex-wrap items-baseline justify-between gap-2">
                              <div className="min-w-0 flex-1">
                                <Link
                                  href={`/projects/${p.code}`}
                                  className="font-mono text-xs text-ink hover:underline"
                                >
                                  {p.code}
                                </Link>
                                <span className="ml-2 text-sm text-ink">{p.name}</span>
                                {p.client && (
                                  <span className="ml-2 text-[11px] text-ink-3">
                                    · {p.client.legalName}
                                  </span>
                                )}
                              </div>
                              {commercialsVisible && (
                                <span className="shrink-0 tabular-nums text-xs text-ink-2">
                                  {formatMoney(p.contractValue)}
                                </span>
                              )}
                              <Badge variant="outline" className="text-[10px] capitalize">
                                {p.stage}
                              </Badge>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {b.lost.length > 0 && (
                    <div>
                      <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-status-red">
                        Lost · {b.lost.length}
                      </div>
                      <div className="space-y-2">
                        {b.lost.map((d) => (
                          <div
                            key={d.id}
                            className="rounded-md border border-line bg-surface-elev px-3 py-2"
                          >
                            <div className="flex flex-wrap items-baseline justify-between gap-2">
                              <div className="min-w-0 flex-1">
                                <Link
                                  href={`/bd/${d.id}`}
                                  className="font-mono text-xs text-ink-3 hover:underline"
                                >
                                  {d.code}
                                </Link>
                                <span className="ml-2 text-sm font-medium text-ink">
                                  {d.name || '(untitled)'}
                                </span>
                                <span className="ml-2 text-[11px] text-ink-3">
                                  ·{' '}
                                  {d.client
                                    ? d.client.legalName
                                    : d.prospectiveName ?? 'Prospective'}
                                </span>
                                {d.engagementType && (
                                  <Badge variant="outline" className="ml-2 text-[10px]">
                                    {d.engagementType}
                                  </Badge>
                                )}
                              </div>
                              <span className="shrink-0 text-[10px] text-ink-4">
                                {d.archivedAt
                                  ? d.archivedAt.toLocaleDateString('en-AU', {
                                      day: 'numeric',
                                      month: 'short',
                                      year: 'numeric',
                                    })
                                  : '—'}
                              </span>
                            </div>
                            <OutcomeInlineEdit
                              id={d.id}
                              initialNotes={d.notes ?? ''}
                              initialLessons={d.lessonsLearned ?? ''}
                              commercialsVisible={commercialsVisible}
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {b.won.length === 0 && b.lost.length === 0 && (
                    <p className="text-center text-xs text-ink-3">
                      No deals recorded for this fiscal year yet.
                    </p>
                  )}
                </div>
              </details>
            );
          })}
      </section>
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
  value: string;
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
    <Card>
      <CardContent className="p-4">
        <div className="text-[11px] uppercase tracking-wide text-ink-3">{label}</div>
        <div className={`mt-1 text-xl font-semibold tabular-nums ${valueColor}`}>{value}</div>
        {sub && <div className="text-[10px] text-ink-4">{sub}</div>}
      </CardContent>
    </Card>
  );
}
