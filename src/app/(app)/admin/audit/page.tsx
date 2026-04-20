import { notFound } from 'next/navigation';
import { getSession } from '@/server/session';
import { hasCapability } from '@/server/capabilities';
import { prisma } from '@/server/db';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

const ENTITY_OPTIONS = [
  'project',
  'client',
  'person',
  'invoice',
  'bill',
  'expense',
  'approval',
  'approval_policy',
  'integration',
  'rate_card_row',
  'project_team',
  'milestone',
  'risk',
] as const;

const SINCE_OPTIONS = [
  { v: '1', label: 'last 24h' },
  { v: '7', label: 'last 7d' },
  { v: '30', label: 'last 30d' },
  { v: '90', label: 'last 90d' },
  { v: '', label: 'all time' },
] as const;

type SearchParams = {
  actor?: string;
  entity?: string;
  entityId?: string;
  action?: string;
  since?: string;
};

const PAGE_LIMIT = 200;

export default async function AuditLogPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const session = await getSession();
  if (!hasCapability(session, 'auditlog.view')) notFound();

  const actor = searchParams.actor?.trim() ?? '';
  const entity = searchParams.entity?.trim() ?? '';
  const entityId = searchParams.entityId?.trim() ?? '';
  const action = searchParams.action?.trim() ?? '';
  const since = searchParams.since?.trim() ?? '7';
  const sinceDays = since && /^\d+$/.test(since) ? Number(since) : null;
  const sinceCutoff =
    sinceDays !== null ? new Date(Date.now() - sinceDays * 24 * 3600 * 1000) : null;

  const where = {
    ...(actor
      ? {
          actor: {
            is: {
              OR: [
                { firstName: { contains: actor, mode: 'insensitive' as const } },
                { lastName: { contains: actor, mode: 'insensitive' as const } },
                { email: { contains: actor, mode: 'insensitive' as const } },
              ],
            },
          },
        }
      : {}),
    ...(entity ? { entityType: entity } : {}),
    ...(entityId
      ? { entityId: { startsWith: entityId, mode: 'insensitive' as const } }
      : {}),
    ...(action ? { action } : {}),
    ...(sinceCutoff ? { at: { gte: sinceCutoff } } : {}),
  } as const;

  const [events, totalMatching] = await Promise.all([
    prisma.auditEvent.findMany({
      where,
      orderBy: { at: 'desc' },
      take: PAGE_LIMIT,
      include: {
        actor: { select: { id: true, initials: true, firstName: true, lastName: true } },
      },
    }),
    prisma.auditEvent.count({ where }),
  ]);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-ink">Audit log</h1>
        <p className="text-sm text-ink-3">
          Every mutation Foundry Ops writes. Filter by actor, entity, action, or time window.
        </p>
      </header>

      <form
        action="/admin/audit"
        method="get"
        className="flex flex-wrap items-end gap-3 rounded-lg border border-line bg-card p-3"
      >
        <label className="flex flex-col gap-1 text-xs text-ink-3">
          Actor
          <Input
            name="actor"
            defaultValue={actor}
            placeholder="Name or email"
            className="max-w-[220px]"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-3">
          Entity type
          <select
            name="entity"
            defaultValue={entity}
            className="h-9 rounded-md border border-line bg-surface-elev px-2 text-sm text-ink"
          >
            <option value="">Any</option>
            {ENTITY_OPTIONS.map((e) => (
              <option key={e} value={e}>
                {e.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-3">
          Entity ID
          <Input
            name="entityId"
            defaultValue={entityId}
            placeholder="full or 8-char prefix"
            className="max-w-[220px] font-mono"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-3">
          Action
          <Input
            name="action"
            defaultValue={action}
            placeholder="created, approved…"
            className="max-w-[180px]"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-3">
          Window
          <select
            name="since"
            defaultValue={since}
            className="h-9 rounded-md border border-line bg-surface-elev px-2 text-sm text-ink"
          >
            {SINCE_OPTIONS.map((s) => (
              <option key={s.label} value={s.v}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <Button type="submit" size="sm" variant="outline">
          Apply
        </Button>
        <Button type="button" asChild size="sm" variant="ghost">
          <a href="/admin/audit">Clear</a>
        </Button>
        <span className="ml-auto text-xs text-ink-3">
          {totalMatching > events.length
            ? `Showing ${events.length} of ${totalMatching} matching`
            : `${events.length} event${events.length === 1 ? '' : 's'}`}
        </span>
      </form>

      <Card className="p-0">
        {events.length === 0 ? (
          <div className="p-12 text-center text-sm text-ink-3">
            No audit events match these filters.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Actor</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Entity</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Delta</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {events.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="whitespace-nowrap tabular-nums text-xs text-ink-3">
                    {e.at.toLocaleString('en-AU', { hour12: false })}
                  </TableCell>
                  <TableCell>
                    {e.actor ? (
                      <span>
                        <span className="font-mono text-xs text-ink-3">
                          {e.actor.initials}
                        </span>{' '}
                        <span className="text-ink">
                          {e.actor.firstName} {e.actor.lastName}
                        </span>
                      </span>
                    ) : (
                      <span className="text-ink-3">system / agent</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="capitalize">
                      {e.action.replace(/_/g, ' ')}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <span className="font-mono text-xs text-ink-2">{e.entityType}</span>
                    <a
                      href={`/admin/audit?entity=${e.entityType}&entityId=${e.entityId}`}
                      className="ml-1 font-mono text-xs text-ink-3 hover:underline"
                      title="Filter to this entity's full history"
                    >
                      · {e.entityId.slice(0, 8)}…
                    </a>
                  </TableCell>
                  <TableCell className="text-xs text-ink-3">{e.source ?? '—'}</TableCell>
                  <TableCell className="max-w-[320px] text-xs text-ink-3">
                    {e.entityDelta ? (
                      <details>
                        <summary className="cursor-pointer hover:text-ink-2">show</summary>
                        <pre className="mt-2 max-h-60 overflow-auto rounded bg-surface-subtle p-2 text-[10px] text-ink-2">
                          {JSON.stringify(e.entityDelta, null, 2)}
                        </pre>
                      </details>
                    ) : (
                      '—'
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <p className="text-xs text-ink-3">
        Capped at {PAGE_LIMIT} rows per query — tighten the filters if the match count
        exceeds that. Structured export via{' '}
        <span className="font-mono">GET /api/admin/audit</span>.
      </p>
    </div>
  );
}
