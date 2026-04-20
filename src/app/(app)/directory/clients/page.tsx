import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSession } from '@/server/session';
import { hasAnyRole } from '@/server/roles';
import { hasCapability } from '@/server/capabilities';
import { listClients } from '@/server/clients';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
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

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: { q?: string; deleted?: string };
}) {
  const session = await getSession();
  if (!hasAnyRole(session, ['super_admin', 'admin', 'partner'])) notFound();

  const canCreate = hasCapability(session, 'client.create');
  const q = searchParams.q ?? '';
  const deletedFlag = searchParams.deleted === '1';
  const rows = await listClients(q);

  const firmTotals = rows.reduce(
    (acc, c) => ({
      clients: acc.clients + 1,
      activeProjects: acc.activeProjects + c.activeProjects,
      totalProjects: acc.totalProjects + c.totalProjects,
      contractValue: acc.contractValue + c.contractValueCents,
      invoiced: acc.invoiced + c.invoicedCents,
      paid: acc.paid + c.paidCents,
      ar: acc.ar + c.arOutstandingCents,
    }),
    {
      clients: 0,
      activeProjects: 0,
      totalProjects: 0,
      contractValue: 0,
      invoiced: 0,
      paid: 0,
      ar: 0,
    },
  );

  return (
    <div className="space-y-6">
      {deletedFlag && (
        <div className="rounded-md border border-status-green bg-status-green-soft px-3 py-2 text-sm text-status-green">
          Client deleted.
        </div>
      )}
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-ink">Directory</h1>
          <p className="text-sm text-ink-3">People, clients, contractors, suppliers.</p>
        </div>
        {canCreate && (
          <Button asChild>
            <Link href="/directory/clients/new">+ New client</Link>
          </Button>
        )}
      </header>

      <Tabs defaultValue="clients">
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
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <TotalCard
            label="Clients"
            value={String(firmTotals.clients)}
            sub={`${firmTotals.activeProjects} active / ${firmTotals.totalProjects} projects`}
          />
          <TotalCard label="Contract value" value={formatMoney(firmTotals.contractValue)} sub="ex GST, lifetime" />
          <TotalCard label="Invoiced" value={formatMoney(firmTotals.invoiced)} sub="ex GST" />
          <TotalCard label="Paid" value={formatMoney(firmTotals.paid)} sub="received payments" />
          <TotalCard
            label="AR outstanding"
            value={formatMoney(firmTotals.ar)}
            sub="approved / sent / partial"
          />
        </div>
      )}

      <form
        action="/directory/clients"
        method="get"
        className="flex items-center gap-2 rounded-lg border border-line bg-card p-3"
      >
        <Input
          name="q"
          defaultValue={q}
          placeholder="Search by code, legal name, trading name…"
          className="min-w-[240px] max-w-md"
        />
        <Button type="submit" variant="outline" size="sm">
          Apply
        </Button>
        {q && (
          <Button type="button" asChild variant="ghost" size="sm">
            <Link href="/directory/clients">Clear</Link>
          </Button>
        )}
        <span className="ml-auto text-xs text-ink-3">
          {rows.length} {rows.length === 1 ? 'client' : 'clients'}
        </span>
      </form>

      {rows.length === 0 ? (
        <Card className="p-12 text-center text-sm text-ink-3">
          No clients yet.{' '}
          {canCreate ? (
            <Link href="/directory/clients/new" className="text-brand hover:underline">
              Create the first one →
            </Link>
          ) : (
            'Ask an admin to create one.'
          )}
        </Card>
      ) : (
        <div className="space-y-3">
          {rows.map((c) => (
            <Card key={c.id}>
              <CardHeader className="flex flex-row items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <Badge variant="outline" className="font-mono">
                    {c.code}
                  </Badge>
                  <div>
                    <Link
                      href={`/directory/clients/${c.id}`}
                      className="text-base font-semibold text-ink hover:underline"
                    >
                      {c.legalName}
                    </Link>
                    {c.tradingName && (
                      <div className="text-[11px] text-ink-3">t/a {c.tradingName}</div>
                    )}
                    {c.primaryPartner && (
                      <div className="mt-1 flex items-center gap-1.5 text-xs text-ink-3">
                        <Avatar className="h-5 w-5">
                          <AvatarFallback className="text-[9px]">
                            {c.primaryPartner.initials}
                          </AvatarFallback>
                        </Avatar>
                        <span>
                          Partner · {c.primaryPartner.firstName} {c.primaryPartner.lastName}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
                <div className="grid grid-cols-4 gap-4 text-right text-xs tabular-nums">
                  <StatBlock
                    label="Projects"
                    value={`${c.activeProjects}`}
                    sub={`${c.totalProjects} total`}
                  />
                  <StatBlock label="Contract" value={formatMoney(c.contractValueCents)} />
                  <StatBlock
                    label="Invoiced"
                    value={formatMoney(c.invoicedCents)}
                    sub={c.paidCents ? `${formatMoney(c.paidCents)} paid` : undefined}
                  />
                  <StatBlock
                    label="AR open"
                    value={formatMoney(c.arOutstandingCents)}
                    emphasis={c.arOutstandingCents > 0}
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
                        <TableHead className="text-right">Contract</TableHead>
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
                            {formatMoney(p.contractValueCents)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              ) : (
                <CardContent className="text-xs text-ink-3">No projects yet.</CardContent>
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

function StatBlock({
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
    <div>
      <div className="text-[11px] uppercase tracking-wide text-ink-3">{label}</div>
      <div className={`text-sm font-semibold ${emphasis ? 'text-status-amber' : 'text-ink'}`}>
        {value}
      </div>
      {sub && <div className="text-[10px] text-ink-3">{sub}</div>}
    </div>
  );
}
