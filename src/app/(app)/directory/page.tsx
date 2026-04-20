import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Band, Employment, Region } from '@prisma/client';
import { getSession } from '@/server/session';
import { hasAnyRole } from '@/server/roles';
import { listPeople } from '@/server/directory';
import { hasCapability } from '@/server/capabilities';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card } from '@/components/ui/card';
import { formatFte, formatRateCents } from '@/lib/format';

const BAND_OPTIONS: readonly Band[] = ['MP', 'Partner', 'Expert', 'Consultant', 'Analyst'];
const REGION_OPTIONS: readonly Region[] = ['AU', 'NZ'];
const EMPLOYMENT_OPTIONS: readonly Employment[] = ['ft', 'contractor'];

export default async function DirectoryPage({
  searchParams,
}: {
  searchParams: {
    tab?: string;
    q?: string;
    band?: string;
    region?: string;
    employment?: string;
    active?: string;
  };
}) {
  const session = await getSession();
  if (!hasAnyRole(session, ['super_admin', 'admin', 'partner'])) {
    notFound();
  }

  const tab = searchParams.tab ?? 'people';
  const q = searchParams.q ?? '';
  const band = BAND_OPTIONS.includes(searchParams.band as Band)
    ? (searchParams.band as Band)
    : undefined;
  const region = REGION_OPTIONS.includes(searchParams.region as Region)
    ? (searchParams.region as Region)
    : undefined;
  const employment = EMPLOYMENT_OPTIONS.includes(searchParams.employment as Employment)
    ? (searchParams.employment as Employment)
    : undefined;
  const active: 'active' | 'archived' | 'all' =
    searchParams.active === 'archived' || searchParams.active === 'all'
      ? searchParams.active
      : 'active';

  const canEdit = hasCapability(session, 'person.edit');
  const canCreate = hasCapability(session, 'person.create');
  const canSeePay = hasCapability(session, 'ratecard.view');

  const people =
    tab === 'people'
      ? await listPeople({ search: q, band, region, employment, active })
      : [];

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-ink">Directory</h1>
          <p className="text-sm text-ink-3">People, clients, contractors, suppliers.</p>
        </div>
        {canCreate && tab === 'people' && (
          <Button asChild>
            <Link href="/directory/people/new">+ New person</Link>
          </Button>
        )}
      </header>

      <Tabs defaultValue={tab}>
        <TabsList>
          <TabsTrigger value="people" asChild>
            <Link href="/directory?tab=people">People</Link>
          </TabsTrigger>
          <TabsTrigger value="clients" asChild>
            <Link href="/directory?tab=clients">Clients</Link>
          </TabsTrigger>
          <TabsTrigger value="contractors" asChild>
            <Link href="/directory?tab=contractors">Contractors</Link>
          </TabsTrigger>
          <TabsTrigger value="suppliers" asChild>
            <Link href="/directory?tab=suppliers">Suppliers</Link>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="people">
          <PeopleTab
            q={q}
            band={band}
            region={region}
            employment={employment}
            active={active}
            rows={people}
            canSeePay={canSeePay}
            canEdit={canEdit}
          />
        </TabsContent>
        <TabsContent value="clients">
          <EmptyTab message="Client directory lands with TASK-024." />
        </TabsContent>
        <TabsContent value="contractors">
          <EmptyTab message="Contractor list is filtered from people once contractor-specific fields settle." />
        </TabsContent>
        <TabsContent value="suppliers">
          <EmptyTab message="Supplier directory lands with TASK-046 (bill intake)." />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function PeopleTab({
  q,
  band,
  region,
  employment,
  active,
  rows,
  canSeePay,
  canEdit,
}: {
  q: string;
  band: Band | undefined;
  region: Region | undefined;
  employment: Employment | undefined;
  active: 'active' | 'archived' | 'all';
  rows: Awaited<ReturnType<typeof listPeople>>;
  canSeePay: boolean;
  canEdit: boolean;
}) {
  return (
    <div className="space-y-4">
      <form
        action="/directory"
        method="get"
        className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-card p-3"
      >
        <input type="hidden" name="tab" value="people" />
        <Input
          name="q"
          defaultValue={q}
          placeholder="Search by name, initials, or email…"
          className="min-w-[240px] max-w-xs"
        />
        <SelectFilter label="Band" name="band" value={band} options={BAND_OPTIONS} />
        <SelectFilter label="Region" name="region" value={region} options={REGION_OPTIONS} />
        <SelectFilter
          label="Employment"
          name="employment"
          value={employment}
          options={EMPLOYMENT_OPTIONS}
        />
        <label className="flex items-center gap-1 text-xs text-ink-3">
          <span>Show</span>
          <select
            name="active"
            defaultValue={active}
            className="h-9 rounded-md border border-line bg-surface-elev px-2 text-sm text-ink"
          >
            <option value="active">Active only</option>
            <option value="archived">Archived only</option>
            <option value="all">All</option>
          </select>
        </label>
        <Button type="submit" variant="outline" size="sm">
          Apply
        </Button>
        <Button type="button" asChild variant="ghost" size="sm">
          <Link href="/directory?tab=people">Clear</Link>
        </Button>
        <span className="ml-auto text-xs text-ink-3">
          {rows.length} {rows.length === 1 ? 'person' : 'people'}
        </span>
      </form>

      <Card className="p-0">
        {rows.length === 0 ? (
          <EmptyTab message="No people match the current filters. Try clearing them or run the seed (pnpm db:seed)." />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Person</TableHead>
                <TableHead>Band / Level</TableHead>
                <TableHead>Region</TableHead>
                <TableHead>Employment</TableHead>
                <TableHead>FTE</TableHead>
                {canSeePay && <TableHead className="text-right">Rate</TableHead>}
                <TableHead>Status</TableHead>
                {canEdit && <TableHead className="w-20 text-right">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>
                    <Link
                      href={`/directory/people/${p.id}`}
                      className="flex items-center gap-2 hover:text-ink"
                    >
                      <Avatar className="h-7 w-7">
                        <AvatarFallback className="text-[10px]">{p.initials}</AvatarFallback>
                      </Avatar>
                      <div>
                        <div className="font-medium text-ink">
                          {p.firstName} {p.lastName}
                        </div>
                        <div className="font-mono text-[11px] text-ink-3">{p.email}</div>
                      </div>
                    </Link>
                  </TableCell>
                  <TableCell>
                    <div className="font-medium text-ink-2">{p.band}</div>
                    <div className="text-[11px] text-ink-3">{p.level}</div>
                  </TableCell>
                  <TableCell>{p.region}</TableCell>
                  <TableCell>
                    <Badge variant={p.employment === 'ft' ? 'green' : 'blue'}>
                      {p.employment === 'ft' ? 'FT' : 'Contractor'}
                    </Badge>
                  </TableCell>
                  <TableCell className="tabular-nums">{formatFte(p.fte)}</TableCell>
                  {canSeePay && (
                    <TableCell className="text-right tabular-nums">
                      {formatRateCents(p.rate, p.rateUnit)}
                    </TableCell>
                  )}
                  <TableCell>
                    {p.active ? (
                      <Badge variant="green">Active</Badge>
                    ) : (
                      <Badge variant="outline">Ended</Badge>
                    )}
                  </TableCell>
                  {canEdit && (
                    <TableCell className="text-right">
                      <Button asChild variant="ghost" size="sm">
                        <Link href={`/directory/people/${p.id}`}>Edit</Link>
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}

function SelectFilter<T extends string>({
  label,
  name,
  value,
  options,
}: {
  label: string;
  name: string;
  value: T | undefined;
  options: readonly T[];
}) {
  return (
    <label className="flex items-center gap-1 text-xs text-ink-3">
      <span>{label}</span>
      <select
        name={name}
        defaultValue={value ?? ''}
        className="h-9 rounded-md border border-line bg-surface-elev px-2 text-sm text-ink focus:outline-none focus:ring-1 focus:ring-ring"
      >
        <option value="">All</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}

function EmptyTab({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-dashed border-line bg-card p-12 text-center text-sm text-ink-3">
      {message}
    </div>
  );
}
