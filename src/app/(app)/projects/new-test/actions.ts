'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { getSession } from '@/server/session';
import { writeAudit } from '@/server/audit';
import { TEST_PROJECT_PREFIX } from '@/server/test-projects';

export type NewTestProjectState =
  | { status: 'idle' }
  | { status: 'error'; message: string };

const TestCreate = z.object({
  name: z.string().trim().min(3).max(200),
});

/**
 * Self-service practice-project creation — open to ANY signed-in
 * person (staff included), unlike the main /projects/new flow which
 * needs project.create. Guard rails that make this safe to open up:
 *
 *   - Code is server-assigned (next free TST###) — the caller can't
 *     pick an arbitrary code, so nothing lands outside the TST*
 *     sandbox convention.
 *   - Client is pinned to the TST sandbox client.
 *   - Contract value is 0; TST* is excluded from P&L / utilisation /
 *     revenue reports anyway (src/server/test-projects.ts).
 *   - No SharePoint folder, no Xero tracking category, no budget
 *     seed, no admin-pool notifications — practice projects leave no
 *     side-effects outside the app.
 *   - Creator becomes manager + team member, so their timesheet grid
 *     pre-adds the row and they can practice manager surfaces on
 *     their own sandbox.
 */
export async function createTestProject(
  _prev: NewTestProjectState,
  formData: FormData,
): Promise<NewTestProjectState> {
  const session = await getSession();
  if (!session) return { status: 'error', message: 'Not signed in' };

  const parsed = TestCreate.safeParse({ name: formData.get('name') });
  if (!parsed.success) {
    return { status: 'error', message: 'Give the practice project a name (3+ characters).' };
  }

  const testClient = await prisma.client.findUnique({
    where: { code: TEST_PROJECT_PREFIX },
    select: { id: true, primaryPartnerId: true },
  });
  if (!testClient) {
    return {
      status: 'error',
      message:
        'The TST sandbox client doesn’t exist yet — ask an admin to create it (Directory → Clients → New, code TST).',
    };
  }

  // Next free TST code. Codes are TST001, TST002, … — zero-padded to
  // three digits, growing naturally past 999.
  const last = await prisma.project.findFirst({
    where: { code: { startsWith: TEST_PROJECT_PREFIX } },
    orderBy: { code: 'desc' },
    select: { code: true },
  });
  const m = last?.code.match(/^TST(\d{3,})$/);
  const nextNum = m ? Number(m[1]) + 1 : 1;
  const code = `TST${String(nextNum).padStart(3, '0')}`;

  let created: { code: string };
  try {
    created = await prisma.$transaction(async (tx) => {
      const project = await tx.project.create({
        data: {
          code,
          clientId: testClient.id,
          name: parsed.data.name,
          description: `Practice sandbox created by ${session.person.firstName} ${session.person.lastName}. Excluded from P&L and utilisation. Safe to fill with junk.`,
          contractValue: 0,
          stage: 'delivery',
          // Leadership requirement on primaryPartner — inherit the
          // sandbox client's partner (TT). The creator runs it as
          // manager regardless of their role.
          primaryPartnerId: testClient.primaryPartnerId,
          managerId: session.person.id,
          startDate: new Date(),
        },
        select: { id: true, code: true },
      });
      await tx.projectTeam.create({
        data: {
          projectId: project.id,
          personId: session.person.id,
          roleOnProject: 'Practice',
          allocationPct: 0,
        },
      });
      await writeAudit(tx, {
        actor: { type: 'person', id: session.person.id },
        action: 'created',
        entity: {
          type: 'project',
          id: project.id,
          after: { code: project.code, via: 'test_project_self_service' },
        },
        source: 'web',
      });
      return { code: project.code };
    });
  } catch (err) {
    console.error('[project.createTest] failed:', err);
    return { status: 'error', message: 'Create failed — try again.' };
  }

  revalidatePath('/projects');
  redirect(`/projects/${created.code}`);
}
