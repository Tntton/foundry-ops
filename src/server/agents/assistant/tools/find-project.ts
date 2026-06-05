import { z } from 'zod';
import { prisma } from '@/server/db';
import type { ToolDefinition } from './types';

const Input = z.object({
  query: z.string().trim().min(1).max(80),
});

export const findProject: ToolDefinition<z.infer<typeof Input>> = {
  spec: {
    name: 'find_project',
    description:
      "Fuzzy-search projects by code or name. Returns up to 5 matches with id / code / name / client / stage — used to disambiguate when the user names a project (e.g. 'CAC') and downstream prefill needs the canonical project. Excludes archived projects from results unless the query exactly matches an archived code.",
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Free-text search — project code, partial name, or initials.',
        },
      },
      required: ['query'],
    },
  },
  async run(_ctx, raw) {
    const parsed = Input.safeParse(raw);
    if (!parsed.success) return { error: 'query is required (1–80 chars)' };
    const query = parsed.data.query;
    const upper = query.toUpperCase();
    // Exact-code match wins — surface that first regardless of stage so
    // archived-but-named projects don't vanish.
    const exact = await prisma.project.findUnique({
      where: { code: upper },
      select: {
        id: true,
        code: true,
        name: true,
        stage: true,
        client: { select: { code: true, legalName: true } },
      },
    });

    const fuzzy = await prisma.project.findMany({
      where: {
        AND: [
          { stage: { not: 'archived' } },
          {
            OR: [
              { code: { contains: upper, mode: 'insensitive' } },
              { name: { contains: query, mode: 'insensitive' } },
            ],
          },
        ],
      },
      orderBy: [{ stage: 'asc' }, { code: 'asc' }],
      take: 5,
      select: {
        id: true,
        code: true,
        name: true,
        stage: true,
        client: { select: { code: true, legalName: true } },
      },
    });
    // Dedupe — if exact match was also in fuzzy results, only keep it once.
    const seen = new Set<string>();
    const ordered = [exact, ...fuzzy].filter(
      (p): p is NonNullable<typeof p> => {
        if (!p) return false;
        if (seen.has(p.id)) return false;
        seen.add(p.id);
        return true;
      },
    );
    return {
      rows: ordered.slice(0, 5).map((p) => ({
        id: p.id,
        code: p.code,
        name: p.name,
        stage: p.stage,
        clientCode: p.client.code,
        clientName: p.client.legalName,
        link: `/projects/${p.code}`,
      })),
    };
  },
};
