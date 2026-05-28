/**
 * Australian Business Register (ABR) lookup helper.
 *
 * The ABR exposes a free public lookup at abr.business.gov.au that returns
 * the legal name, trading names, ABN status, ACN, GST registration date,
 * entity type, and registered office state for any AU entity. The
 * "guid" param is an authentication token registered users get for free
 * at https://abr.business.gov.au/Tools/WebServices.
 *
 * Set ABR_GUID in .env.local once and every client form / detail page
 * gets a "Pull from ABR" button that auto-fills legalName / tradingName
 * / ACN / state. Without the env var the lookup returns a configured=false
 * result and the UI hides the button.
 */

export type AbrLookupResult =
  | {
      ok: true;
      abn: string;
      legalName: string;
      tradingNames: string[];
      acn: string | null;
      entityType: string | null;
      gstRegisteredFrom: string | null; // ISO date, null if not GST-registered
      status: string; // "Active" / "Cancelled"
      stateCode: string | null;
      postcode: string | null;
    }
  | { ok: false; error: string }
  | { ok: false; error: 'not_configured' };

function normaliseAbn(input: string): string {
  return input.replace(/\s+/g, '');
}

function isValidAbn(abn: string): boolean {
  return /^[0-9]{11}$/.test(abn);
}

/**
 * Fetch ABR details for an ABN. Returns a structured result that the UI
 * can inspect to decide whether to enable / disable the "Pull from ABR"
 * affordance and how to surface failures.
 */
export async function lookupAbn(abnRaw: string): Promise<AbrLookupResult> {
  const guid = process.env['ABR_GUID'];
  if (!guid) {
    return { ok: false, error: 'not_configured' };
  }
  const abn = normaliseAbn(abnRaw);
  if (!isValidAbn(abn)) {
    return { ok: false, error: 'Invalid ABN — must be 11 digits.' };
  }

  // The "json" endpoint actually returns JSONP — `callback({...})`. We
  // strip the wrapper before parsing. `callback=callback` is fine; ABR
  // doesn't validate the function name.
  const url = `https://abr.business.gov.au/json/AbnDetails.aspx?abn=${abn}&guid=${guid}&callback=callback`;
  let raw: string;
  try {
    const res = await fetch(url, {
      // ABR responses are tiny; cache briefly to avoid hammering them
      // when a partner pastes the same ABN twice.
      next: { revalidate: 3600 },
      headers: { Accept: 'application/javascript, application/json' },
    });
    if (!res.ok) {
      return { ok: false, error: `ABR returned ${res.status}` };
    }
    raw = await res.text();
  } catch (err) {
    console.error('[abr.lookup] fetch failed:', err);
    return { ok: false, error: 'Could not reach ABR — try again.' };
  }

  // Strip the JSONP wrapper. Format: `callback({...})` (no semicolon).
  const open = raw.indexOf('(');
  const close = raw.lastIndexOf(')');
  if (open < 0 || close <= open) {
    return { ok: false, error: 'Unexpected ABR response format' };
  }
  const jsonText = raw.slice(open + 1, close);

  let payload: unknown;
  try {
    payload = JSON.parse(jsonText);
  } catch {
    return { ok: false, error: 'Could not parse ABR response' };
  }

  // ABR shape (as of 2026-04, snake_case-ish PascalCase mix):
  // { Abn: "...", AbnStatus: "Active", EntityName: "...",
  //   EntityTypeName: "Australian Private Company",
  //   Acn: "001234567",
  //   Gst: "2000-07-01",
  //   AddressState: "VIC", AddressPostcode: "3000",
  //   BusinessName: ["Trade Name 1"],
  //   Message: "" }
  const obj = payload as Record<string, unknown>;
  const message = (obj['Message'] as string | undefined) ?? '';
  if (message && message.toLowerCase().includes('no record')) {
    return { ok: false, error: 'No ABR record found for that ABN.' };
  }
  const status = String(obj['AbnStatus'] ?? '');
  const legalName = String(obj['EntityName'] ?? '').trim();
  if (!legalName) {
    return { ok: false, error: message || 'ABR returned no legal name.' };
  }

  const businessNamesRaw = obj['BusinessName'];
  const tradingNames = Array.isArray(businessNamesRaw)
    ? businessNamesRaw.map((s) => String(s).trim()).filter(Boolean)
    : [];

  return {
    ok: true,
    abn,
    legalName,
    tradingNames,
    acn: typeof obj['Acn'] === 'string' && obj['Acn'] !== '' ? (obj['Acn'] as string) : null,
    entityType:
      typeof obj['EntityTypeName'] === 'string'
        ? (obj['EntityTypeName'] as string)
        : null,
    gstRegisteredFrom:
      typeof obj['Gst'] === 'string' && obj['Gst'] !== ''
        ? (obj['Gst'] as string)
        : null,
    status: status || 'Unknown',
    stateCode:
      typeof obj['AddressState'] === 'string' && obj['AddressState'] !== ''
        ? (obj['AddressState'] as string)
        : null,
    postcode:
      typeof obj['AddressPostcode'] === 'string' &&
      obj['AddressPostcode'] !== ''
        ? (obj['AddressPostcode'] as string)
        : null,
  };
}

/**
 * Best-effort entity-type → clientType mapping. ABR's entity types are
 * granular ("Australian Private Company", "Australian Government Entity",
 * etc.) — we collapse to the small set our schema uses.
 */
export function mapAbrEntityTypeToClientType(entityType: string | null): string {
  if (!entityType) return 'private_company';
  const lower = entityType.toLowerCase();
  if (lower.includes('government')) return 'government';
  if (lower.includes('public') && lower.includes('company')) return 'public_company';
  if (lower.includes('private') && lower.includes('company')) return 'private_company';
  if (lower.includes('not for profit') || lower.includes('non-profit') || lower.includes('charity'))
    return 'not_for_profit';
  if (lower.includes('partnership')) return 'partnership';
  if (lower.includes('individual') || lower.includes('sole')) return 'sole_trader';
  return 'private_company';
}
