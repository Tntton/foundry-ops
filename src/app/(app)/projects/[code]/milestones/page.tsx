import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSession } from '@/server/session';
import { hasCapability } from '@/server/capabilities';
import { prisma } from '@/server/db';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { NewMilestoneForm, UpdateMilestoneStatus } from './form';

const STATUS_VARIANT: Record<string, 'outline' | 'amber' | 'green' | 'blue'> = {
  not_started: 'outline',
  in_progress: 'amber',
  delivered: 'blue',
  invoiced: 'green',
};

function formatMoney(cents: number): string {
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

export default async function MilestonesPage({ params }: { params: { code: string } }) {
  const session = await getSession();
  if (!session) notFound();
  if (!hasCapability(session, 'project.edit')) notFound();

  const project = await prisma.project.findUnique({
    where: { code: params.code },
    include: {
      milestones: {
        orderBy: { dueDate: 'asc' },
        include: { invoice: { select: { id: true, number: true } } },
      },
    },
  });
  if (!project) notFound();

  const canAll = session.person.roles.some((r) => ['super_admin', 'admin'].includes(r));
  if (!canAll && project.managerId !== session.person.id && project.primaryPartnerId !== session.person.id) {
    notFound();
  }

  const total = project.milestones.reduce((s, m) => s + m.amount, 0);
  const overContract = total > project.contractValue;

  return (
    <div className="space-y-6">
      <div className="text-sm">
        <Link href={`/projects/${project.code}`} className="text-ink-3 hover:text-ink">
          ← Back to {project.code}
        </Link>
      </div>
      <header>
        <h1 className="text-xl font-semibold text-ink">Milestones — {project.name}</h1>
        <p className="text-sm text-ink-3">
          Contract value {formatMoney(project.contractValue)} ·{' '}
          {project.milestones.length} milestone{project.milestones.length === 1 ? '' : 's'}.
        </p>
      </header>

      {overContract && (
        <div className="rounded-md border border-status-amber bg-status-amber-soft px-3 py-2 text-sm text-status-amber">
          Milestones total ({formatMoney(total)}) exceeds contract value (
          {formatMoney(project.contractValue)}).
        </div>
      )}

      <Card className="p-0">
        {project.milestones.length === 0 ? (
          <div className="p-12 text-center text-sm text-ink-3">
            No milestones yet. Add one below.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Label</TableHead>
                <TableHead>Due</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Invoice</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {project.milestones.map((m) => (
                <TableRow key={m.id}>
                  <TableCell className="font-medium text-ink">{m.label}</TableCell>
                  <TableCell className="tabular-nums">
                    {m.dueDate.toLocaleDateString('en-AU')}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatMoney(m.amount)}
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[m.status] ?? 'outline'} className="capitalize">
                      {m.status.replace('_', ' ')}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {m.invoice ? (
                      <Link
                        href={`/invoices/${m.invoice.id}`}
                        className="font-mono text-xs text-ink-3 hover:underline"
                      >
                        {m.invoice.number}
                      </Link>
                    ) : (
                      <span className="text-ink-4">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <UpdateMilestoneStatus milestoneId={m.id} status={m.status} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell colSpan={2} className="text-right text-xs uppercase text-ink-3">
                  Total
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums">
                  {formatMoney(total)}
                </TableCell>
                <TableCell colSpan={3} className="text-xs text-ink-3">
                  {overContract ? '⚠ over contract' : ''}
                </TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        )}
      </Card>

      <NewMilestoneForm projectId={project.id} />
    </div>
  );
}
