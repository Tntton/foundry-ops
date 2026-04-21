import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSession } from '@/server/session';
import { hasAnyRole } from '@/server/roles';
import { listFirmRisks } from '@/server/risks';
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

const SEVERITY_VARIANT: Record<string, 'outline' | 'amber' | 'red'> = {
  low: 'outline',
  medium: 'amber',
  high: 'red',
};
const STATUS_VARIANT: Record<string, 'outline' | 'amber' | 'green'> = {
  open: 'amber',
  mitigating: 'amber',
  closed: 'green',
};
const STAGE_VARIANT: Record<string, 'outline' | 'amber' | 'green' | 'blue'> = {
  kickoff: 'amber',
  delivery: 'green',
  closing: 'blue',
  archived: 'outline',
};

export default async function FirmRisksPage({
  searchParams,
}: {
  searchParams: {
    severity?: string;
    status?: string;
    archived?: string;
  };
}) {
  const session = await getSession();
  if (!hasAnyRole(session, ['super_admin', 'admin', 'partner'])) notFound();

  const severity = (['low', 'medium', 'high'] as const).includes(
    searchParams.severity as 'low' | 'medium' | 'high',
  )
    ? (searchParams.severity as 'low' | 'medium' | 'high')
    : undefined;
  const status = (['open', 'mitigating', 'closed'] as const).includes(
    searchParams.status as 'open' | 'mitigating' | 'closed',
  )
    ? (searchParams.status as 'open' | 'mitigating' | 'closed')
    : undefined;
  const includeArchived = searchParams.archived === '1';

  const data = await listFirmRisks({
    ...(severity ? { severity } : {}),
    ...(status ? { status } : {}),
    includeArchived,
  });

  const activeFilters = Boolean(severity || status || includeArchived);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-ink">Risks</h1>
        <p className="text-sm text-ink-3">
          Open + mitigating risks across active projects, sorted by severity then status.
          Closed risks and archived projects are excluded by default.
        </p>
      </header>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <TotalCard label="Total" value={String(data.totals.total)} sub="in view" />
        <TotalCard
          label="High"
          value={String(data.totals.high)}
          sub="severity"
          emphasis={data.totals.high > 0}
        />
        <TotalCard
          label="Open"
          value={String(data.totals.open)}
          sub={`${data.totals.mitigating} mitigating`}
        />
        <TotalCard
          label="Closed"
          value={String(data.totals.closed)}
          sub={includeArchived ? 'incl archived' : 'excl by default'}
        />
        <TotalCard
          label="Stale open"
          value={
            data.totals.staleOpenDays === null
              ? '—'
              : `${data.totals.staleOpenDays}d`
          }
          sub="oldest open"
          emphasis={data.totals.staleOpenDays !== null && data.totals.staleOpenDays > 30}
        />
      </div>

      <form
        action="/risks"
        method="get"
        className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-card p-3"
      >
        <label className="flex items-center gap-2 text-xs text-ink-3">
          <span>Severity</span>
          <select
            name="severity"
            defaultValue={severity ?? ''}
            className="h-9 rounded-md border border-line bg-surface-elev px-2 text-sm text-ink"
          >
            <option value="">Any</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </label>
        <label className="flex items-center gap-2 text-xs text-ink-3">
          <span>Status</span>
          <select
            name="status"
            defaultValue={status ?? ''}
            className="h-9 rounded-md border border-line bg-surface-elev px-2 text-sm text-ink"
          >
            <option value="">Open + mitigating</option>
            <option value="open">Open only</option>
            <option value="mitigating">Mitigating only</option>
            <option value="closed">Closed only</option>
          </select>
        </label>
        <label className="flex items-center gap-2 text-xs text-ink-3">
          <input
            type="checkbox"
            name="archived"
            value="1"
            defaultChecked={includeArchived}
            className="h-4 w-4"
          />
          <span>Include archived projects</span>
        </label>
        <Button type="submit" size="sm" variant="outline">
          Apply
        </Button>
        {activeFilters && (
          <Button type="button" asChild size="sm" variant="ghost">
            <Link href="/risks">Clear</Link>
          </Button>
        )}
        <span className="ml-auto text-xs text-ink-3">
          {data.rows.length} {data.rows.length === 1 ? 'risk' : 'risks'}
        </span>
      </form>

      <Card className="p-0">
        {data.rows.length === 0 ? (
          <div className="p-12 text-center text-sm text-ink-3">
            {activeFilters
              ? 'No risks match the current filters.'
              : 'No open risks across any active project. Clean sheet.'}
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Severity</TableHead>
                <TableHead>Title</TableHead>
                <TableHead>Project</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <Badge
                      variant={SEVERITY_VARIANT[r.severity] ?? 'outline'}
                      className="capitalize"
                    >
                      {r.severity}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Link
                      href={`/projects/${r.project.code}/risks`}
                      className="text-ink hover:underline"
                    >
                      {r.title}
                    </Link>
                    {r.mitigation && (
                      <div className="mt-0.5 text-xs text-ink-3 line-clamp-1">
                        {r.mitigation}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    <Link
                      href={`/projects/${r.project.code}`}
                      className="flex items-center gap-1.5 text-sm hover:underline"
                    >
                      <span className="font-mono text-xs text-ink-3">
                        {r.project.code}
                      </span>
                      <span className="text-ink-2">{r.project.name}</span>
                      <Badge
                        variant={STAGE_VARIANT[r.project.stage] ?? 'outline'}
                        className="capitalize text-[10px]"
                      >
                        {r.project.stage}
                      </Badge>
                    </Link>
                  </TableCell>
                  <TableCell>
                    {r.owner ? (
                      <Link
                        href={`/directory/people/${r.owner.id}`}
                        className="flex items-center gap-1.5 text-sm hover:underline"
                      >
                        <Avatar className="h-5 w-5">
                          <AvatarFallback className="text-[9px]">
                            {r.owner.initials}
                          </AvatarFallback>
                        </Avatar>
                        <span className="text-ink-2">
                          {r.owner.firstName} {r.owner.lastName}
                        </span>
                      </Link>
                    ) : (
                      <span className="text-xs text-ink-4">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={STATUS_VARIANT[r.status] ?? 'outline'}
                      className="capitalize"
                    >
                      {r.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="tabular-nums text-xs text-ink-3">
                    {r.updatedAt.toLocaleDateString('en-AU')}
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
