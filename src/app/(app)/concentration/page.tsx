import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSession } from '@/server/session';
import { hasAnyRole } from '@/server/roles';
import { computeClientConcentration } from '@/server/reports/client-concentration';
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

function hhiBand(hhi: number | null): { label: string; variant: 'green' | 'amber' | 'red' | 'outline' } {
  if (hhi === null) return { label: 'Insufficient data', variant: 'outline' };
  if (hhi < 1500) return { label: 'Diversified', variant: 'green' };
  if (hhi < 2500) return { label: 'Moderate concentration', variant: 'amber' };
  return { label: 'High concentration', variant: 'red' };
}

export default async function ClientConcentrationPage() {
  const session = await getSession();
  if (!hasAnyRole(session, ['super_admin', 'admin', 'partner'])) notFound();

  const data = await computeClientConcentration();
  const withRev = data.rows.filter((r) => r.invoicedCents > 0);
  const band = hhiBand(data.hhi);
  const maxShare = withRev[0]?.sharePct ?? 0;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-ink">Client concentration</h1>
        <p className="text-sm text-ink-3">
          Revenue share by client (lifetime invoiced, ex GST). HHI = sum of
          squared market-share percentages — &lt;1500 diversified, 1500-2500
          moderate, &gt;2500 high concentration.
        </p>
      </header>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <TotalCard
          label="Firm invoiced"
          value={formatMoney(data.firmInvoicedCents)}
          sub={`${formatMoney(data.firmWipCents)} WIP`}
        />
        <TotalCard
          label="Top 1"
          value={data.top1Pct === null ? '—' : `${data.top1Pct}%`}
          sub={withRev[0]?.clientLegalName ?? 'no data'}
          emphasis={(data.top1Pct ?? 0) > 40}
        />
        <TotalCard
          label="Top 3"
          value={data.top3Pct === null ? '—' : `${data.top3Pct}%`}
          sub={`of firm invoiced`}
          emphasis={(data.top3Pct ?? 0) > 70}
        />
        <TotalCard
          label="Top 5"
          value={data.top5Pct === null ? '—' : `${data.top5Pct}%`}
          sub={`${withRev.length} active clients`}
        />
        <TotalCard
          label="HHI"
          value={data.hhi === null ? '—' : String(data.hhi)}
          sub={band.label}
          tone={band.variant}
        />
      </div>

      {(data.top1Pct ?? 0) > 40 && (
        <div className="rounded-md border border-status-amber bg-status-amber-soft px-3 py-2 text-sm text-status-amber">
          Top client is &gt;40% of firm revenue — single-point concentration risk. Consider
          deliberate diversification in BD pipeline focus.
        </div>
      )}

      <Card className="p-0">
        {withRev.length === 0 ? (
          <div className="p-12 text-center text-sm text-ink-3">
            No invoiced revenue yet. As soon as approved/sent invoices land, clients will
            rank here.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>#</TableHead>
                <TableHead>Client</TableHead>
                <TableHead>Projects</TableHead>
                <TableHead className="text-right">Invoiced</TableHead>
                <TableHead className="text-right">WIP</TableHead>
                <TableHead>Share</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {withRev.map((r, i) => (
                <TableRow key={r.clientId}>
                  <TableCell className="text-xs text-ink-3 tabular-nums">
                    {i + 1}
                  </TableCell>
                  <TableCell>
                    <Link
                      href={`/directory/clients/${r.clientId}`}
                      className="flex items-center gap-2 hover:underline"
                    >
                      <Badge variant="outline" className="font-mono">
                        {r.clientCode}
                      </Badge>
                      <span className="text-ink">{r.clientLegalName}</span>
                    </Link>
                  </TableCell>
                  <TableCell className="text-xs text-ink-3 tabular-nums">
                    {r.activeProjects} active / {r.totalProjects} total
                  </TableCell>
                  <TableCell className="text-right font-semibold tabular-nums text-ink">
                    {formatMoney(r.invoicedCents)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-ink-3">
                    {formatMoney(r.wipCents)}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <div className="relative h-2 w-40 overflow-hidden rounded bg-surface-subtle">
                        <div
                          className={`absolute left-0 top-0 h-full ${
                            r.sharePct > 40
                              ? 'bg-status-red'
                              : r.sharePct > 20
                                ? 'bg-status-amber'
                                : 'bg-brand'
                          }`}
                          style={{
                            width: `${Math.min(100, (r.sharePct / Math.max(1, maxShare)) * 100)}%`,
                          }}
                        />
                      </div>
                      <span className="text-xs tabular-nums text-ink-2">
                        {r.sharePct.toFixed(1)}%
                      </span>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <p className="text-xs text-ink-3">
        Clients with zero invoiced revenue (prospects / deal-only) are omitted from the
        share table but still count toward the active-client footer in Top 5.
      </p>
    </div>
  );
}

function TotalCard({
  label,
  value,
  sub,
  emphasis,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  emphasis?: boolean;
  tone?: 'green' | 'amber' | 'red' | 'outline';
}) {
  const cls =
    tone === 'red' || (emphasis && !tone)
      ? 'text-status-red'
      : tone === 'amber'
        ? 'text-status-amber'
        : tone === 'green'
          ? 'text-status-green'
          : 'text-ink';
  return (
    <Card>
      <CardHeader className="pb-1">
        <CardTitle className="text-xs font-medium uppercase tracking-wide text-ink-3">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className={`text-lg font-semibold tabular-nums ${cls}`}>{value}</div>
        {sub && <div className="text-[11px] text-ink-3">{sub}</div>}
      </CardContent>
    </Card>
  );
}
