import { prisma } from '@/server/db';
import { xeroRequest } from '@/server/integrations/xero';

type XeroContactResponse = {
  Contacts: Array<{
    ContactID: string;
    Name: string;
    EmailAddress?: string;
    ContactNumber?: string;
  }>;
};

type XeroContactPayload = {
  Name: string;
  ContactNumber?: string;
  EmailAddress?: string;
  CompanyNumber?: string; // ABN goes here for AU orgs
  TaxNumber?: string;
  Addresses?: Array<{
    AddressType: 'POBOX' | 'STREET';
    AddressLine1?: string;
    City?: string;
    PostalCode?: string;
    Country?: string;
  }>;
  PaymentTerms?: {
    Sales?: { Day: number; Type: 'DAYSAFTERBILLDATE' | 'OFMONTHFOLLOWING' };
  };
};

function paymentTermDays(terms: string): number | null {
  const m = terms.match(/^net-(\d+)$/);
  return m ? Number(m[1]) : null;
}

/**
 * Upsert a Xero Contact for a Client. If the Client already has a
 * xeroContactId, updates the existing Xero contact; otherwise creates a new
 * one and stores the id.
 */
export async function syncClientToXero(clientId: string): Promise<string> {
  const client = await prisma.client.findUniqueOrThrow({
    where: { id: clientId },
  });

  const payload: XeroContactPayload = {
    Name: client.legalName,
    ContactNumber: client.code,
    ...(client.billingEmail ? { EmailAddress: client.billingEmail } : {}),
    ...(client.abn ? { CompanyNumber: client.abn, TaxNumber: client.abn } : {}),
    ...(client.billingAddress
      ? {
          Addresses: [
            {
              AddressType: 'STREET' as const,
              AddressLine1: client.billingAddress,
              Country: 'Australia',
            },
          ],
        }
      : {}),
    ...(paymentTermDays(client.paymentTerms)
      ? {
          PaymentTerms: {
            Sales: {
              Day: paymentTermDays(client.paymentTerms)!,
              Type: 'DAYSAFTERBILLDATE' as const,
            },
          },
        }
      : {}),
  };

  // Xero's POST /Contacts endpoint is "idempotent by ContactID" — if present
  // it updates, else creates.
  const body = client.xeroContactId
    ? { Contacts: [{ ...payload, ContactID: client.xeroContactId }] }
    : { Contacts: [payload] };

  const result = await xeroRequest<XeroContactResponse>(
    'POST',
    '/api.xro/2.0/Contacts',
    body,
  );

  const contact = result.Contacts[0];
  if (!contact) throw new Error('Xero returned no contact');
  if (!client.xeroContactId || client.xeroContactId !== contact.ContactID) {
    await prisma.client.update({
      where: { id: client.id },
      data: { xeroContactId: contact.ContactID },
    });
  }
  return contact.ContactID;
}
