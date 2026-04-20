import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getSession } from '@/server/session';
import { hasCapability } from '@/server/capabilities';
import { listRateCardAsOf } from '@/server/rate-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

const ROLE_LABELS: Record<string, { label: string; band: string }> = {
  L2: { label: 'Project Director / Sr Manager', band: 'Leadership' },
  L1: { label: 'Project Manager / Manager', band: 'Leadership' },
  E2: { label: 'Senior Expert', band: 'Expert' },
  E1: { label: 'Expert', band: 'Expert' },
  F2: { label: 'Fellow', band: 'Fellow' },
  F1: { label: 'Junior Fellow', band: 'Fellow' },
  T3: { label: 'Senior Consultant', band: 'Consultant' },
  T2: { label: 'Consultant', band: 'Consultant' },
  T1: { label: 'Consultant (junior)', band: 'Consultant' },
  A3: { label: 'Senior Analyst', band: 'Analyst' },
  A2: { label: 'Analyst', band: 'Analyst' },
  A1: { label: 'Junior Analyst', band: 'Analyst' },
  IO: { label: 'Intern', band: 'Intern' },
};

function formatMoneyCents(cents: number): string {
  if (cents === 0) return '—';
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function parseAsOf(raw: string | undefined): Date {
  if (!raw) return new Date();
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

export default async function RateCardPage({
  searchParams,
}: {
  searchParams: { as_of?: string };
}) {
  const session = await getSession();
  if (!hasCapability(session, 'ratecard.view')) notFound();

  const canEdit = hasCapability(session, 'ratecard.edit');
  const asOf = parseAsOf(searchParams.as_of);
  const rows = await listRateCardAsOf(asOf);

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold text-ink">Rate card</h1>
          <p className="text-sm text-ink-3">
            AUD cost rates per role. Edits version each row — history is never mutated.
          </p>
        </div>
        {canEdit && (
          <Button asChild>
            <Link href="/admin/rate-card/new">+ New version</Link>
          </Button>
        )}
      </header>

      <form
        action="/admin/rate-card"
        method="get"
        className="flex items-center gap-3 rounded-lg border border-line bg-card p-3"
      >
        <label className="flex items-center gap-2 text-sm text-ink-2">
          <span className="text-ink-3">Active as of</span>
          <Input
            type="date"
            name="as_of"
            defaultValue={asOf.toISOString().slice(0, 10)}
            className="max-w-[180px]"
          />
        </label>
        <Button type="submit" variant="outline" size="sm">
          Apply
        </Button>
        <Button type="button" asChild variant="ghost" size="sm">
          <Link href="/admin/rate-card">Today</Link>
        </Button>
        <span className="ml-auto text-xs text-ink-3">
          Showing most-recent effective row per role, as of{' '}
          <span className="font-mono text-ink-2">{asOf.toISOString().slice(0, 10)}</span>
        </span>
      </form>

      <Card className="p-0">
        {rows.length === 0 ? (
          <div className="p-12 text-center text-sm text-ink-3">
            No rate card rows before {asOf.toISOString().slice(0, 10)}. Run the seed
            (`pnpm db:seed`) or pick a later date.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Band</TableHead>
                <TableHead>Effective from</TableHead>
                <TableHead className="text-right">Cost / hr</TableHead>
                <TableHead className="text-right">Bill rate (low)</TableHead>
                <TableHead className="text-right">Bill rate (high)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const meta = ROLE_LABELS[r.roleCode];
                return (
                  <TableRow key={r.id}>
                    <TableCell>
                      <Badge variant="outline" className="font-mono">
                        {r.roleCode}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-medium text-ink">
                      {meta?.label ?? r.roleCode}
                    </TableCell>
                    <TableCell className="text-ink-2">{meta?.band ?? '—'}</TableCell>
                    <TableCell className="text-ink-2 tabular-nums">
                      {r.effectiveFrom.toISOString().slice(0, 10)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoneyCents(r.costRate)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-ink-3">
                      {formatMoneyCents(r.billRateLow)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-ink-3">
                      {formatMoneyCents(r.billRateHigh)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Card>

      <p className="text-xs text-ink-3">
        Bill rate low/high are MVP heuristics (cost × 2 / × 3). Replace with real bill
        bands once Foundry&apos;s pricing matrix is ingested.
      </p>
    </div>
  );
}
