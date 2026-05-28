import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSession } from '@/server/session';
import { hasCapability } from '@/server/capabilities';
import { prisma } from '@/server/db';
import { ClientEditForm } from './form';

export default async function ClientEditPage({
  params,
}: {
  params: { id: string };
}) {
  const session = await getSession();
  if (!session || !hasCapability(session, 'client.edit')) notFound();

  const client = await prisma.client.findUnique({ where: { id: params.id } });
  if (!client) notFound();

  // Partner picklist — reused for the primary-partner select. Restrict
  // to current Partner / MP staff so we don't list managers / staff who
  // aren't eligible to own a client relationship.
  const partners = await prisma.person.findMany({
    where: { endDate: null, band: { in: ['Partner', 'MP'] } },
    orderBy: [{ band: 'asc' }, { lastName: 'asc' }],
    select: { id: true, initials: true, headshotUrl: true, firstName: true, lastName: true },
  });

  return (
    <div className="space-y-6">
      <div className="text-sm">
        <Link
          href={`/directory/clients/${client.id}`}
          className="text-ink-3 hover:text-ink"
        >
          ← Back to {client.code}
        </Link>
      </div>
      <header>
        <h1 className="text-xl font-semibold text-ink">
          Edit client · {client.legalName}
        </h1>
        <p className="text-sm text-ink-3">
          Administrative details flow through to invoices and the project
          CSA / Work Order templates. Changes are audited.
        </p>
      </header>
      <ClientEditForm
        client={{
          id: client.id,
          code: client.code,
          legalName: client.legalName,
          tradingName: client.tradingName,
          abn: client.abn,
          acn: client.acn,
          clientType: client.clientType,
          streetAddress: client.streetAddress,
          suburb: client.suburb,
          state: client.state,
          postcode: client.postcode,
          country: client.country,
          billingEmail: client.billingEmail,
          contactName: client.contactName,
          contactTitle: client.contactTitle,
          contactEmail: client.contactEmail,
          contactPhone: client.contactPhone,
          website: client.website,
          domain: client.domain,
          logoUrl: client.logoUrl,
          paymentTerms: client.paymentTerms,
          purchaseOrderRequired: client.purchaseOrderRequired,
          paymentInstructions: client.paymentInstructions,
          primaryPartnerId: client.primaryPartnerId,
        }}
        partners={partners}
      />
    </div>
  );
}
