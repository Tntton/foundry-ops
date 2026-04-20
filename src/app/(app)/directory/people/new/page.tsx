import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSession } from '@/server/session';
import { hasCapability } from '@/server/capabilities';
import { optionalEnv } from '@/server/env';
import { currentRatesByCode } from '@/server/rate-card';
import { NewPersonForm } from './form';

export default async function NewPersonPage() {
  const session = await getSession();
  if (!hasCapability(session, 'person.create')) notFound();

  const provisioningOn = optionalEnv('ENABLE_PROVISIONING') === '1';
  const ratesByCode = await currentRatesByCode();

  return (
    <div className="space-y-6">
      <div className="text-sm">
        <Link href="/directory" className="text-ink-3 hover:text-ink">
          ← Back to Directory
        </Link>
      </div>
      <header>
        <h1 className="text-xl font-semibold text-ink">New person</h1>
        <p className="text-sm text-ink-3">
          Creates the Person record + audit event.{' '}
          <span className="text-status-red">*</span> marks mandatory fields.
        </p>
      </header>
      <NewPersonForm provisioningOn={provisioningOn} ratesByCode={ratesByCode} />
    </div>
  );
}
