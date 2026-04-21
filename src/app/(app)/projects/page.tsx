import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ProjectStage } from '@prisma/client';
import { getSession } from '@/server/session';
import { hasCapability } from '@/server/capabilities';
import { listProjects } from '@/server/projects';
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

const STAGE_OPTIONS: readonly ProjectStage[] = ['kickoff', 'delivery', 'closing', 'archived'];
const STAGE_VARIANT: Record<ProjectStage, 'amber' | 'green' | 'blue' | 'outline'> = {
  kickoff: 'amber',
  delivery: 'green',
  closing: 'blue',
  archived: 'outline',
};

function buildQs(params: Record<string, string | undefined>): string {
  const entries = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(v as string)}`);
  return entries.length ? `?${entries.join('&')}` : '';
}

function formatMoney(cents: number): string {
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: { stage?: string; active?: string; deleted?: string; q?: string };
}) {
  const session = await getSession();
  if (!session) notFound();

  const stage = STAGE_OPTIONS.includes(searchParams.stage as ProjectStage)
    ? (searchParams.stage as ProjectStage)
    : undefined;
  const active =
    searchParams.active === 'true' ? true : searchParams.active === 'false' ? false : undefined;
  const deletedFlag = searchParams.deleted === '1';
  const q = searchParams.q?.trim() ?? '';

  const rows = await listProjects(session, { stage, active, search: q || undefined });
  const canCreate = hasCapability(session, 'project.create');

  return (
    <div className="space-y-6">
      {deletedFlag && (
        <div className="rounded-md border border-status-green bg-status-green-soft px-3 py-2 text-sm text-status-green">
          Project deleted.
        </div>
      )}
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-ink">Projects</h1>
          <p className="text-sm text-ink-3">
            {session.person.roles.some((r) =>
              ['super_admin', 'admin', 'partner'].includes(r),
            )
              ? 'All active engagements.'
              : session.person.roles.includes('manager')
                ? 'Projects you manage.'
                : 'Projects you are on.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <a
            href={`/api/reports/projects${buildQs({
              q,
              stage,
              active: active === undefined ? undefined : String(active),
            })}`}
            className="rounded-md border border-line px-3 py-1.5 text-sm text-ink-2 hover:bg-surface-hover hover:text-ink"
          >
            Download CSV
          </a>
          {canCreate && (
            <Button asChild>
              <Link href="/projects/new">+ New project</Link>
            </Button>
          )}
        </div>
      </header>

      <form
        action="/projects"
        method="get"
        className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-card p-3"
      >
        <Input
          name="q"
          defaultValue={q}
          placeholder="Search code, name, or client…"
          className="min-w-[240px] max-w-md"
        />
        <label className="flex items-center gap-2 text-xs text-ink-3">
          <span>Stage</span>
          <select
            name="stage"
            defaultValue={stage ?? ''}
            className="h-9 rounded-md border border-line bg-surface-elev px-2 text-sm text-ink"
          >
            <option value="">All</option>
            {STAGE_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-xs text-ink-3">
          <span>Active</span>
          <select
            name="active"
            defaultValue={active === true ? 'true' : active === false ? 'false' : ''}
            className="h-9 rounded-md border border-line bg-surface-elev px-2 text-sm text-ink"
          >
            <option value="">All</option>
            <option value="true">Active</option>
            <option value="false">Archived</option>
          </select>
        </label>
        <Button type="submit" variant="outline" size="sm">
          Apply
        </Button>
        {(q || stage || active !== undefined) && (
          <Button type="button" asChild variant="ghost" size="sm">
            <Link href="/projects">Clear</Link>
          </Button>
        )}
        <span className="ml-auto text-xs text-ink-3">
          {rows.length} {rows.length === 1 ? 'project' : 'projects'}
        </span>
      </form>

      <Card className="p-0">
        {rows.length === 0 ? (
          <div className="p-12 text-center text-sm text-ink-3">
            {q ? (
              <>No projects match &quot;{q}&quot;. Try a different query or clear the filter.</>
            ) : (
              <>
                No projects {stage ? `in ${stage}` : 'yet'}.{' '}
                {canCreate && (
                  <Link href="/projects/new" className="text-brand hover:underline">
                    Create one →
                  </Link>
                )}
              </>
            )}
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Client</TableHead>
                <TableHead>Stage</TableHead>
                <TableHead>Partner</TableHead>
                <TableHead>Manager</TableHead>
                <TableHead className="text-right">Contract value</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>
                    <Link
                      href={`/projects/${p.code}`}
                      className="font-mono text-ink hover:underline"
                    >
                      {p.code}
                    </Link>
                  </TableCell>
                  <TableCell className="font-medium text-ink">{p.name}</TableCell>
                  <TableCell>
                    <Link href={`/directory/clients/${p.client.id}`} className="hover:underline">
                      <span className="font-mono text-xs text-ink-3">{p.client.code}</span>{' '}
                      <span className="text-ink-2">{p.client.legalName}</span>
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Badge variant={STAGE_VARIANT[p.stage]}>{p.stage}</Badge>
                  </TableCell>
                  <TableCell>
                    <MiniPerson p={p.primaryPartner} />
                  </TableCell>
                  <TableCell>
                    <MiniPerson p={p.manager} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatMoney(p.contractValueCents)}
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

function MiniPerson({
  p,
}: {
  p: { initials: string; firstName: string; lastName: string };
}) {
  return (
    <div className="flex items-center gap-2">
      <Avatar className="h-6 w-6">
        <AvatarFallback className="text-[10px]">{p.initials}</AvatarFallback>
      </Avatar>
      <span className="text-sm text-ink-2">
        {p.firstName} {p.lastName}
      </span>
    </div>
  );
}
