import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSession } from '@/server/session';
import { hasCapability } from '@/server/capabilities';
import { prisma } from '@/server/db';
import { NewDealForm } from './form';

export default async function NewDealPage({
  searchParams,
}: {
  searchParams: { clientId?: string };
}) {
  const session = await getSession();
  if (!hasCapability(session, 'deal.create')) notFound();

  const [clients, owners] = await Promise.all([
    prisma.client.findMany({
      orderBy: { code: 'asc' },
      select: { id: true, code: true, legalName: true },
    }),
    prisma.person.findMany({
      where: {
        endDate: null,
        roles: { hasSome: ['super_admin', 'admin', 'partner'] },
      },
      orderBy: [{ band: 'asc' }, { lastName: 'asc' }],
      select: { id: true, initials: true, headshotUrl: true, firstName: true, lastName: true },
    }),
  ]);

  // Pre-select the client when arriving from the client detail page's
  // "+ New deal" cross-link (?clientId=…). Falls back to empty if the
  // query param isn't a known client.
  const defaultClientId =
    searchParams.clientId &&
    clients.some((c) => c.id === searchParams.clientId)
      ? searchParams.clientId
      : null;

  return (
    <div className="space-y-6">
      <div className="text-sm">
        <Link href="/bd" className="text-ink-3 hover:text-ink">
          ← Back to BD pipeline
        </Link>
      </div>
      <header>
        <h1 className="text-xl font-semibold text-ink">New deal</h1>
        <p className="text-sm text-ink-3">
          Add an opportunity to the pipeline. Weighted value auto-calcs from expected ×
          probability.
        </p>
      </header>
      <NewDealForm clients={clients} owners={owners} defaultClientId={defaultClientId} />
    </div>
  );
}
