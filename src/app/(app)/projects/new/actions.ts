'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '@/server/db';
import { getSession } from '@/server/session';
import { requireCapability } from '@/server/capabilities';
import { writeAudit } from '@/server/audit';
import { provisionProjectFolder } from '@/server/integrations/sharepoint';
import { notifyAdminPool, emitUserUpdateMany } from '@/server/user-updates';
import { getXeroIntegration } from '@/server/integrations/xero';
import { ensureProjectTrackingOption } from '@/server/integrations/xero-projects';
import {
  DEFAULT_BUDGET_LINES,
  defaultWeeksForProject,
} from '@/server/projects/budget';

const ProjectCreate = z
  .object({
    /** Discriminator — `client` (default) carries the full
     *  contract+client validation; `internal` skips the client picker
     *  (server resolves to the FH internal client) and accepts a zero
     *  contract value. Defaults to `client` so legacy callers without
     *  the field still work. */
    kind: z.enum(['client', 'internal']).default('client'),
    code: z
      .string()
      .trim()
      .regex(/^[A-Z][A-Z0-9]{2,9}$/u, '3-10 uppercase letters/digits, letter first'),
    clientId: z.string().optional().nullable(),
    name: z.string().trim().min(3).max(200),
    description: z.string().trim().max(2000).optional().nullable(),
    contractValueDollars: z.coerce.number().min(0).max(10_000_000),
    // Operator's project-duration estimate from the Commercials block.
    // Drives the auto-seeded budget's `numberOfWeeks` so the forecasted
    // line totals (rate × units/week × weeks) carry the right scale
    // straight off the create. Falls back to date-derived weeks (or 12)
    // when 0 / missing.
    estimatedWeeks: z.coerce.number().int().min(0).max(520).optional(),
    // Theoretical dates are optional at create-time. They become required for
    // closing/archived stage transitions (enforced in settings/actions.ts).
    startDate: z
      .union([z.coerce.date(), z.literal('').transform(() => null)])
      .optional()
      .nullable(),
    endDate: z
      .union([z.coerce.date(), z.literal('').transform(() => null)])
      .optional()
      .nullable(),
    primaryPartnerId: z.string().min(1),
    managerId: z.string().min(1),
  })
  .refine(
    (v) => {
      if (!(v.startDate instanceof Date) || !(v.endDate instanceof Date)) return true;
      return v.endDate.getTime() > v.startDate.getTime();
    },
    { message: 'End date must be after start date', path: ['endDate'] },
  )
  .refine(
    (v) => {
      // Client engagements need a real client picked. Internal kind
      // resolves the client server-side, so we tolerate a missing /
      // empty `clientId` from the form.
      if (v.kind === 'client') return Boolean(v.clientId);
      return true;
    },
    { message: 'Client is required', path: ['clientId'] },
  )
  .refine(
    (v) => {
      // Internal projects must use an FHP-prefixed code so they
      // route to the right kanban band + skip P&L surfaces.
      if (v.kind === 'internal') return /^FHP\d{3,}$/.test(v.code);
      return true;
    },
    {
      message: 'Internal codes must look like FHP001, FHP002, …',
      path: ['code'],
    },
  );

export type NewProjectState =
  | { status: 'idle' }
  | { status: 'error'; message: string; fieldErrors?: Record<string, string> };

export async function createProject(
  _prev: NewProjectState,
  formData: FormData,
): Promise<NewProjectState> {
  const session = await getSession();
  try {
    requireCapability(session, 'project.create');
  } catch {
    return { status: 'error', message: 'Not authorized' };
  }

  const kindRaw = formData.get('kind');
  const kind: 'client' | 'internal' =
    kindRaw === 'internal' ? 'internal' : 'client';
  const raw = {
    kind,
    code: String(formData.get('code') ?? '').toUpperCase(),
    clientId: formData.get('clientId'),
    name: formData.get('name'),
    description: formData.get('description') || null,
    contractValueDollars: formData.get('contractValueDollars'),
    estimatedWeeks: formData.get('estimatedWeeks') ?? 0,
    startDate: formData.get('startDate') || null,
    endDate: formData.get('endDate') || null,
    primaryPartnerId: formData.get('primaryPartnerId'),
    managerId: formData.get('managerId'),
  };

  const parsed = ProjectCreate.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path.join('.');
      if (!fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return { status: 'error', message: 'Please fix the highlighted fields.', fieldErrors };
  }

  const data = parsed.data;

  const existingCode = await prisma.project.findUnique({ where: { code: data.code } });
  if (existingCode) {
    return {
      status: 'error',
      message: 'Code already in use.',
      fieldErrors: { code: 'Already used' },
    };
  }

  const contractValue = Math.round(data.contractValueDollars * 100);
  const fromDealIdRaw = formData.get('fromDealId');
  const fromDealId = typeof fromDealIdRaw === 'string' && fromDealIdRaw ? fromDealIdRaw : null;

  // Internal projects resolve to the FH internal client by code, not
  // by id from the form — so the operator never needs to pick a
  // client. If the FH client doesn't exist yet (seed never ran), the
  // create fails with a clear error rather than silently creating
  // an orphaned project.
  let resolvedClientId = data.clientId ?? null;
  if (data.kind === 'internal') {
    const fh = await prisma.client.findUnique({
      where: { code: 'FH' },
      select: { id: true },
    });
    if (!fh) {
      return {
        status: 'error',
        message:
          'The FH internal client doesn’t exist yet. Run scripts/seed-house-projects.ts and try again.',
      };
    }
    resolvedClientId = fh.id;
  }
  if (!resolvedClientId) {
    return {
      status: 'error',
      message: 'Client is required for client engagements.',
      fieldErrors: { clientId: 'Client is required' },
    };
  }
  const finalClientId: string = resolvedClientId;

  let newCode: string;
  let newProjectId: string;
  let clientCode: string;
  let clientName: string;
  try {
    ({ newCode, newProjectId, clientCode, clientName } = await prisma.$transaction(async (tx) => {
      const client = await tx.client.findUniqueOrThrow({
        where: { id: finalClientId },
        select: { code: true, legalName: true, tradingName: true },
      });
      const project = await tx.project.create({
        data: {
          code: data.code,
          clientId: finalClientId,
          name: data.name,
          description: data.description,
          contractValue,
          startDate: data.startDate instanceof Date ? data.startDate : null,
          endDate: data.endDate instanceof Date ? data.endDate : null,
          primaryPartnerId: data.primaryPartnerId,
          managerId: data.managerId,
          stage: 'kickoff',
        },
      });
      await writeAudit(tx, {
        actor: { type: 'person', id: session.person.id },
        action: 'created',
        entity: {
          type: 'project',
          id: project.id,
          after: {
            code: project.code,
            clientId: project.clientId,
            name: project.name,
            contractValue: project.contractValue,
            primaryPartnerId: project.primaryPartnerId,
            managerId: project.managerId,
            stage: project.stage,
          },
        },
        source: 'web',
      });

      // Auto-seed the project's budget skeleton so partners land on a
      // working draft instead of an empty "Initialise budget" CTA. The
      // 9 default lines mirror Foundry's FY26 governance template
      // (partner LT + manager + consultant + analyst + experts +
      // project resources + travel + meals). Internal FHP projects
      // skip the seed — their commercials are a different shape and
      // the Budget tab's "Initialise" CTA handles them with the
      // optional-budget flow.
      //
      // Weeks resolution priority:
      //   1. Operator-entered `estimatedWeeks` from the Commercials block
      //   2. Date-derived weeks (start → end) if both are set
      //   3. 12-week fallback (`defaultWeeksForProject`)
      const isInternalProject = project.code.startsWith('FHP');
      if (!isInternalProject) {
        const weeksFromForm =
          typeof data.estimatedWeeks === 'number' && data.estimatedWeeks > 0
            ? data.estimatedWeeks
            : null;
        const weeks =
          weeksFromForm ??
          defaultWeeksForProject(
            data.startDate instanceof Date ? data.startDate : null,
            data.endDate instanceof Date ? data.endDate : null,
          );
        const budget = await tx.projectBudget.create({
          data: {
            projectId: project.id,
            numberOfWeeks: weeks,
            totalFeeCents: contractValue,
            // FY26 governance defaults — partners can override on the
            // Budget tab. Same values the standalone "Initialise
            // budget" action uses, kept in lock-step so the two
            // entry points produce the same skeleton.
            opexContributionPct: 20,
            bdReferralPct: 0,
            bdReferralCapCents: 5_000_000,
            firmProfitPoolPct: 15,
            ltShareCount: 3,
          },
        });
        for (let i = 0; i < DEFAULT_BUDGET_LINES.length; i += 1) {
          const tmpl = DEFAULT_BUDGET_LINES[i]!;
          await tx.projectBudgetLine.create({
            data: {
              budgetId: budget.id,
              category: tmpl.category,
              description: tmpl.description,
              rateCents: tmpl.rateCents,
              unitsPerWeek: new Prisma.Decimal(tmpl.unitsPerWeek),
              weeks,
              comment: tmpl.comment,
              sortOrder: i,
            },
          });
        }
        await writeAudit(tx, {
          actor: { type: 'person', id: session.person.id },
          action: 'created',
          entity: {
            type: 'project_budget',
            id: budget.id,
            after: {
              projectId: project.id,
              seeded: 'default_template',
              via: 'project_create',
              lineCount: DEFAULT_BUDGET_LINES.length,
              weeks,
              fee: contractValue,
            },
          },
          source: 'web',
        });
      }
      // Project lifecycle feed entry. Notify the partner + manager
      // (de-duped — usually different) directly, plus the admin pool
      // for firm-wide visibility. The team-allocation flow handles
      // its own per-person emits when actual team members get added
      // on the next page, so we don't need to fan-out here.
      const directLeads = [project.primaryPartnerId, project.managerId]
        .filter((id, i, arr) => id && id !== session.person.id && arr.indexOf(id) === i);
      const isInternal = project.code.startsWith('FHP');
      const projectKindLabel = isInternal ? 'Internal project' : 'Project';
      await emitUserUpdateMany(tx, directLeads, {
        kind: 'project_created',
        title: `${projectKindLabel} ${project.code} created — you're leading`,
        body: project.name,
        href: `/projects/${project.code}`,
        entityType: 'project',
        entityId: project.id,
      });
      await notifyAdminPool(tx, {
        actorPersonId: session.person.id,
        kind: 'project_created',
        title: `${projectKindLabel} created · ${project.code}`,
        body: `${project.name}${isInternal ? '' : ` · ${formatProjectAdminBody(project.contractValue)}`}`,
        href: `/projects/${project.code}`,
        entityType: 'project',
        entityId: project.id,
      });
      // If this project came from a deal, link them and stamp the won stage.
      if (fromDealId) {
        const deal = await tx.deal.findUnique({ where: { id: fromDealId } });
        if (deal && !deal.convertedProjectId) {
          await tx.deal.update({
            where: { id: fromDealId },
            data: {
              convertedProjectId: project.id,
              stage: deal.stage === 'won' ? deal.stage : 'won',
            },
          });
          await writeAudit(tx, {
            actor: { type: 'person', id: session.person.id },
            action: 'converted_to_project',
            entity: {
              type: 'deal',
              id: fromDealId,
              before: {
                stage: deal.stage,
                convertedProjectId: deal.convertedProjectId,
              },
              after: {
                stage: 'won',
                convertedProjectId: project.id,
                projectCode: project.code,
              },
            },
            source: 'web',
          });
        }
      }
      return {
        newCode: project.code,
        newProjectId: project.id,
        clientCode: client.code,
        clientName: client.tradingName ?? client.legalName,
      };
    }));
  } catch (err) {
    console.error('[project.create] failed:', err);
    return { status: 'error', message: 'Create failed — try again.' };
  }

  // SharePoint folder provisioning (best-effort; if it fails we don't roll back
  // the project — surfaces as a "Provision SharePoint" button on the Files tab
  // for retry).
  try {
    const result = await provisionProjectFolder(clientCode, clientName, newCode);
    if (result) {
      await prisma.project.update({
        where: { id: newProjectId },
        data: {
          sharepointFolderUrl: result.teamUrl,
          sharepointAdminFolderUrl: result.adminUrl,
        },
      });
    }
  } catch (err) {
    console.error('[project.create] SharePoint provisioning failed:', err);
  }

  // Xero tracking-category option — best-effort; retry button on the project
  // detail page if Xero isn't connected yet or the API is flaky.
  try {
    const xeroRow = await getXeroIntegration();
    if (xeroRow?.status === 'connected') {
      await ensureProjectTrackingOption(newProjectId);
    }
  } catch (err) {
    console.error('[project.create] Xero tracking-category provisioning failed:', err);
  }

  revalidatePath('/projects');
  if (fromDealId) {
    revalidatePath('/bd');
    revalidatePath(`/bd/${fromDealId}`);
  }
  // Client engagements: land on the Budget tab so the partner sees
  // the auto-seeded skeleton immediately and can refine rates / units
  // / weeks before kicking off. Internal FHP projects don't get a
  // seeded budget — they go to the default Overview tab.
  const landingTab = data.kind === 'internal' ? 'overview' : 'budget';
  redirect(`/projects/${newCode}?tab=${landingTab}`);
}

/**
 * Compact contract-value chip for the admin-pool feed body. Keeps
 * the digits short ($1.2m / $850k / $0) so the feed entry stays a
 * single line on the dashboard card.
 */
function formatProjectAdminBody(contractValueCents: number): string {
  const dollars = contractValueCents / 100;
  if (Math.abs(dollars) >= 1_000_000)
    return `$${(dollars / 1_000_000).toFixed(1)}m contract`;
  if (Math.abs(dollars) >= 1_000)
    return `$${Math.round(dollars / 1_000)}k contract`;
  if (dollars > 0) return `$${Math.round(dollars)} contract`;
  return 'no contract value';
}
