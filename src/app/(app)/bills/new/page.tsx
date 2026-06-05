import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSession } from '@/server/session';
import { hasCapability } from '@/server/capabilities';
import { prisma } from '@/server/db';
import { writeAudit } from '@/server/audit';
import { verifyPrefillToken } from '@/server/agents/assistant/prefill/token';
import { BillPrefillSchema } from '@/server/agents/assistant/prefill/schemas';
import { PrefillBanner } from '@/components/prefill-banner';
import { NewBillForm, type BillFormInitialValues } from './form';

export default async function NewBillPage({
  searchParams,
}: {
  searchParams: { prefill?: string };
}) {
  const session = await getSession();
  if (!session) notFound();
  if (!hasCapability(session, 'bill.create')) notFound();

  const [projects, contractors] = await Promise.all([
    prisma.project.findMany({
      where: { stage: { not: 'archived' } },
      orderBy: { code: 'asc' },
      select: { id: true, code: true, name: true },
    }),
    prisma.person.findMany({
      where: { employment: 'contractor', endDate: null },
      orderBy: [{ band: 'asc' }, { lastName: 'asc' }],
      select: { id: true, initials: true, headshotUrl: true, firstName: true, lastName: true },
    }),
  ]);

  // ─── Prefill (TASK-302b) ───────────────────────────────────────────
  let initialValues: BillFormInitialValues | undefined;
  let prefillSummary: string | null = null;
  let prefillNotice: string | null = null;
  let prefillIgnored: Array<{ projectCode: string; dateIso: string; reason: string }> = [];
  if (searchParams.prefill) {
    const verify = verifyPrefillToken(searchParams.prefill, {
      personId: session.person.id,
      kind: 'bill',
    });
    if (verify.ok) {
      const payloadCheck = BillPrefillSchema.safeParse(verify.payload.payload);
      if (payloadCheck.success) {
        const p = payloadCheck.data;
        let projectId: string | null = null;
        if (p.projectCode) {
          const code = p.projectCode.toUpperCase();
          const proj = projects.find((pr) => pr.code === code);
          if (proj) {
            projectId = proj.id;
          } else {
            prefillIgnored.push({
              projectCode: code,
              dateIso: p.issueDateIso,
              reason: 'unknown_project',
            });
          }
        }
        initialValues = {
          supplierName: p.supplierName,
          supplierInvoiceNumber: p.supplierInvoiceNumber,
          issueDate: p.issueDateIso,
          dueDate: p.dueDateIso,
          category: p.category,
          amountDollars: p.amountDollars.toFixed(2),
          gstDollars: p.gstDollars !== null && p.gstDollars !== undefined
            ? p.gstDollars.toFixed(2)
            : undefined,
          projectId,
        };
        prefillSummary = `${p.supplierName} · ${p.supplierInvoiceNumber} · $${p.amountDollars.toFixed(2)}${
          projectId ? '' : ' (OPEX)'
        }`;
        try {
          await prisma.$transaction(async (tx) => {
            await writeAudit(tx, {
              actor: { type: 'person', id: session.person.id },
              action: 'redeemed',
              entity: {
                type: 'assistant_prefill',
                id: `${session.person.id}:bill:${p.supplierInvoiceNumber}`,
                after: { kind: 'bill', jti: verify.payload.jti },
              },
              source: 'agent',
            });
          });
        } catch (err) {
          console.error('[bill.prefill] audit redeem failed:', err);
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
        <Link href="/bills" className="text-ink-3 hover:text-ink">
          ← Back to Bills
        </Link>
      </div>
      <header>
        <h1 className="text-xl font-semibold text-ink">New bill</h1>
        <p className="text-sm text-ink-3">
          Manual AP entry. Auto-intake from email via the AP intake agent ships later.
        </p>
      </header>
      {prefillSummary && (
        <PrefillBanner
          summary={prefillSummary}
          cleanUrl="/bills/new"
          ignored={prefillIgnored.length > 0 ? prefillIgnored : undefined}
        />
      )}
      {prefillNotice && !prefillSummary && (
        <div className="rounded-md border border-status-amber bg-status-amber-soft px-3 py-2 text-xs text-status-amber">
          {prefillNotice}
        </div>
      )}
      <NewBillForm
        projects={projects}
        contractors={contractors}
        initialValues={initialValues}
      />
    </div>
  );
}
