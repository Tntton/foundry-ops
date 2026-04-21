import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSession } from '@/server/session';
import { hasAnyRole } from '@/server/roles';
import { computePartnerScoreboard } from '@/server/reports/partner-scorecard';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

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
  if (!hasAnyRole(session, ['super_admin', 'admin', 'partner'])) notFound();

  const data = await computePartnerScoreboard();

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-ink">Partner scorecard</h1>
        <p className="text-sm text-ink-3">
          One row per partner / MP. Invoiced + margin roll up from clients
          they lead; pipeline + wins from deals they own; decisions from
          approvals they decided in the last 30 days.
        </p>
      </header>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <TotalCard
          label="Active partners"
          value={String(data.totals.activePartners)}
          sub={`${data.rows.length} in ranking`}
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
          label="Won YTD"
          value={formatMoney(data.totals.wonDealsYtdCents)}
          sub="expected value"
        />
      </div>

      <Card className="p-0">
        {data.rows.length === 0 ? (
          <div className="p-12 text-center text-sm text-ink-3">
            No partners or super-admins on the books. Assign the partner role to a Person
            to appear here.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Partner</TableHead>
                <TableHead className="text-right">Clients</TableHead>
                <TableHead className="text-right">Projects</TableHead>
                <TableHead className="text-right">Invoiced</TableHead>
                <TableHead className="text-right">WIP</TableHead>
                <TableHead className="text-right">Margin</TableHead>
                <TableHead className="text-right">Pipeline</TableHead>
                <TableHead className="text-right">Won YTD</TableHead>
                <TableHead className="text-right">Decisions 30d</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.rows.map((r) => (
                <TableRow key={r.personId}>
                  <TableCell>
                    <Link
                      href={`/directory/people/${r.personId}`}
                      className="flex items-center gap-2 hover:underline"
                    >
                      <Avatar className="h-6 w-6">
                        <AvatarFallback className="text-[10px]">
                          {r.initials}
                        </AvatarFallback>
                      </Avatar>
                      <span className="text-ink">
                        {r.firstName} {r.lastName}
                      </span>
                      {!r.active && (
                        <Badge variant="outline" className="text-[10px]">
                          Ended
                        </Badge>
                      )}
                    </Link>
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-ink-2">
                    {r.clientsLed}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-xs text-ink-3">
                    {r.activeProjects} / {r.totalProjects}
                  </TableCell>
                  <TableCell className="text-right font-semibold tabular-nums text-ink">
                    {formatMoney(r.invoicedCents)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-ink-3">
                    {formatMoney(r.wipCents)}
                  </TableCell>
                  <TableCell
                    className={`text-right tabular-nums font-medium ${
                      r.marginCents < 0 ? 'text-status-red' : 'text-ink'
                    }`}
                  >
                    {formatMoney(r.marginCents)}
                    {r.marginPct !== null && (
                      <span className="ml-1 text-[10px] text-ink-3">
                        ({r.marginPct.toFixed(0)}%)
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-xs text-ink-2">
                    {formatMoney(r.weightedPipelineCents)}
                    <div className="text-[10px] text-ink-3">
                      {r.openDeals} open
                    </div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-xs text-ink-2">
                    {formatMoney(r.wonDealsYtdCents)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-xs text-ink-3">
                    {r.decisionsMadeLast30}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <p className="text-xs text-ink-3">
        Invoiced + margin attribution is by client leadership (Client.primaryPartnerId).
        Deals + approvals are by the deciding partner directly. Contractor partners are
        included when the partner role is set on them.
      </p>
    </div>
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
