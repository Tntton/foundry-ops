import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSession } from '@/server/session';
import { hasCapability } from '@/server/capabilities';
import { prisma } from '@/server/db';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { NewRiskForm, RiskInlineSelect } from './form';

const SEVERITY_VARIANT: Record<string, 'outline' | 'amber' | 'red'> = {
  low: 'outline',
  medium: 'amber',
  high: 'red',
};
const STATUS_VARIANT: Record<string, 'amber' | 'blue' | 'green'> = {
  open: 'amber',
  mitigating: 'blue',
  closed: 'green',
};

export default async function RisksPage({ params }: { params: { code: string } }) {
  const session = await getSession();
  if (!session) notFound();
  if (!hasCapability(session, 'project.edit')) notFound();

  const project = await prisma.project.findUnique({
    where: { code: params.code },
    include: {
      risks: {
        orderBy: [{ status: 'asc' }, { severity: 'desc' }, { createdAt: 'desc' }],
      },
    },
  });
  if (!project) notFound();

  const canAll = session.person.roles.some((r) => ['super_admin', 'admin'].includes(r));
  if (!canAll && project.managerId !== session.person.id && project.primaryPartnerId !== session.person.id) {
    notFound();
  }

  const people = await prisma.person.findMany({
    where: { endDate: null },
    orderBy: [{ band: 'asc' }, { lastName: 'asc' }],
    select: { id: true, initials: true, firstName: true, lastName: true },
  });
  const peopleById = new Map(people.map((p) => [p.id, p]));

  return (
    <div className="space-y-6">
      <div className="text-sm">
        <Link href={`/projects/${project.code}`} className="text-ink-3 hover:text-ink">
          ← Back to {project.code}
        </Link>
      </div>
      <header>
        <h1 className="text-xl font-semibold text-ink">Risks — {project.name}</h1>
        <p className="text-sm text-ink-3">
          Log + track delivery risks. Status and severity update inline.
        </p>
      </header>

      <Card className="p-0">
        {project.risks.length === 0 ? (
          <div className="p-12 text-center text-sm text-ink-3">
            No risks logged yet. Add one below.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Title</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead>Severity</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Mitigation</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {project.risks.map((r) => {
                const owner = r.ownerId ? peopleById.get(r.ownerId) : null;
                return (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium text-ink">{r.title}</TableCell>
                    <TableCell>
                      {owner ? (
                        <div className="flex items-center gap-2">
                          <Avatar className="h-6 w-6">
                            <AvatarFallback className="text-[10px]">
                              {owner.initials}
                            </AvatarFallback>
                          </Avatar>
                          <span className="text-sm text-ink-2">
                            {owner.firstName} {owner.lastName}
                          </span>
                        </div>
                      ) : (
                        <span className="text-ink-4">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Badge variant={SEVERITY_VARIANT[r.severity] ?? 'outline'}>
                          {r.severity}
                        </Badge>
                        <RiskInlineSelect
                          riskId={r.id}
                          field="severity"
                          current={r.severity}
                          options={['low', 'medium', 'high']}
                        />
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Badge variant={STATUS_VARIANT[r.status] ?? 'outline'}>
                          {r.status}
                        </Badge>
                        <RiskInlineSelect
                          riskId={r.id}
                          field="status"
                          current={r.status}
                          options={['open', 'mitigating', 'closed']}
                        />
                      </div>
                    </TableCell>
                    <TableCell className="max-w-sm text-sm text-ink-2">
                      {r.mitigation ?? <span className="text-ink-4">—</span>}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Card>

      <NewRiskForm projectId={project.id} people={people} />
    </div>
  );
}
