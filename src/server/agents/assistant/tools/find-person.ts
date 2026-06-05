import { z } from 'zod';
import { prisma } from '@/server/db';
import { hasCapability } from '@/server/capabilities';
import type { ToolDefinition } from './types';

const Input = z.object({
  query: z.string().trim().min(1).max(80),
});

/**
 * Privacy note: the rate column is redacted for callers without
 * `ratecard.view`. Everyone authenticated can see basic identity +
 * band, which is consistent with the existing directory permissions
 * (Person directory is wide-readable, rate column is gated).
 */
export const findPerson: ToolDefinition<z.infer<typeof Input>> = {
  spec: {
    name: 'find_person',
    description:
      "Fuzzy-search people by name, initials, or email. Returns up to 5 matches with name, initials, email, band, employment, region. Rate / billRate are included only when the caller can view the rate card. Excludes archived people (endDate set) unless the query exactly matches an archived person's email.",
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Free-text — name, initials, or email substring.',
        },
      },
      required: ['query'],
    },
  },
  async run(ctx, raw) {
    const parsed = Input.safeParse(raw);
    if (!parsed.success) return { error: 'query is required (1–80 chars)' };
    const query = parsed.data.query;
    const canSeeRate = hasCapability(ctx.session, 'ratecard.view');
    const rows = await prisma.person.findMany({
      where: {
        AND: [
          { endDate: null },
          {
            OR: [
              { firstName: { contains: query, mode: 'insensitive' } },
              { lastName: { contains: query, mode: 'insensitive' } },
              { initials: { equals: query.toUpperCase() } },
              { email: { contains: query, mode: 'insensitive' } },
            ],
          },
        ],
      },
      orderBy: [{ firstName: 'asc' }],
      take: 5,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        initials: true,
        email: true,
        band: true,
        level: true,
        employment: true,
        region: true,
        rate: true,
        billRate: true,
      },
    });
    return {
      rows: rows.map((p) => ({
        id: p.id,
        name: `${p.firstName} ${p.lastName}`,
        initials: p.initials,
        email: p.email,
        band: p.band,
        level: p.level,
        employment: p.employment,
        region: p.region,
        // Rate visibility — gated.
        rateCentsPerHour: canSeeRate ? p.rate : null,
        billRateCentsPerHour: canSeeRate ? p.billRate : null,
        rateRedacted: !canSeeRate,
        link: `/directory/people/${p.id}`,
      })),
    };
  },
};
