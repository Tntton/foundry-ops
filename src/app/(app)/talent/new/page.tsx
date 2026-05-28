import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSession } from '@/server/session';
import { hasCapability } from '@/server/capabilities';
import { prisma } from '@/server/db';
import { NewRecruitForm } from './form';

export default async function NewRecruitPage() {
  const session = await getSession();
  if (!session || !hasCapability(session, 'recruit.manage')) notFound();

  // Owner picker = anyone in the firm who can sensibly drive a recruit
  // conversation: partners, APs, admins, super_admins. Excludes inactive
  // people so a leaver doesn't get assigned a new prospect.
  // Mirrors the `recruit.manage` capability list — anyone who can
  // see the pipeline can also be assigned as an owner. Managers
  // included since they often drive sourcing conversations through
  // their networks.
  const owners = await prisma.person.findMany({
    where: {
      inactiveAt: null,
      OR: [
        { roles: { has: 'super_admin' } },
        { roles: { has: 'admin' } },
        { roles: { has: 'partner' } },
        { roles: { has: 'associate_partner' } },
        { roles: { has: 'manager' } },
      ],
    },
    orderBy: [{ band: 'asc' }, { lastName: 'asc' }],
    select: { id: true, firstName: true, lastName: true, band: true },
  });

  // Referrer picker = any active person (a referral can come from
  // anyone — staff intros a fellow consultant, partner intros a
  // C-suite candidate). Inactives excluded.
  const referrers = await prisma.person.findMany({
    where: { inactiveAt: null },
    orderBy: [{ firstName: 'asc' }],
    select: { id: true, firstName: true, lastName: true },
  });

  return (
    <div className="space-y-6">
      <div className="text-sm">
        <Link href="/talent" className="text-ink-3 hover:text-ink">
          ← Back to Talent pipeline
        </Link>
      </div>
      <header>
        <h1 className="text-xl font-semibold text-ink">New prospect</h1>
        <p className="text-sm text-ink-3">
          Add a prospective hire. The card lands in the matching pool on
          the kanban; promote to a Person record from the detail page
          when they accept.
        </p>
      </header>
      <NewRecruitForm
        owners={owners.map((o) => ({
          id: o.id,
          firstName: o.firstName,
          lastName: o.lastName,
          band: o.band ?? null,
        }))}
        referrers={referrers}
        defaultOwnerId={session.person.id}
      />
    </div>
  );
}
