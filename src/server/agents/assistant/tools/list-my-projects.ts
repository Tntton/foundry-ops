import { prisma } from '@/server/db';
import type { ToolDefinition } from './types';

export const listMyProjects: ToolDefinition = {
  spec: {
    name: 'list_my_projects',
    description:
      "List projects the current user is on (team membership) or leads (primary partner / project manager). Returns id, code, name, client code, and stage so the assistant can use the code as a prefill reference downstream. Excludes archived projects.",
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
  async run(ctx) {
    const personId = ctx.session.person.id;
    const projects = await prisma.project.findMany({
      where: {
        AND: [
          { stage: { not: 'archived' } },
          {
            OR: [
              { team: { some: { personId } } },
              { primaryPartnerId: personId },
              { managerId: personId },
            ],
          },
        ],
      },
      orderBy: [{ stage: 'asc' }, { code: 'asc' }],
      take: 40,
      select: {
        id: true,
        code: true,
        name: true,
        stage: true,
        client: { select: { code: true, legalName: true } },
      },
    });
    return {
      rows: projects.map((p) => ({
        id: p.id,
        code: p.code,
        name: p.name,
        stage: p.stage,
        clientCode: p.client.code,
        clientName: p.client.legalName,
        link: `/projects/${p.code}`,
      })),
      count: projects.length,
    };
  },
};
