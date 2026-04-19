import { NextResponse } from 'next/server';
import { getSession } from '@/server/session';
import { hasCapability } from '@/server/capabilities';
import { prisma } from '@/server/db';

const MAX_LIMIT = 500;
const DEFAULT_LIMIT = 100;

export async function GET(req: Request) {
  const session = await getSession();
  if (!hasCapability(session, 'auditlog.view')) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const url = new URL(req.url);
  const actorId = url.searchParams.get('actorId') ?? undefined;
  const entityType = url.searchParams.get('entityType') ?? undefined;
  const entityId = url.searchParams.get('entityId') ?? undefined;
  const fromParam = url.searchParams.get('from');
  const toParam = url.searchParams.get('to');
  const limitParam = url.searchParams.get('limit');

  const from = fromParam ? new Date(fromParam) : undefined;
  const to = toParam ? new Date(toParam) : undefined;
  if ((from && Number.isNaN(from.getTime())) || (to && Number.isNaN(to.getTime()))) {
    return NextResponse.json({ error: 'invalid date' }, { status: 400 });
  }

  const limit = Math.min(
    Math.max(Number(limitParam ?? DEFAULT_LIMIT), 1) || DEFAULT_LIMIT,
    MAX_LIMIT,
  );

  const dateFilter =
    from || to
      ? { at: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } }
      : {};

  const events = await prisma.auditEvent.findMany({
    where: {
      ...(actorId ? { actorId } : {}),
      ...(entityType ? { entityType } : {}),
      ...(entityId ? { entityId } : {}),
      ...dateFilter,
    },
    orderBy: { at: 'desc' },
    take: limit,
    include: {
      actor: {
        select: { id: true, initials: true, firstName: true, lastName: true, email: true },
      },
    },
  });

  return NextResponse.json({ events, limit });
}
