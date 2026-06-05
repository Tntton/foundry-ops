import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSession } from '@/server/session';
import { hasCapability } from '@/server/capabilities';
import { prisma } from '@/server/db';
import { writeAudit } from '@/server/audit';
import { verifyPrefillToken } from '@/server/agents/assistant/prefill/token';
import { ExpensePrefillSchema } from '@/server/agents/assistant/prefill/schemas';
import { PrefillBanner } from '@/components/prefill-banner';
import { NewExpenseForm, type ExpenseFormInitialValues } from './form';

export default async function NewExpensePage({
  searchParams,
}: {
  searchParams: { prefill?: string };
}) {
  const session = await getSession();
  if (!session) notFound();
  if (!hasCapability(session, 'expense.submit')) notFound();

  // All active projects for the select — users can log expenses against any.
  const projects = await prisma.project.findMany({
    where: { stage: { not: 'archived' } },
    orderBy: { code: 'asc' },
    select: { id: true, code: true, name: true },
  });

  // ─── Prefill (TASK-302b) ───────────────────────────────────────────
  let initialValues: ExpenseFormInitialValues | undefined;
  let prefillSummary: string | null = null;
  let prefillNotice: string | null = null;
  let prefillIgnored: Array<{ projectCode: string; dateIso: string; reason: string }> = [];
  if (searchParams.prefill) {
    const verify = verifyPrefillToken(searchParams.prefill, {
      personId: session.person.id,
      kind: 'expense',
    });
    if (verify.ok) {
      const payloadCheck = ExpensePrefillSchema.safeParse(verify.payload.payload);
      if (payloadCheck.success) {
        const p = payloadCheck.data;
        // Resolve project code → projectId (if supplied). Mismatched
        // codes fall through to OPEX with a banner notice.
        let projectId: string | null = null;
        if (p.projectCode) {
          const code = p.projectCode.toUpperCase();
          const proj = projects.find((pr) => pr.code === code);
          if (proj) {
            projectId = proj.id;
          } else {
            prefillIgnored.push({
              projectCode: code,
              dateIso: p.dateIso,
              reason: 'unknown_project',
            });
          }
        }
        initialValues = {
          date: p.dateIso,
          category: p.category,
          projectId,
          amountDollars: p.amountDollars.toFixed(2),
          gstDollars: p.gstDollars !== null && p.gstDollars !== undefined
            ? p.gstDollars.toFixed(2)
            : undefined,
          vendor: p.vendor ?? '',
          description: p.description,
        };
        prefillSummary = `$${p.amountDollars.toFixed(2)} ${
          p.vendor ? `at ${p.vendor}` : ''
        }${projectId ? '' : ' (OPEX)'} — ${p.description}`.trim();
        try {
          await prisma.$transaction(async (tx) => {
            await writeAudit(tx, {
              actor: { type: 'person', id: session.person.id },
              action: 'redeemed',
              entity: {
                type: 'assistant_prefill',
                id: `${session.person.id}:expense:${p.dateIso}`,
                after: { kind: 'expense', jti: verify.payload.jti },
              },
              source: 'agent',
            });
          });
        } catch (err) {
          console.error('[expense.prefill] audit redeem failed:', err);
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
        <Link href="/expenses" className="text-ink-3 hover:text-ink">
          ← Back to Expenses
        </Link>
      </div>
      <header>
        <h1 className="text-xl font-semibold text-ink">New expense</h1>
        <p className="text-sm text-ink-3">
          Routes to Admin approval (≤$2k) or Super Admin (&gt;$2k). Reimbursed via next
          pay run.
        </p>
      </header>
      {prefillSummary && (
        <PrefillBanner
          summary={prefillSummary}
          cleanUrl="/expenses/new"
          ignored={prefillIgnored.length > 0 ? prefillIgnored : undefined}
        />
      )}
      {prefillNotice && !prefillSummary && (
        <div className="rounded-md border border-status-amber bg-status-amber-soft px-3 py-2 text-xs text-status-amber">
          {prefillNotice}
        </div>
      )}
      <NewExpenseForm projects={projects} initialValues={initialValues} />
    </div>
  );
}
