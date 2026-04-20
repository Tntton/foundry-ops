import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSession } from '@/server/session';
import { hasCapability } from '@/server/capabilities';
import { prisma } from '@/server/db';
import { NewInvoiceForm } from './form';

export default async function NewInvoicePage({
  searchParams,
}: {
  searchParams: { projectId?: string };
}) {
  const session = await getSession();
  if (!hasCapability(session, 'invoice.create')) notFound();

  const rawProjects = await prisma.project.findMany({
    where: { stage: { not: 'archived' } },
    orderBy: { code: 'asc' },
    select: {
      id: true,
      code: true,
      name: true,
      client: { select: { code: true, legalName: true } },
    },
  });
  const projects = rawProjects.map((p) => ({
    id: p.id,
    code: p.code,
    name: p.name,
    clientCode: p.client.code,
    clientName: p.client.legalName,
  }));

  return (
    <div className="space-y-6">
      <div className="text-sm">
        <Link href="/invoices" className="text-ink-3 hover:text-ink">
          ← Back to Invoices
        </Link>
      </div>
      <header>
        <h1 className="text-xl font-semibold text-ink">New invoice</h1>
        <p className="text-sm text-ink-3">
          Manual draft with free-form line items. Auto-fill from milestones + T&amp;M via
          the invoice drafter agent ships later.
        </p>
      </header>

      {projects.length === 0 ? (
        <div className="rounded-lg border border-dashed border-line bg-card p-8 text-center text-sm text-ink-3">
          Create a project first —{' '}
          <Link href="/projects/new" className="text-brand hover:underline">
            New project →
          </Link>
        </div>
      ) : (
        <NewInvoiceForm projects={projects} defaultProjectId={searchParams.projectId ?? ''} />
      )}
    </div>
  );
}
