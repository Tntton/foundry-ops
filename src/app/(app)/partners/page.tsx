import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSession } from '@/server/session';
import { hasCapability } from '@/server/capabilities';
import {
  computePartnerScoreboard,
  type PartnerScoreRow,
} from '@/server/reports/partner-scorecard';
import { PersonAvatar } from '@/components/person-avatar';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

function formatMoney(cents: number): string {
  if (cents === 0) return '—';
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

export default async function PartnerScorecardPage() {
  const session = await getSession();
  // Gated on capability (not raw role) so Associate Partners — who
  // share most of partner's surface — are correctly EXCLUDED here.
  // The capability map keeps the canonical access list.
  if (!hasCapability(session, 'partner.scorecard.view')) notFound();

  const data = await computePartnerScoreboard();

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-ink">Partner scorecard</h1>
        <p className="text-sm text-ink-3">
          Project value attributed by contribution role: BD-won (sourced /
          closed the deal), Led (project owner), Directly supported
          (active delivery), Partially supported (advisory). Splits are
          hard-coded per project on the project page; primary partner
          counts at 100% Led by default. Lifetime invoiced + margin still
          roll up by client leadership.
        </p>
      </header>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <TotalCard
          label="Active partners"
          value={String(data.totals.activePartners)}
          sub={`${data.fullPartners.length} full · ${data.associatePartners.length} AP`}
        />
        <TotalCard
          label="Invoiced"
          value={formatMoney(data.totals.invoicedCents)}
          sub="Lifetime ex GST"
        />
        <TotalCard
          label="Margin"
          value={formatMoney(data.totals.marginCents)}
          sub="across partner books"
          emphasis={data.totals.marginCents < 0}
        />
        <TotalCard
          label="Pipeline (wt.)"
          value={formatMoney(data.totals.weightedPipelineCents)}
          sub="expected × prob"
        />
        <TotalCard
          label="Contribution value"
          value={formatMoney(data.totals.contributionValueCents)}
          sub="active projects × %"
        />
      </div>

      <ScoreboardSection
        title="Partners"
        sub="The three full partners — Trung Ton, Michael Bonning, Christopher Parker."
        rows={data.fullPartners}
        emptyHint="Run scripts/set-partner-designations.ts to flag the three full partners."
      />

      <ScoreboardSection
        title="Associate partners"
        sub="Hold the partner role but not full partners. Contribution attribution still applies."
        rows={data.associatePartners}
        emptyHint="No associate partners yet."
      />

      <p className="text-xs text-ink-3">
        Lifetime invoiced + margin attribution is by client leadership
        (Client.primaryPartnerId). Deals + approvals are by the deciding
        partner directly. Contribution value is each partner&apos;s % share
        of the contract value of every active project they&apos;re tagged on,
        across the four roles.
      </p>
    </div>
  );
}

function ScoreboardSection({
  title,
  sub,
  rows,
  emptyHint,
}: {
  title: string;
  sub: string;
  rows: PartnerScoreRow[];
  emptyHint: string;
}) {
  return (
    <Card className="p-0">
      <CardHeader className="flex flex-row items-end justify-between gap-2">
        <div>
          <CardTitle>
            {title} ({rows.length})
          </CardTitle>
          <p className="text-[11px] text-ink-3">{sub}</p>
        </div>
      </CardHeader>
      {rows.length === 0 ? (
        <CardContent>
          <p className="text-sm text-ink-3">{emptyHint}</p>
        </CardContent>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-subtle text-[10px] uppercase tracking-wide text-ink-3">
              <tr className="border-b border-line">
                <th className="px-4 py-2 text-left">Partner</th>
                <th className="px-3 py-2 text-right" title="Won (BD source / closer)">
                  BD won
                </th>
                <th className="px-3 py-2 text-right" title="Led / owning partner">
                  Led
                </th>
                <th className="px-3 py-2 text-right" title="Directly supported (active delivery)">
                  Direct
                </th>
                <th className="px-3 py-2 text-right" title="Partially supported (advisory / occasional)">
                  Partial
                </th>
                <th className="px-3 py-2 text-right">Invoiced</th>
                <th className="px-3 py-2 text-right">Margin</th>
                <th className="px-3 py-2 text-right">Pipeline</th>
                <th className="px-3 py-2 text-right">Won YTD</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.personId}
                  className="border-b border-line last:border-b-0"
                >
                  <td className="px-4 py-2">
                    <Link
                      href={`/directory/people/${r.personId}`}
                      className="flex items-center gap-2 hover:underline"
                    >
                      <PersonAvatar
                        className="h-7 w-7"
                        fallbackClassName="text-[10px]"
                        initials={r.initials}
                        headshotUrl={r.headshotUrl}
                      />
                      <div>
                        <div className="text-ink">
                          {r.firstName} {r.lastName}
                        </div>
                        <div className="text-[10px] text-ink-3">
                          {r.band} · {r.clientsLed} client
                          {r.clientsLed === 1 ? '' : 's'} ·{' '}
                          {r.activeProjects} / {r.totalProjects} projects
                        </div>
                      </div>
                      {!r.active && (
                        <Badge variant="outline" className="text-[10px]">
                          Ended
                        </Badge>
                      )}
                    </Link>
                  </td>
                  <ContributionCell
                    valueCents={r.contributions.bdWonValueCents}
                    count={r.contributions.bdWonCount}
                  />
                  <ContributionCell
                    valueCents={r.contributions.ledValueCents}
                    count={r.contributions.ledCount}
                  />
                  <ContributionCell
                    valueCents={r.contributions.directlySupportedValueCents}
                    count={r.contributions.directlySupportedCount}
                  />
                  <ContributionCell
                    valueCents={r.contributions.partiallySupportedValueCents}
                    count={r.contributions.partiallySupportedCount}
                  />
                  <td className="px-3 py-2 text-right tabular-nums text-ink">
                    {formatMoney(r.invoicedCents)}
                    {r.wipCents > 0 && (
                      <div className="text-[10px] text-ink-3">
                        + {formatMoney(r.wipCents)} WIP
                      </div>
                    )}
                  </td>
                  <td
                    className={`px-3 py-2 text-right tabular-nums ${
                      r.marginCents < 0 ? 'text-status-red' : 'text-ink'
                    }`}
                  >
                    {formatMoney(r.marginCents)}
                    {r.marginPct !== null && (
                      <div className="text-[10px] text-ink-3">
                        {r.marginPct.toFixed(0)}%
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-xs text-ink-2">
                    {formatMoney(r.weightedPipelineCents)}
                    <div className="text-[10px] text-ink-3">
                      {r.openDeals} open
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-xs text-ink-2">
                    {formatMoney(r.wonDealsYtdCents)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function ContributionCell({
  valueCents,
  count,
}: {
  valueCents: number;
  count: number;
}) {
  return (
    <td className="px-3 py-2 text-right tabular-nums text-ink">
      {valueCents > 0 ? formatMoney(valueCents) : <span className="text-ink-4">—</span>}
      {count > 0 && (
        <div className="text-[10px] text-ink-3">
          {count} project{count === 1 ? '' : 's'}
        </div>
      )}
    </td>
  );
}

function TotalCard({
  label,
  value,
  sub,
  emphasis,
}: {
  label: string;
  value: string;
  sub?: string;
  emphasis?: boolean;
}) {
  return (
    <Card>
      <CardHeader className="pb-1">
        <CardTitle className="text-xs font-medium uppercase tracking-wide text-ink-3">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div
          className={`text-lg font-semibold tabular-nums ${
            emphasis ? 'text-status-red' : 'text-ink'
          }`}
        >
          {value}
        </div>
        {sub && <div className="text-[11px] text-ink-3">{sub}</div>}
      </CardContent>
    </Card>
  );
}
