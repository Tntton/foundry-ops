import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Band, Employment } from '@prisma/client';
import { getSession } from '@/server/session';
import { hasAnyRole } from '@/server/roles';
import { listPeople, type PersonSortKey } from '@/server/directory';
import { SortableTh } from '@/components/sortable-th';
import { hasCapability } from '@/server/capabilities';
import { PersonAvatar } from '@/components/person-avatar';
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
import { labelForLevel } from '@/lib/levels';

const BAND_OPTIONS: readonly Band[] = ['MP', 'Partner', 'Expert', 'Consultant', 'Analyst'];
const REGION_OPTIONS: readonly string[] = ['AU', 'NZ', 'US', 'CA', 'GB'];
const EMPLOYMENT_OPTIONS: readonly Employment[] = ['ft', 'contractor'];

export default async function DirectoryPage({
  searchParams,
}: {
  searchParams: {
    q?: string;
    band?: string;
    region?: string;
    employment?: string;
    active?: string;
    deleted?: string;
    sort?: string;
    dir?: string;
  };
}) {
  const VALID_SORTS: readonly PersonSortKey[] = [
    'lastName', 'firstName', 'band', 'level', 'region',
    'employment', 'fte', 'rate', 'startDate', 'lastLoginAt',
  ];
  const sort = VALID_SORTS.includes(searchParams.sort as PersonSortKey)
    ? (searchParams.sort as PersonSortKey)
    : undefined;
  const dir = searchParams.dir === 'desc' ? 'desc' : 'asc';
  const session = await getSession();
  // Pure-staff viewers get a stripped-down read-only directory — name,
  // band/level, region only. No tabs, no client roster, no profile
  // links. Anything beyond `staff` (manager/partner/admin/super_admin)
  // gets the full directory below.
  const isLeader = hasAnyRole(session, [
    'super_admin',
    'admin',
    'partner',
  ]);
  if (!session) notFound();
  if (!isLeader) {
    const stafQ = searchParams.q?.trim() ?? '';
    const allPeople = await listPeople({ active: 'active' });
    const visible = stafQ
      ? allPeople.filter((p) =>
          `${p.firstName} ${p.lastName} ${p.initials}`
            .toLowerCase()
            .includes(stafQ.toLowerCase()),
        )
      : allPeople;
    return (
      <div className="space-y-4">
        <header>
          <h1 className="text-xl font-semibold text-ink">Directory</h1>
          <p className="text-sm text-ink-3">
            Everyone at Foundry. Read-only — for the rest of the
            directory (clients, contractors, suppliers) ask a partner /
            admin.
          </p>
        </header>
        <form className="flex items-center gap-2" action="/directory">
          <Input
            name="q"
            defaultValue={stafQ}
            placeholder="Search by name…"
            className="max-w-sm"
          />
          <Button type="submit" variant="outline" size="sm">
            Search
          </Button>
          {stafQ && (
            <Button asChild type="button" variant="ghost" size="sm">
              <Link href="/directory">Clear</Link>
            </Button>
          )}
          <span className="ml-auto text-xs text-ink-3">
            {visible.length} {visible.length === 1 ? 'person' : 'people'}
          </span>
        </form>
        <Card className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Person</TableHead>
                <TableHead>Band / Level</TableHead>
                <TableHead>Region</TableHead>
                <TableHead>Work email</TableHead>
                <TableHead>WhatsApp</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-medium text-ink">
                    <span className="flex items-center gap-2">
                      <PersonAvatar
                        className="h-7 w-7"
                        fallbackClassName="text-[10px]"
                        initials={p.initials}
                        headshotUrl={p.headshotUrl}
                      />
                      <span>
                        {p.firstName} {p.lastName}
                      </span>
                    </span>
                  </TableCell>
                  <TableCell className="text-sm text-ink-2">
                    <div>{labelForLevel(p.level)}</div>
                    <div className="text-[11px] text-ink-3">
                      {p.band} · {p.level}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm text-ink-2">
                    {p.region}
                  </TableCell>
                  <TableCell>
                    {/* mailto: link so a single click opens the
                         viewer's mail client. Font-mono keeps the
                         column alignment tight. */}
                    <a
                      href={`mailto:${p.email}`}
                      className="font-mono text-xs text-ink-2 hover:text-brand hover:underline"
                    >
                      {p.email}
                    </a>
                  </TableCell>
                  <TableCell>
                    {p.whatsappNumber ? (
                      <a
                        href={`https://wa.me/${p.whatsappNumber.replace(/[^0-9]/g, '')}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-mono text-xs text-ink-2 hover:text-brand hover:underline"
                      >
                        {p.whatsappNumber}
                      </a>
                    ) : (
                      <span className="text-xs text-ink-4">—</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      </div>
    );
  }

  const q = searchParams.q ?? '';
  const band = BAND_OPTIONS.includes(searchParams.band as Band)
    ? (searchParams.band as Band)
    : undefined;
  const region =
    searchParams.region && /^[A-Z]{2}$/.test(searchParams.region)
      ? searchParams.region
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

  const people = await listPeople({ search: q, band, region, employment, active, sort, dir });
  // Client roster moved to /directory/clients (per TT, 2026-05-10):
  // people-tab now focuses on people only; client-tab carries the
  // active client list with the LTM filter.

  const deletedFlag = searchParams.deleted === '1';

  return (
    <div className="space-y-6">
      {deletedFlag && (
        <div className="rounded-md border border-status-green bg-status-green-soft px-3 py-2 text-sm text-status-green">
          Person deleted.
        </div>
      )}
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-ink">Directory</h1>
          <p className="text-sm text-ink-3">People, clients, contractors, suppliers.</p>
        </div>
        {canCreate && (
          <Button asChild>
            <Link href="/directory/people/new">+ New person</Link>
          </Button>
        )}
      </header>

      <Tabs defaultValue="people">
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
          <TabsTrigger value="company" asChild>
            <Link href="/directory/company">Company</Link>
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
      </Tabs>

    </div>
  );
}

/**
 * Friendly last-login readout for the directory table. Shows "Today
 * 14:32" / "Yesterday 09:01" / "3 days ago" / "12 Apr 2026". Hover
 * tooltip carries the full timestamp.
 */
function formatLastLogin(d: Date): string {
  const now = Date.now();
  const ms = now - d.getTime();
  const days = Math.floor(ms / 86_400_000);
  const time = d.toLocaleTimeString('en-AU', {
    hour: 'numeric',
    minute: '2-digit',
  });
  if (days === 0) return `Today ${time}`;
  if (days === 1) return `Yesterday ${time}`;
  if (days < 7) return `${days} days ago`;
  if (days < 14) return 'Last week';
  return d.toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
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
  region: string | undefined;
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
                <SortableTh sortKey="lastName">Person</SortableTh>
                <SortableTh sortKey="band">Band / Level</SortableTh>
                <SortableTh sortKey="region">Region</SortableTh>
                <SortableTh sortKey="employment">Employment</SortableTh>
                <SortableTh sortKey="fte">FTE</SortableTh>
                {canSeePay && <SortableTh sortKey="rate" className="text-right" align="right">Rate</SortableTh>}
                <SortableTh sortKey="lastLoginAt">Last login</SortableTh>
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
                      <PersonAvatar
  className="h-7 w-7"
  fallbackClassName="text-[10px]"
  initials={p.initials}
  headshotUrl={p.headshotUrl}
/>
                      <div>
                        <div className="font-medium text-ink">
                          {p.firstName} {p.lastName}
                        </div>
                        <div className="font-mono text-[11px] text-ink-3">{p.email}</div>
                      </div>
                    </Link>
                  </TableCell>
                  <TableCell>
                    {/* Show the level *label* (e.g. "Associate
                         Partner" for L3) rather than the raw band, so
                         the partner / associate-partner distinction
                         is visible without staring at the level code. */}
                    <div className="font-medium text-ink-2">
                      {labelForLevel(p.level)}
                    </div>
                    <div className="text-[11px] text-ink-3">
                      {p.band} · {p.level}
                    </div>
                  </TableCell>
                  <TableCell>{p.region}</TableCell>
                  <TableCell>
                    <Badge variant={p.employment === 'ft' ? 'green' : 'blue'}>
                      {p.employment === 'ft' ? 'FT' : 'Contractor'}
                    </Badge>
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {p.fte !== null ? formatFte(p.fte) : <span className="text-ink-4">—</span>}
                  </TableCell>
                  {canSeePay && (
                    <TableCell className="text-right tabular-nums">
                      {formatRateCents(p.rate, p.rateUnit)}
                    </TableCell>
                  )}
                  <TableCell>
                    {p.lastLoginAt ? (
                      <span
                        className="text-xs text-ink-2"
                        title={p.lastLoginAt.toLocaleString('en-AU')}
                      >
                        {formatLastLogin(p.lastLoginAt)}
                      </span>
                    ) : (
                      <span className="text-xs text-ink-4 italic">
                        Not yet logged in
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {p.active ? (
                        <Badge variant="green">Active</Badge>
                      ) : (
                        <Badge variant="outline">Ended</Badge>
                      )}
                      {p.poolStatusOverride && (
                        <span
                          className="inline-flex items-center gap-1 rounded-full border border-line bg-card px-1.5 py-0.5 text-[10px] text-ink-2"
                          title="Manual status override"
                        >
                          <span
                            className={`inline-block h-1.5 w-1.5 rounded-full ${
                              p.poolStatusOverride === 'on_project'
                                ? 'bg-status-green'
                                : p.poolStatusOverride === 'never_on_project'
                                  ? 'bg-status-red'
                                  : p.poolStatusOverride === 'on_sabbatical'
                                    ? 'bg-ink-4'
                                    : 'bg-ink-3'
                            }`}
                          />
                          {p.poolStatusOverride
                            .replace(/_/g, ' ')
                            .replace(/^./, (c) => c.toUpperCase())}
                        </span>
                      )}
                    </div>
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
