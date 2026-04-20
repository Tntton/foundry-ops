import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSession } from '@/server/session';
import { hasAnyRole } from '@/server/roles';
import { hasCapability } from '@/server/capabilities';
import { listContractors } from '@/server/contractors';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

function formatMoney(cents: number): string {
  if (cents === 0) return '—';
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

const STAGE_VARIANT: Record<string, 'amber' | 'green' | 'blue' | 'outline'> = {
  kickoff: 'amber',
  delivery: 'green',
  closing: 'blue',
  archived: 'outline',
};

export default async function ContractorsPage() {
  const session = await getSession();
  if (!hasAnyRole(session, ['super_admin', 'admin', 'partner'])) notFound();
  const canCreate = hasCapability(session, 'person.create');

  const rows = await listContractors();
  const activeRows = rows.filter((r) => r.active);
  const totals = rows.reduce(
    (acc, r) => ({
      active: acc.active + (r.active ? 1 : 0),
      hours: acc.hours + r.hoursLogged,
      timesheetCost: acc.timesheetCost + r.timesheetCostCents,
      billsPaid: acc.billsPaid + r.billsPaidCents,
    }),
    { active: 0, hours: 0, timesheetCost: 0, billsPaid: 0 },
  );

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-ink">Directory</h1>
          <p className="text-sm text-ink-3">
            Contractor engagement + spend. Uses current rate for cost; actual cost lands with
            rate-card-as-of-date.
          </p>
        </div>
        {canCreate && (
          <Button asChild>
            <Link href="/directory/people/new?employment=contractor">+ New contractor</Link>
          </Button>
        )}
      </header>

      <Tabs defaultValue="contractors">
        <TabsList>
          <TabsTrigger value="people" asChild>
            <Link href="/directory">People</Link>
          </TabsTrigger>
          <TabsTrigger value="clients" asChild>
            <Link href="/directory/clients">Clients</Link>
          </TabsTrigger>
          <TabsTrigger value="contractors" asChild>
            <Link href="/directory/contractors">Contractors</Link>
          </TabsTrigger>
          <TabsTrigger value="suppliers" asChild>
            <Link href="/directory/suppliers">Suppliers</Link>
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {rows.length > 0 && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <TotalCard
            label="Contractors"
            value={String(activeRows.length)}
            sub={`${rows.length - activeRows.length} ended`}
          />
          <TotalCard label="Hours logged" value={totals.hours.toFixed(1)} sub="approved + billed" />
          <TotalCard
            label="Timesheet cost"
            value={formatMoney(totals.timesheetCost)}
            sub="hrs × current rate"
          />
          <TotalCard label="Bills paid" value={formatMoney(totals.billsPaid)} sub="approved / paid" />
        </div>
      )}

      {rows.length === 0 ? (
        <Card className="p-12 text-center text-sm text-ink-3">
          No contractors on the books yet.{' '}
          {canCreate && (
            <Link
              href="/directory/people/new?employment=contractor"
              className="text-brand hover:underline"
            >
              Add the first one →
            </Link>
          )}
        </Card>
      ) : (
        <div className="space-y-3">
          {rows.map((c) => (
            <Card key={c.id}>
              <CardHeader className="flex flex-row items-start justify-between gap-3">
                <Link href={`/directory/people/${c.id}`} className="flex items-center gap-3">
                  <Avatar>
                    <AvatarFallback>{c.initials}</AvatarFallback>
                  </Avatar>
                  <div>
                    <div className="text-base font-semibold text-ink hover:underline">
                      {c.firstName} {c.lastName}
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 text-xs text-ink-3">
                      <span>{c.level}</span>
                      <span>·</span>
                      <span>{c.region}</span>
                      <span>·</span>
                      <span className="font-mono">{c.email}</span>
                      {!c.active && (
                        <>
                          <span>·</span>
                          <Badge variant="outline">Ended</Badge>
                        </>
                      )}
                      {c.hasXeroContact && (
                        <>
                          <span>·</span>
                          <Badge variant="blue">Xero linked</Badge>
                        </>
                      )}
                    </div>
                  </div>
                </Link>
                <div className="grid grid-cols-3 gap-4 text-right text-xs tabular-nums">
                  <StatBlock label="Hours" value={c.hoursLogged.toFixed(1)} />
                  <StatBlock
                    label="TS cost"
                    value={formatMoney(c.timesheetCostCents)}
                    sub="hrs × rate"
                  />
                  <StatBlock
                    label="Bills paid"
                    value={formatMoney(c.billsPaidCents)}
                    sub={c.billCount ? `${c.billCount} bill${c.billCount === 1 ? '' : 's'}` : undefined}
                  />
                </div>
              </CardHeader>
              {c.projects.length > 0 ? (
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Project</TableHead>
                        <TableHead>Stage</TableHead>
                        <TableHead className="text-right">Hours</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {c.projects.map((p) => (
                        <TableRow key={p.id}>
                          <TableCell>
                            <Link
                              href={`/projects/${p.code}`}
                              className="flex items-center gap-2 hover:underline"
                            >
                              <span className="font-mono text-xs text-ink-3">{p.code}</span>
                              <span className="text-sm text-ink">{p.name}</span>
                            </Link>
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant={STAGE_VARIANT[p.stage] ?? 'outline'}
                              className="capitalize"
                            >
                              {p.stage}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-ink-2">
                            {p.hours > 0 ? p.hours.toFixed(1) : '—'}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              ) : (
                <CardContent className="text-xs text-ink-3">No project activity yet.</CardContent>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function TotalCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card>
      <CardHeader className="pb-1">
        <CardTitle className="text-xs font-medium uppercase tracking-wide text-ink-3">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-lg font-semibold tabular-nums text-ink">{value}</div>
        {sub && <div className="text-[11px] text-ink-3">{sub}</div>}
      </CardContent>
    </Card>
  );
}

function StatBlock({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-ink-3">{label}</div>
      <div className="text-sm font-semibold text-ink">{value}</div>
      {sub && <div className="text-[10px] text-ink-3">{sub}</div>}
    </div>
  );
}
