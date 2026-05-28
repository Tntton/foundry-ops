'use server';

import { getSession } from '@/server/session';
import { hasCapability } from '@/server/capabilities';
import {
  lookupAbn,
  mapAbrEntityTypeToClientType,
  type AbrLookupResult,
} from '@/server/integrations/abr';
import { resolveCompanyAssets } from '@/server/integrations/company-logo';

export type AbrFormResult =
  | {
      ok: true;
      abn: string;
      legalName: string;
      tradingName: string | null;
      acn: string | null;
      clientType: string;
      stateCode: string | null;
      postcode: string | null;
      gstRegistered: boolean;
      status: string;
      // Logo + website resolved from the operator's typed-in website /
      // contact email. ABR itself doesn't return either, so these are
      // best-effort from the form context. All three may be null if
      // there's nothing to infer from.
      website: string | null;
      domain: string | null;
      logoUrl: string | null;
    }
  | { ok: false; configured: boolean; error: string };

/**
 * Form-friendly wrapper around `lookupAbn`. The client component calls
 * this with the typed-in ABN + whatever the operator has currently put
 * in the website / contact-email fields; we run auth, hit ABR, then
 * resolve the website + logo on top of the ABR response so the form
 * can splat all of it back into state in one round-trip.
 */
export async function lookupAbnForForm(
  abn: string,
  hint?: { website?: string | null; email?: string | null },
): Promise<AbrFormResult> {
  const session = await getSession();
  if (!session || !hasCapability(session, 'client.edit')) {
    return { ok: false, configured: true, error: 'Not authorized' };
  }

  const result: AbrLookupResult = await lookupAbn(abn);
  if (!result.ok) {
    if (result.error === 'not_configured') {
      return {
        ok: false,
        configured: false,
        error:
          'ABR lookup not configured. Set ABR_GUID in .env.local — request a free guid at abr.business.gov.au/Tools/WebServices.',
      };
    }
    return { ok: false, configured: true, error: result.error };
  }

  const assets = resolveCompanyAssets({
    website: hint?.website ?? null,
    email: hint?.email ?? null,
  });

  return {
    ok: true,
    abn: result.abn,
    legalName: result.legalName,
    tradingName: result.tradingNames[0] ?? null,
    acn: result.acn,
    clientType: mapAbrEntityTypeToClientType(result.entityType),
    stateCode: result.stateCode,
    postcode: result.postcode,
    gstRegistered: result.gstRegisteredFrom !== null,
    status: result.status,
    website: assets.website,
    domain: assets.domain,
    logoUrl: assets.logoUrl,
  };
}
