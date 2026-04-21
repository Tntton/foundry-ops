import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSession } from '@/server/session';
import { hasCapability } from '@/server/capabilities';
import { prisma } from '@/server/db';
import { previewMilestonesForInvoice } from '@/server/invoice-drafter';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DraftMilestoneInvoiceForm } from './form';

function formatMoney(cents: number): string {
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

export default async function DraftMilestoneInvoicePage({
  params,
}: {
  params: { code: string };
}) {
  const session = await getSession();
  if (!hasCapability(session, 'invoice.create')) notFound();

  const project = await prisma.project.findUnique({
    where: { code: params.code },
    select: {
      id: true,
      code: true,
      name: true,
      client: { select: { code: true, legalName: true } },
    },
  });
  if (!project) notFound();

  const preview = await previewMilestonesForInvoice(project.id);
  const availableTotal = preview.available.reduce((s, m) => s + m.amountCents, 0);
  const invoicedTotal = preview.alreadyInvoiced.reduce((s, m) => s + m.amountCents, 0);

  return (
    <div className="space-y-6">
      <div className="text-sm">
        <Link href={`/projects/${project.code}`} className="text-ink-3 hover:text-ink">
          ← Back to {project.code}
        </Link>
      </div>

      <header>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="font-mono">
            {project.code}
          </Badge>
          <h1 className="text-xl font-semibold text-ink">Draft invoice from milestones</h1>
        </div>
        <p className="mt-1 text-sm text-ink-3">
          Pick one or more not-yet-invoiced milestones for{' '}
          <strong>{project.client.legalName}</strong>. Each becomes a line in a new draft
          invoice and is marked as invoiced.
        </p>
      </header>

      {preview.available.length === 0 ? (
        <Card className="p-12 text-center text-sm text-ink-3">
          No un-invoiced milestones on this project.
          {preview.alreadyInvoiced.length > 0 && (
            <p className="mt-2 text-xs">
              All {preview.alreadyInvoiced.length} milestones on this project have already
              been invoiced ({formatMoney(invoicedTotal)} total).
            </p>
          )}
          <p className="mt-3">
            <Link
              href={`/projects/${project.code}/milestones`}
              className="text-brand hover:underline"
            >
              Add or edit milestones →
            </Link>
          </p>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>
                Milestones available · {preview.available.length} ·{' '}
                {formatMoney(availableTotal)} total
              </CardTitle>
            </CardHeader>
            <CardContent>
              <DraftMilestoneInvoiceForm
                projectId={project.id}
                milestones={preview.available}
              />
            </CardContent>
          </Card>
          {preview.alreadyInvoiced.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Already invoiced ({preview.alreadyInvoiced.length})</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-1 text-sm">
                  {preview.alreadyInvoiced.map((m) => (
                    <li
                      key={m.id}
                      className="flex items-center justify-between text-ink-3"
                    >
                      <span>{m.label}</span>
                      <span className="tabular-nums">{formatMoney(m.amountCents)}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
