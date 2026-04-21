import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSession } from '@/server/session';
import { hasCapability } from '@/server/capabilities';
import { prisma } from '@/server/db';
import { decryptText, last4 } from '@/server/crypto';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { BankDetailsForm } from './form';

export default async function BankDetailsPage({
  params,
}: {
  params: { id: string };
}) {
  const session = await getSession();
  // Gate on person.edit — same capability as general person editing. Bank
  // details are a sensitive sub-surface inside Person edit.
  if (!hasCapability(session, 'person.edit')) notFound();

  const person = await prisma.person.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      initials: true,
      email: true,
      employment: true,
      bankBsb: true,
      bankAcc: true,
    },
  });
  if (!person) notFound();

  // Decrypt stored values just long enough to compute a last-4 hint; never
  // render the full values.
  let bsbLast4: string | null = null;
  let accLast4: string | null = null;
  try {
    if (person.bankBsb) bsbLast4 = last4(decryptText(person.bankBsb));
    if (person.bankAcc) accLast4 = last4(decryptText(person.bankAcc));
  } catch (err) {
    console.error('[person.bank] decrypt failed — key may have rotated:', err);
  }

  return (
    <div className="space-y-6">
      <div className="text-sm">
        <Link
          href={`/directory/people/${person.id}`}
          className="text-ink-3 hover:text-ink"
        >
          ← Back to {person.firstName} {person.lastName}
        </Link>
      </div>

      <header>
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold text-ink">
            Bank details — {person.firstName} {person.lastName}
          </h1>
          <Badge variant={person.employment === 'contractor' ? 'blue' : 'green'}>
            {person.employment === 'contractor' ? 'Contractor' : 'Full-time'}
          </Badge>
        </div>
        <p className="text-sm text-ink-3">
          Encrypted at rest with AES-256-GCM (key derived from AUTH_SECRET).
          Only the last-4 of each value is ever shown in the UI.
        </p>
      </header>

      {person.employment !== 'contractor' && (
        <div className="rounded-md border border-status-amber bg-status-amber-soft px-3 py-2 text-sm text-status-amber">
          Full-time payroll runs through the HR system, not ABA pay-runs. Bank details here
          are only used when this person is paid as a contractor via the Bills flow.
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Current</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-[120px_1fr] gap-2 text-sm">
          <div className="text-ink-3">BSB</div>
          <div className="font-mono text-ink">
            {bsbLast4 ? `••• ${bsbLast4.slice(-3)}` : <span className="text-ink-3">—</span>}
          </div>
          <div className="text-ink-3">Account</div>
          <div className="font-mono text-ink">
            {accLast4 ? `•••• ${accLast4}` : <span className="text-ink-3">—</span>}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Update</CardTitle>
        </CardHeader>
        <CardContent>
          <BankDetailsForm
            personId={person.id}
            bsbLast4={bsbLast4}
            accLast4={accLast4}
          />
        </CardContent>
      </Card>
    </div>
  );
}
