import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSession } from '@/server/session';
import { hasAnyRole } from '@/server/roles';
import { hasCapability } from '@/server/capabilities';
import { listClients } from '@/server/clients';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
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
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

function formatMoney(cents: number): string {
  if (cents === 0) return '—';
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

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
            <Link href="/directory?tab=contractors">Contractors</Link>
          </TabsTrigger>
          <TabsTrigger value="suppliers" asChild>
            <Link href="/directory?tab=suppliers">Suppliers</Link>
          </TabsTrigger>
        </TabsList>
      </Tabs>

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

      <Card className="p-0">
        {rows.length === 0 ? (
          <div className="p-12 text-center text-sm text-ink-3">
            No clients yet. {canCreate ? (
              <Link href="/directory/clients/new" className="text-brand hover:underline">
                Create the first one →
              </Link>
            ) : (
              'Ask an admin to create one.'
            )}
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Primary partner</TableHead>
                <TableHead className="text-right">Active projects</TableHead>
                <TableHead className="text-right">AR outstanding</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>
                    <Badge variant="outline" className="font-mono">
                      {c.code}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="font-medium text-ink">{c.legalName}</div>
                    {c.tradingName && (
                      <div className="text-[11px] text-ink-3">t/a {c.tradingName}</div>
                    )}
                  </TableCell>
                  <TableCell>
                    {c.primaryPartner ? (
                      <div className="flex items-center gap-2">
                        <Avatar className="h-6 w-6">
                          <AvatarFallback className="text-[10px]">
                            {c.primaryPartner.initials}
                          </AvatarFallback>
                        </Avatar>
                        <span className="text-sm text-ink-2">
                          {c.primaryPartner.firstName} {c.primaryPartner.lastName}
                        </span>
                      </div>
                    ) : (
                      <span className="text-ink-4">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{c.activeProjects}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatMoney(c.arOutstandingCents)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
