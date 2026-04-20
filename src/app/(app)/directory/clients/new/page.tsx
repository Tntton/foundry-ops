import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSession } from '@/server/session';
import { hasCapability } from '@/server/capabilities';
import { listPartnerOptions } from '@/server/clients';
import { NewClientForm } from './form';

export default async function NewClientPage() {
  const session = await getSession();
  if (!hasCapability(session, 'client.create')) notFound();

  const partners = await listPartnerOptions();

  return (
    <div className="space-y-6">
      <div className="text-sm">
        <Link href="/directory/clients" className="text-ink-3 hover:text-ink">
          ← Back to Clients
        </Link>
      </div>
      <header>
        <h1 className="text-xl font-semibold text-ink">New client</h1>
        <p className="text-sm text-ink-3">
          Creates the Client record. If Xero is connected, a Xero contact is created too (best-effort — re-sync any time from the detail page).
        </p>
      </header>
      <NewClientForm partners={partners} />
    </div>
  );
}
