import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSession } from '@/server/session';
import { NewTestProjectForm } from './form';

/**
 * Self-service practice project — open to every signed-in person.
 * One field, one click, lands on a fresh TST### sandbox they manage.
 */
export default async function NewTestProjectPage() {
  const session = await getSession();
  if (!session) notFound();

  return (
    <div className="max-w-xl space-y-6">
      <div className="text-sm">
        <Link href="/projects" className="text-ink-3 hover:text-ink">
          ← Back to Projects
        </Link>
      </div>
      <header>
        <h1 className="text-xl font-semibold text-ink">New practice project</h1>
        <p className="text-sm text-ink-3">
          Creates the next TST-coded sandbox with you as manager. Use it
          to practise timesheets, expenses, approvals, or anything else —
          test data on TST projects is excluded from the firm P&amp;L and
          utilisation, so you can&apos;t break the numbers.
        </p>
      </header>
      <NewTestProjectForm
        defaultName={`Practice — ${session.person.firstName}`}
      />
    </div>
  );
}
