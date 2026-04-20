import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSession } from '@/server/session';
import { hasCapability } from '@/server/capabilities';
import { NewRateCardForm } from './form';

export default async function NewRateCardPage() {
  const session = await getSession();
  if (!session) notFound();
  if (!hasCapability(session, 'ratecard.edit')) notFound();

  return (
    <div className="space-y-6">
      <div className="text-sm">
        <Link href="/admin/rate-card" className="text-ink-3 hover:text-ink">
          ← Back to Rate card
        </Link>
      </div>
      <header>
        <h1 className="text-xl font-semibold text-ink">New rate card version</h1>
        <p className="text-sm text-ink-3">
          Creates a new versioned row for the given role code + effective date. Historical
          rows are never mutated; the &ldquo;Active as of&rdquo; date on the main view
          selects which row applies at any point in time.
        </p>
      </header>
      <NewRateCardForm />
    </div>
  );
}
