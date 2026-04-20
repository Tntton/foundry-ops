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

type SearchParams = {
  actor?: string;
  entity?: string;
  action?: string;
};

export default async function AuditLogPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const session = await getSession();
  if (!hasCapability(session, 'auditlog.view')) notFound();

  const actor = searchParams.actor?.trim() ?? '';
  const entity = searchParams.entity?.trim() ?? '';
  const action = searchParams.action?.trim() ?? '';

  const events = await prisma.auditEvent.findMany({
    where: {
      ...(actor
        ? {
            actor: {
              is: {
                OR: [
                  { firstName: { contains: actor, mode: 'insensitive' } },
                  { lastName: { contains: actor, mode: 'insensitive' } },
                  { email: { contains: actor, mode: 'insensitive' } },
                ],
              },
            },
          }
        : {}),
      ...(entity ? { entityType: entity } : {}),
      ...(action ? { action } : {}),
    },
    orderBy: { at: 'desc' },
    take: 200,
    include: {
      actor: { select: { id: true, initials: true, firstName: true, lastName: true } },
    },
  });

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold text-ink">Audit log</h1>
        <p className="text-sm text-ink-3">
          Every mutation Foundry Ops writes. Showing most recent 200 events.
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
          <Input
            name="entity"
            defaultValue={entity}
            placeholder="project, invoice, bill…"
            className="max-w-[180px]"
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
        <Button type="submit" size="sm" variant="outline">
          Apply
        </Button>
        <Button type="button" asChild size="sm" variant="ghost">
          <a href="/admin/audit">Clear</a>
        </Button>
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
                    <span className="font-mono text-xs text-ink-2">
                      {e.entityType}
                    </span>
                    <span className="ml-1 font-mono text-xs text-ink-3">
                      · {e.entityId.slice(0, 8)}…
                    </span>
                  </TableCell>
                  <TableCell className="text-xs text-ink-3">{e.source ?? '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <p className="text-xs text-ink-3">
        Full delta JSON per event isn&apos;t shown here — pull via{' '}
        <span className="font-mono">GET /api/admin/audit</span> for the structured view.
      </p>
    </div>
  );
}
