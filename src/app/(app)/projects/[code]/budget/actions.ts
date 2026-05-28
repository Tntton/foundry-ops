'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { Prisma, type ProjectBudgetCategory } from '@prisma/client';
import { prisma } from '@/server/db';
import { getSession } from '@/server/session';
import { hasAnyRole } from '@/server/roles';
import { writeAudit } from '@/server/audit';
import { DEFAULT_BUDGET_LINES, defaultWeeksForProject } from '@/server/projects/budget';

export type BudgetSaveState =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | { status: 'success' };

const CategoryEnum = z.enum([
  'partner_lt',
  'manager',
  'consultant',
  'analyst',
  'expert_paid',
  'project_resources',
  'travel',
  'meals',
  'other',
]);

const LineSchema = z.object({
  id: z.string().optional(),
  category: CategoryEnum,
  description: z.string().trim().min(1).max(200),
  rateCents: z.coerce.number().int().min(0).max(2_000_000_00), // up to $2M/unit
  unitsPerWeek: z.coerce.number().min(0).max(168), // hrs in a week ceiling
  weeks: z.coerce.number().int().min(0).max(520),
  comment: z.string().trim().max(2000).nullable().optional(),
});

const RootSchema = z.object({
  numberOfWeeks: z.coerce.number().int().min(1).max(520),
  totalFeeCents: z.coerce.number().int().min(0),
  opexContributionPct: z.coerce.number().int().min(0).max(100),
  bdReferralPct: z.coerce.number().int().min(0).max(100),
  bdReferralCapCents: z.coerce.number().int().min(0),
  firmProfitPoolPct: z.coerce.number().int().min(0).max(100),
  ltShareCount: z.coerce.number().int().min(1).max(20),
  notes: z.string().trim().max(4000).nullable().optional(),
  lines: z.array(LineSchema).max(80),
});

/**
 * Authorization gate — admin/super_admin can edit any project budget;
 * the project's primary partner or manager can edit theirs. Same gate
 * as the team-edit action so partners don't have to learn two rules.
 */
async function gateProject(
  projectId: string,
):
  Promise<
    | { ok: true; code: string; primaryPartnerId: string; managerId: string }
    | { ok: false; message: string }
  > {
  const session = await getSession();
  if (!session) return { ok: false, message: 'Not signed in' };
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      code: true,
      primaryPartnerId: true,
      managerId: true,
    },
  });
  if (!project) return { ok: false, message: 'Project not found' };
  const isAdmin = hasAnyRole(session, ['super_admin', 'admin']);
  const isLead =
    project.primaryPartnerId === session.person.id ||
    project.managerId === session.person.id;
  if (!isAdmin && !isLead) {
    return { ok: false, message: 'Only admin / partner / manager can edit the budget.' };
  }
  return { ok: true, ...project };
}

export async function saveProjectBudget(
  projectId: string,
  _prev: BudgetSaveState,
  formData: FormData,
): Promise<BudgetSaveState> {
  const session = await getSession();
  if (!session) return { status: 'error', message: 'Not signed in' };

  const gated = await gateProject(projectId);
  if (!gated.ok) return { status: 'error', message: gated.message };

  // Lines come in as parallel arrays — same pattern as the team-edit
  // action, so the form can use plain repeated input names.
  const ids = formData.getAll('lineId').map(String);
  const cats = formData.getAll('lineCategory').map(String);
  const descs = formData.getAll('lineDescription').map(String);
  const rates = formData.getAll('lineRateCents').map(String);
  const units = formData.getAll('lineUnitsPerWeek').map(String);
  const weeks = formData.getAll('lineWeeks').map(String);
  const comments = formData.getAll('lineComment').map(String);

  const lines = ids.map((id, i) => ({
    id: id || undefined,
    category: cats[i] ?? 'other',
    description: descs[i] ?? '',
    rateCents: rates[i] ?? '0',
    unitsPerWeek: units[i] ?? '0',
    weeks: weeks[i] ?? '0',
    comment: (comments[i] ?? '').trim() || null,
  }));

  const parsed = RootSchema.safeParse({
    numberOfWeeks: formData.get('numberOfWeeks'),
    totalFeeCents: formData.get('totalFeeCents'),
    opexContributionPct: formData.get('opexContributionPct'),
    bdReferralPct: formData.get('bdReferralPct'),
    bdReferralCapCents: formData.get('bdReferralCapCents'),
    firmProfitPoolPct: formData.get('firmProfitPoolPct'),
    ltShareCount: formData.get('ltShareCount'),
    notes: ((formData.get('notes') as string | null) ?? '').trim() || null,
    lines,
  });
  if (!parsed.success) {
    return {
      status: 'error',
      message: parsed.error.issues[0]?.message ?? 'Invalid input',
    };
  }
  const data = parsed.data;

  try {
    await prisma.$transaction(async (tx) => {
      const before = await tx.projectBudget.findUnique({
        where: { projectId },
        include: { lines: true },
      });

      const budget = await tx.projectBudget.upsert({
        where: { projectId },
        create: {
          projectId,
          numberOfWeeks: data.numberOfWeeks,
          totalFeeCents: data.totalFeeCents,
          opexContributionPct: data.opexContributionPct,
          bdReferralPct: data.bdReferralPct,
          bdReferralCapCents: data.bdReferralCapCents,
          firmProfitPoolPct: data.firmProfitPoolPct,
          ltShareCount: data.ltShareCount,
          notes: data.notes ?? null,
        },
        update: {
          numberOfWeeks: data.numberOfWeeks,
          totalFeeCents: data.totalFeeCents,
          opexContributionPct: data.opexContributionPct,
          bdReferralPct: data.bdReferralPct,
          bdReferralCapCents: data.bdReferralCapCents,
          firmProfitPoolPct: data.firmProfitPoolPct,
          ltShareCount: data.ltShareCount,
          notes: data.notes ?? null,
        },
      });

      // Replace-all strategy: delete lines that are no longer present,
      // upsert (by id) those that are. Keeps id stability for unchanged
      // rows so audit deltas are clean.
      const beforeIds = new Set((before?.lines ?? []).map((l) => l.id));
      const afterIds = new Set(
        data.lines.map((l) => l.id).filter((x): x is string => !!x),
      );
      for (const existingId of beforeIds) {
        if (!afterIds.has(existingId)) {
          await tx.projectBudgetLine.delete({ where: { id: existingId } });
        }
      }
      for (let i = 0; i < data.lines.length; i += 1) {
        const l = data.lines[i]!;
        const dec = new Prisma.Decimal(l.unitsPerWeek);
        const payload = {
          category: l.category as ProjectBudgetCategory,
          description: l.description,
          rateCents: Math.round(l.rateCents),
          unitsPerWeek: dec,
          weeks: Math.round(l.weeks),
          comment: l.comment ?? null,
          sortOrder: i,
        };
        if (l.id && beforeIds.has(l.id)) {
          await tx.projectBudgetLine.update({
            where: { id: l.id },
            data: payload,
          });
        } else {
          await tx.projectBudgetLine.create({
            data: { budgetId: budget.id, ...payload },
          });
        }
      }

      await writeAudit(tx, {
        actor: { type: 'person', id: session.person.id },
        action: before ? 'updated' : 'created',
        entity: {
          type: 'project_budget',
          id: budget.id,
          before: before
            ? {
                fee: before.totalFeeCents,
                opexPct: before.opexContributionPct,
                bdPct: before.bdReferralPct,
                profitPoolPct: before.firmProfitPoolPct,
                lineCount: before.lines.length,
              }
            : null,
          after: {
            projectId,
            fee: data.totalFeeCents,
            opexPct: data.opexContributionPct,
            bdPct: data.bdReferralPct,
            profitPoolPct: data.firmProfitPoolPct,
            lineCount: data.lines.length,
          },
        },
        source: 'web',
      });
    });
  } catch (err) {
    console.error('[project-budget.save] failed:', err);
    return { status: 'error', message: 'Save failed — try again.' };
  }

  revalidatePath(`/projects/${gated.code}`);
  revalidatePath('/pnl');
  return { status: 'success' };
}

/**
 * One-click "Initialise budget" — seeds the 8 default lines from the
 * template (matching the FY26 prototype) using the project's contract
 * value and date range. Idempotent: returns early if a budget already
 * exists for the project.
 */
export async function initialiseProjectBudget(
  projectId: string,
  _prev: BudgetSaveState,
  _formData: FormData,
): Promise<BudgetSaveState> {
  const session = await getSession();
  if (!session) return { status: 'error', message: 'Not signed in' };

  const gated = await gateProject(projectId);
  if (!gated.ok) return { status: 'error', message: gated.message };

  const existing = await prisma.projectBudget.findUnique({
    where: { projectId },
  });
  if (existing) {
    return {
      status: 'error',
      message: 'Budget already initialised — edit it inline.',
    };
  }

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { contractValue: true, startDate: true, endDate: true },
  });
  if (!project) return { status: 'error', message: 'Project not found' };

  const weeks = defaultWeeksForProject(project.startDate, project.endDate);

  try {
    await prisma.$transaction(async (tx) => {
      const budget = await tx.projectBudget.create({
        data: {
          projectId,
          numberOfWeeks: weeks,
          totalFeeCents: project.contractValue,
          // Defaults match FY26 governance — partners can override
          // before saving.
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
            projectId,
            seeded: 'default_template',
            lineCount: DEFAULT_BUDGET_LINES.length,
            weeks,
            fee: project.contractValue,
          },
        },
        source: 'web',
      });
    });
  } catch (err) {
    console.error('[project-budget.init] failed:', err);
    return { status: 'error', message: 'Initialise failed — try again.' };
  }

  revalidatePath(`/projects/${gated.code}`);
  return { status: 'success' };
}
