import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSession } from '@/server/session';
import { hasCapability } from '@/server/capabilities';
import { getPerson } from '@/server/directory';
import { PersonEditForm } from './form';

export default async function PersonEditPage({ params }: { params: { id: string } }) {
  const session = await getSession();
  if (!hasCapability(session, 'person.edit')) notFound();

  const person = await getPerson(params.id);
  if (!person) notFound();

  return (
    <div className="space-y-6">
      <div className="text-sm">
        <Link href={`/directory/people/${person.id}`} className="text-ink-3 hover:text-ink">
          ← Back to {person.firstName} {person.lastName}
        </Link>
      </div>
      <header>
        <h1 className="text-xl font-semibold text-ink">
          Edit {person.firstName} {person.lastName}
        </h1>
        <p className="text-sm text-ink-3">
          Changes are audited. Email and initials are not editable here.
        </p>
      </header>
      <PersonEditForm person={person} />
    </div>
  );
}
