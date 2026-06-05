import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSession } from '@/server/session';
import { hasCapability } from '@/server/capabilities';
import { prisma } from '@/server/db';
import { writeAudit } from '@/server/audit';
import { verifyPrefillToken } from '@/server/agents/assistant/prefill/token';
import { InvoicePrefillSchema } from '@/server/agents/assistant/prefill/schemas';
import { PrefillBanner } from '@/components/prefill-banner';
import { NewInvoiceForm, type InvoiceFormInitialValues } from './form';

export default async function NewInvoicePage({
  searchParams,
}: {
  searchParams: { projectId?: string; prefill?: string };
}) {
  const session = await getSession();
  if (!session) notFound();
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

  // ─── Prefill (TASK-302b) ───────────────────────────────────────────
  let initialValues: InvoiceFormInitialValues | undefined;
  let prefillSummary: string | null = null;
  let prefillNotice: string | null = null;
  if (searchParams.prefill) {
    const verify = verifyPrefillToken(searchParams.prefill, {
      personId: session.person.id,
      kind: 'invoice',
    });
    if (verify.ok) {
      const payloadCheck = InvoicePrefillSchema.safeParse(verify.payload.payload);
      if (payloadCheck.success) {
        const p = payloadCheck.data;
        const code = p.projectCode.toUpperCase();
        const proj = projects.find((pr) => pr.code === code);
        if (proj) {
          initialValues = {
            projectId: proj.id,
            lines: p.lines.map((l) => ({
              label: l.label,
              amountDollars: l.amountDollars.toString(),
            })),
          };
          const total = p.lines.reduce((s, l) => s + l.amountDollars, 0);
          prefillSummary = `${proj.code} · ${p.lines.length} line${
            p.lines.length === 1 ? '' : 's'
          } totalling $${total.toFixed(2)} ex GST`;
          try {
            await prisma.$transaction(async (tx) => {
              await writeAudit(tx, {
                actor: { type: 'person', id: session.person.id },
                action: 'redeemed',
                entity: {
                  type: 'assistant_prefill',
                  id: `${session.person.id}:invoice:${proj.id}`,
                  after: { kind: 'invoice', jti: verify.payload.jti },
                },
                source: 'agent',
              });
            });
          } catch (err) {
            console.error('[invoice.prefill] audit redeem failed:', err);
          }
        } else {
          prefillNotice = `Prefill referenced project ${code} which no longer exists.`;
        }
      } else {
        prefillNotice = 'Prefill payload malformed — opened the form without changes.';
      }
    } else if (verify.reason === 'expired') {
      prefillNotice = 'Prefill link expired (15-min TTL).';
    } else if (verify.reason === 'wrong_person') {
      prefillNotice = "That prefill link wasn't minted for your account.";
    } else {
      prefillNotice = 'Prefill link invalid.';
    }
  }

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

      {prefillSummary && (
        <PrefillBanner summary={prefillSummary} cleanUrl="/invoices/new" />
      )}
      {prefillNotice && !prefillSummary && (
        <div className="rounded-md border border-status-amber bg-status-amber-soft px-3 py-2 text-xs text-status-amber">
          {prefillNotice}
        </div>
      )}

      {projects.length === 0 ? (
        <div className="rounded-lg border border-dashed border-line bg-card p-8 text-center text-sm text-ink-3">
          Create a project first —{' '}
          <Link href="/projects/new" className="text-brand hover:underline">
            New project →
          </Link>
        </div>
      ) : (
        <NewInvoiceForm
          projects={projects}
          defaultProjectId={searchParams.projectId ?? ''}
          initialValues={initialValues}
        />
      )}
    </div>
  );
}
