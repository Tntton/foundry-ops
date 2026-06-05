import { z } from 'zod';
import { prisma } from '@/server/db';
import type { ToolDefinition } from './types';

const Input = z.object({}).optional();

export const listMyApprovals: ToolDefinition<z.infer<typeof Input>> = {
  spec: {
    name: 'list_my_approvals',
    description:
      'List approvals pending the current user (where the requiredRole is one of their roles). Returns up to 25 rows — each with subject type, subject id, amount in dollars where applicable, and how long it has been pending.',
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
  async run(ctx) {
    const roles = ctx.session.person.roles;
    if (roles.length === 0) return { rows: [] };
    const rows = await prisma.approval.findMany({
      where: { status: 'pending', requiredRole: { in: roles } },
      orderBy: { createdAt: 'asc' },
      take: 25,
      select: {
        id: true,
        subjectType: true,
        subjectId: true,
        requiredRole: true,
        createdAt: true,
      },
    });
    return {
      rows: rows.map((r) => ({
        id: r.id,
        subjectType: r.subjectType,
        subjectId: r.subjectId,
        requiredRole: r.requiredRole,
        pendingSince: r.createdAt.toISOString(),
        link: `/approvals#${r.id}`,
      })),
      count: rows.length,
    };
  },
};
