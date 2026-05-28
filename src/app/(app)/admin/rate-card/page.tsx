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
import { EditableRateCardTable } from './editable-table';

const ROLE_LABELS: Record<string, { label: string; band: string; subnote?: string }> = {
  // Leadership tier — historically excluded from the rate card
  // because partners were paid via LT share only. Per the 2026
  // AP role definition, Associate Partners run two rem models
  // side-by-side: time billing (rate × hours) + LT share fees
  // when they lead a project. L3 (AP) and L4 (Partner) + MP
  // entries are surfaced here so admin can set hourly rates for
  // the time-billing path. Leave the rate at $0 when LT share
  // is the only model (e.g. a full Partner who doesn't bill
  // time on client engagements).
  MP: {
    label: 'Managing Partner',
    band: 'Leadership',
    subnote: 'Usually LT share only — rate optional',
  },
  L4: {
    label: 'Partner',
    band: 'Leadership',
    subnote: 'Usually LT share only — rate optional',
  },
  L3: {
    label: 'Associate Partner / Director',
    band: 'Leadership',
    subnote: 'Dual rem — time billing + LT share',
  },
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

  // Browsing the historical view (?as_of=...) drops to the read-only
  // table — back-dated edits are rejected at the server anyway, and
  // the editable form pins to "today or later" via its date min.
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const isHistoricalBrowse = asOf.getTime() < today.getTime();

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold text-ink">Rate card</h1>
          <p className="text-sm text-ink-3">
            AUD cost rates per role. Edits insert versioned rows —
            history is never mutated, so completed projects stay
            costed against the rates they were quoted at. New rows
            take effect for projects created on or after the chosen
            effective date.
          </p>
        </div>
        {canEdit && (
          <Button asChild variant="outline" size="sm">
            <Link href="/admin/rate-card/new">+ Add new role</Link>
          </Button>
        )}
      </header>

      <form
        action="/admin/rate-card"
        method="get"
        className="flex items-center gap-3 rounded-lg border border-line bg-card p-3"
      >
        <label className="flex items-center gap-2 text-sm text-ink-2">
          <span className="text-ink-3">Browse as of</span>
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

      {rows.length === 0 ? (
        <Card className="p-12 text-center">
          <h2 className="text-sm font-medium text-ink">No rate card rows yet</h2>
          <p className="mt-2 text-sm text-ink-3">
            Nothing effective on or before{' '}
            <span className="font-mono text-ink-2">
              {asOf.toISOString().slice(0, 10)}
            </span>
            . Pick a later date, or add the first rate card version.
          </p>
          {canEdit && (
            <Button asChild size="sm" className="mt-3">
              <Link href="/admin/rate-card/new">+ Add new role</Link>
            </Button>
          )}
        </Card>
      ) : isHistoricalBrowse ? (
        // Read-only historical snapshot. Editable view is "today or
        // later" only.
        <Card className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Band</TableHead>
                <TableHead>Effective from</TableHead>
                <TableHead className="text-right">Cost / hr</TableHead>
                <TableHead className="text-right">Bill (low)</TableHead>
                <TableHead className="text-right">Bill (high)</TableHead>
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
                      {meta?.subnote && (
                        <div className="text-[10px] font-normal text-ink-3">
                          {meta.subnote}
                        </div>
                      )}
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
        </Card>
      ) : (
        <EditableRateCardTable
          rows={rows.map((r) => {
            const meta = ROLE_LABELS[r.roleCode];
            return {
              id: r.id,
              roleCode: r.roleCode,
              roleLabel: meta?.label ?? r.roleCode,
              ...(meta?.subnote ? { roleSubnote: meta.subnote } : {}),
              band: meta?.band ?? '—',
              effectiveFromIso: r.effectiveFrom.toISOString().slice(0, 10),
              costRateCents: r.costRate,
              billRateLowCents: r.billRateLow,
              billRateHighCents: r.billRateHigh,
            };
          })}
          defaultEffectiveFromIso={today.toISOString().slice(0, 10)}
          canEdit={canEdit}
        />
      )}

      <p className="text-xs text-ink-3">
        Edits create new versioned rows on the chosen effective date —
        existing Person.rate snapshots aren&apos;t auto-updated, so
        re-edit individual people on /directory/people if you want
        their cost rate to flip immediately. Bill rate low/high are
        MVP heuristics (cost × 2 / × 3) until Foundry&apos;s pricing
        matrix is ingested.
      </p>
    </div>
  );
}
